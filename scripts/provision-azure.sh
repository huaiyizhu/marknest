#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${AZURE_LOCATION:?AZURE_LOCATION is required}"
: "${AZURE_APP_SERVICE_PLAN:?AZURE_APP_SERVICE_PLAN is required}"
: "${AZURE_WEBAPP_NAME:?AZURE_WEBAPP_NAME is required}"

AZURE_APP_SERVICE_SKU="${AZURE_APP_SERVICE_SKU:-B1}"
AZURE_NODE_RUNTIME="${AZURE_NODE_RUNTIME:-NODE:24-lts}"
MICROSOFT_AUTH_SECRET_SETTING="MICROSOFT_PROVIDER_AUTHENTICATION_SECRET"
GOOGLE_AUTH_SECRET_SETTING="GOOGLE_PROVIDER_AUTHENTICATION_SECRET"
MARKNEST_FRONTDOOR_PROFILE="${MARKNEST_FRONTDOOR_PROFILE:-}"
MARKNEST_FRONTDOOR_ENDPOINT="${MARKNEST_FRONTDOOR_ENDPOINT:-}"
MARKNEST_FRONTDOOR_ORIGIN_GROUP="${MARKNEST_FRONTDOOR_ORIGIN_GROUP:-marknest-appservice-origins}"
MARKNEST_FRONTDOOR_ORIGIN="${MARKNEST_FRONTDOOR_ORIGIN:-marknest-appservice}"

if ! az group show --name "$AZURE_RESOURCE_GROUP" --output none 2>/dev/null; then
  az group create \
    --name "$AZURE_RESOURCE_GROUP" \
    --location "$AZURE_LOCATION" \
    --tags application=marknest environment=production managed-by=github-actions \
    --output none
fi

if ! az appservice plan show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_APP_SERVICE_PLAN" \
  --output none 2>/dev/null; then
  az appservice plan create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_APP_SERVICE_PLAN" \
    --location "$AZURE_LOCATION" \
    --is-linux \
    --sku "$AZURE_APP_SERVICE_SKU" \
    --number-of-workers 1 \
    --output none
fi

if ! az webapp show \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --output none 2>/dev/null; then
  az webapp create \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --plan "$AZURE_APP_SERVICE_PLAN" \
    --name "$AZURE_WEBAPP_NAME" \
    --runtime "$AZURE_NODE_RUNTIME" \
    --output none
fi

az webapp update \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --https-only true \
  --output none

az webapp config set \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --linux-fx-version "NODE|24-lts" \
  --startup-file "npm start" \
  --always-on true \
  --ftps-state Disabled \
  --min-tls-version 1.2 \
  --http20-enabled true \
  --output none

app_url="https://${AZURE_WEBAPP_NAME}.azurewebsites.net"
public_base_url="${MARKNEST_PUBLIC_BASE_URL:-$app_url}"
public_host="${public_base_url#https://}"
public_host="${public_host#http://}"
public_host="${public_host%%/*}"
settings=(
  "NODE_ENV=production"
  "DATABASE_FILE=/home/data/marknest.db"
  "PUBLIC_BASE_URL=${public_base_url}"
  "SCM_DO_BUILD_DURING_DEPLOYMENT=false"
  "ENABLE_ORYX_BUILD=false"
)

if [[ -n "${MARKNEST_ADMIN_IDENTITIES:-}" ]]; then
  settings+=("ADMIN_IDENTITIES=${MARKNEST_ADMIN_IDENTITIES}")
fi
if [[ -n "${MARKNEST_ADMIN_EMAILS:-}" ]]; then
  settings+=("ADMIN_EMAILS=${MARKNEST_ADMIN_EMAILS}")
fi
if [[ -n "${MICROSOFT_AUTH_CLIENT_SECRET:-}" ]]; then
  settings+=("${MICROSOFT_AUTH_SECRET_SETTING}=${MICROSOFT_AUTH_CLIENT_SECRET}")
