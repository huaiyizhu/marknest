#!/usr/bin/env bash
set -euo pipefail

: "${AZURE_RESOURCE_GROUP:?AZURE_RESOURCE_GROUP is required}"
: "${AZURE_LOCATION:?AZURE_LOCATION is required}"
: "${AZURE_APP_SERVICE_PLAN:?AZURE_APP_SERVICE_PLAN is required}"
: "${AZURE_WEBAPP_NAME:?AZURE_WEBAPP_NAME is required}"

AZURE_APP_SERVICE_SKU="${AZURE_APP_SERVICE_SKU:-B1}"
AZURE_NODE_RUNTIME="${AZURE_NODE_RUNTIME:-NODE:24-lts}"

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
settings=(
  "NODE_ENV=production"
  "DATABASE_FILE=/home/data/marknest.db"
  "PUBLIC_BASE_URL=${app_url}"
  "SCM_DO_BUILD_DURING_DEPLOYMENT=false"
  "ENABLE_ORYX_BUILD=false"
)

if [[ -n "${MARKNEST_ADMIN_IDENTITIES:-}" ]]; then
  settings+=("ADMIN_IDENTITIES=${MARKNEST_ADMIN_IDENTITIES}")
fi

az webapp config appsettings set \
  --resource-group "$AZURE_RESOURCE_GROUP" \
  --name "$AZURE_WEBAPP_NAME" \
  --settings "${settings[@]}" \
  --output none

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "webapp-name=${AZURE_WEBAPP_NAME}"
    echo "webapp-url=${app_url}"
  } >> "$GITHUB_OUTPUT"
fi

echo "Marknest Azure resources are ready at ${app_url}"