fi
if [[ -n "${GOOGLE_AUTH_CLIENT_SECRET:-}" ]]; then
  settings+=("${GOOGLE_AUTH_SECRET_SETTING}=${GOOGLE_AUTH_CLIENT_SECRET}")
fi
if [[ -n "${GOOGLE_AUTH_CLIENT_ID:-}" ]]; then
  settings+=("GOOGLE_AUTH_CLIENT_ID=${GOOGLE_AUTH_CLIENT_ID}")
fi

az webapp config appsettings set \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --settings "${settings[@]}" \
  --output none

if [[ -z "${MICROSOFT_AUTH_CLIENT_ID:-}" ]]; then
  MICROSOFT_AUTH_CLIENT_ID="$(az webapp config appsettings list \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --query "[?name=='MICROSOFT_AUTH_CLIENT_ID'].value | [0]" \
    --output tsv)"
fi
if [[ -z "${GOOGLE_AUTH_CLIENT_ID:-}" ]]; then
  GOOGLE_AUTH_CLIENT_ID="$(az webapp config appsettings list \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --query "[?name=='GOOGLE_AUTH_CLIENT_ID'].value | [0]" \
    --output tsv)"
fi

if [[ -n "${MICROSOFT_AUTH_CLIENT_ID:-}" ]]; then
  az extension add --name authV2 --yes --allow-preview true --output none
  az webapp auth microsoft update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --client-id "$MICROSOFT_AUTH_CLIENT_ID" \
    --client-secret-setting-name "$MICROSOFT_AUTH_SECRET_SETTING" \
    --issuer "https://login.microsoftonline.com/common/v2.0" \
    --allowed-token-audiences "$MICROSOFT_AUTH_CLIENT_ID" \
    --yes \
    --output none

  if [[ -n "${GOOGLE_AUTH_CLIENT_ID:-}" ]]; then
    az webapp auth google update \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --name "$AZURE_WEBAPP_NAME" \
      --client-id "$GOOGLE_AUTH_CLIENT_ID" \
      --client-secret-setting-name "$GOOGLE_AUTH_SECRET_SETTING" \
      --scopes openid profile email \
      --yes \
      --output none
  fi

  az webapp auth update \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --name "$AZURE_WEBAPP_NAME" \
    --enabled true \
    --action AllowAnonymous \
    --enable-token-store true \
    --require-https true \
    --runtime-version "~1" \
    --output none
fi

frontdoor_hostname=""
if [[ -n "$MARKNEST_FRONTDOOR_PROFILE" && -n "$MARKNEST_FRONTDOOR_ENDPOINT" ]]; then
  origin_host="${AZURE_WEBAPP_NAME}.azurewebsites.net"
  origin_host_header="${MARKNEST_FRONTDOOR_ORIGIN_HOST_HEADER:-$public_host}"

  if ! az afd profile show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
    --output none 2>/dev/null; then
    az afd profile create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
      --sku Standard_AzureFrontDoor \
      --origin-response-timeout-seconds 60 \
      --tags application=marknest environment=production managed-by=github-actions \
      --output none
  fi

  if ! az afd endpoint show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
    --endpoint-name "$MARKNEST_FRONTDOOR_ENDPOINT" \
    --output none 2>/dev/null; then
    az afd endpoint create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
      --endpoint-name "$MARKNEST_FRONTDOOR_ENDPOINT" \
      --enabled-state Enabled \
      --name-reuse-scope SubscriptionReuse \
      --tags application=marknest environment=production \
      --output none
  fi

  if ! az afd origin-group show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
    --origin-group-name "$MARKNEST_FRONTDOOR_ORIGIN_GROUP" \
    --output none 2>/dev/null; then
    az afd origin-group create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
      --origin-group-name "$MARKNEST_FRONTDOOR_ORIGIN_GROUP" \
      --enable-health-probe true \
      --probe-path /api/health \
      --probe-protocol Https \
      --probe-request-type GET \
      --probe-interval-in-seconds 60 \
      --sample-size 4 \
      --successful-samples-required 3 \
      --additional-latency-in-milliseconds 50 \
      --session-affinity-state Disabled \
      --output none
  fi

  if ! az afd origin show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
    --origin-group-name "$MARKNEST_FRONTDOOR_ORIGIN_GROUP" \
    --origin-name "$MARKNEST_FRONTDOOR_ORIGIN" \
    --output none 2>/dev/null; then
    az afd origin create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
      --origin-group-name "$MARKNEST_FRONTDOOR_ORIGIN_GROUP" \
      --origin-name "$MARKNEST_FRONTDOOR_ORIGIN" \
      --host-name "$origin_host" \
      --origin-host-header "$origin_host_header" \
      --http-port 80 \
      --https-port 443 \
      --priority 1 \
      --weight 1000 \
      --enabled-state Enabled \
      --enforce-certificate-name-check true \
      --output none
  else
    az afd origin update \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
      --origin-group-name "$MARKNEST_FRONTDOOR_ORIGIN_GROUP" \
      --origin-name "$MARKNEST_FRONTDOOR_ORIGIN" \
      --origin-host-header "$origin_host_header" \
      --output none
  fi

  if ! az afd route show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
    --endpoint-name "$MARKNEST_FRONTDOOR_ENDPOINT" \
    --route-name static-assets \
    --output none 2>/dev/null; then
    az afd route create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
      --endpoint-name "$MARKNEST_FRONTDOOR_ENDPOINT" \
      --route-name static-assets \
      --origin-group "$MARKNEST_FRONTDOOR_ORIGIN_GROUP" \
      --patterns-to-match "/src/*" "/node_modules/*" "/uploads/*" \
      --supported-protocols Http Https \
      --https-redirect Enabled \
      --forwarding-protocol HttpsOnly \
      --link-to-default-domain Enabled \
      --enable-caching true \
      --query-string-caching-behavior IgnoreQueryString \
      --enable-compression true \
      --content-types-to-compress text/css text/javascript application/javascript application/json image/svg+xml text/plain \
      --enabled-state Enabled \
      --output none
  fi

  if ! az afd route show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
    --endpoint-name "$MARKNEST_FRONTDOOR_ENDPOINT" \
    --route-name application \
    --output none 2>/dev/null; then
    az afd route create \
      --resource-group "$AZURE_RESOURCE_GROUP" \
      --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
      --endpoint-name "$MARKNEST_FRONTDOOR_ENDPOINT" \
      --route-name application \
      --origin-group "$MARKNEST_FRONTDOOR_ORIGIN_GROUP" \
      --patterns-to-match "/*" \
      --supported-protocols Http Https \
      --https-redirect Enabled \
      --forwarding-protocol HttpsOnly \
      --link-to-default-domain Enabled \
      --enable-caching false \
      --enable-compression true \
      --content-types-to-compress text/html text/css text/javascript application/javascript application/json image/svg+xml text/plain \
      --enabled-state Enabled \
      --output none
  fi

  frontdoor_hostname="$(az afd endpoint show \
    --resource-group "$AZURE_RESOURCE_GROUP" \
    --profile-name "$MARKNEST_FRONTDOOR_PROFILE" \
    --endpoint-name "$MARKNEST_FRONTDOOR_ENDPOINT" \
    --query hostName \
    --output tsv)"
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "webapp-name=${AZURE_WEBAPP_NAME}"
    echo "webapp-url=${app_url}"
    if [[ -n "$frontdoor_hostname" ]]; then
      echo "frontdoor-hostname=${frontdoor_hostname}"
    fi
  } >> "$GITHUB_OUTPUT"
fi

echo "Marknest Azure resources are ready at ${app_url}"
if [[ -n "$frontdoor_hostname" ]]; then
  echo "Marknest Azure Front Door endpoint is ready at https://${frontdoor_hostname}"
fi
