param(
  [string]$SubscriptionId = "608633d1-cbfb-4a74-9377-b956f3640cda",
  [string]$TenantId = "487cab16-e77e-4753-b8ba-8d0ed7c93332",
  [string]$ResourceGroup = "marknest-prod-rg",
  [string]$WebAppName = "marknest-608633d1-0cda",
  [string]$MicrosoftApplicationName = "marknest-production-login",
  [string]$GoogleClientId,
  [SecureString]$GoogleClientSecret,
  [switch]$RotateMicrosoftSecret
)

$ErrorActionPreference = "Stop"

function ConvertFrom-SecureValue([SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

az account set --subscription $SubscriptionId
$account = az account show --query "{subscription:id,tenant:tenantId}" --output json | ConvertFrom-Json
if ($account.subscription -ne $SubscriptionId -or $account.tenant -ne $TenantId) {
  throw "Azure CLI is not using the expected Marknest subscription and tenant."
}

az webapp show --resource-group $ResourceGroup --name $WebAppName --output none
$appUrl = "https://${WebAppName}.azurewebsites.net"
$microsoftRedirect = "${appUrl}/.auth/login/aad/callback"
$googleRedirect = "${appUrl}/.auth/login/google/callback"

$microsoftClientId = az ad app list `
  --display-name $MicrosoftApplicationName `
  --query "[0].appId" `
  --output tsv

if (-not $microsoftClientId) {
  $microsoftClientId = az ad app create `
    --display-name $MicrosoftApplicationName `
    --sign-in-audience AzureADandPersonalMicrosoftAccount `
    --web-redirect-uris $microsoftRedirect `
    --query appId `
    --output tsv
}
else {
  az ad app update `
    --id $microsoftClientId `
    --web-redirect-uris $microsoftRedirect `
    --output none
}

$settings = az webapp config appsettings list `
  --resource-group $ResourceGroup `
  --name $WebAppName `
  --output json | ConvertFrom-Json
$settingsByName = @{}
foreach ($setting in $settings) {
  $settingsByName[$setting.name] = $setting.value
}

$microsoftSecretSetting = "MICROSOFT_PROVIDER_AUTHENTICATION_SECRET"
if ($RotateMicrosoftSecret -or -not $settingsByName[$microsoftSecretSetting]) {
  $microsoftSecret = az ad app credential reset `
    --id $microsoftClientId `
    --append `
    --display-name "marknest-easy-auth" `
    --years 1 `
    --query password `
    --output tsv
  az webapp config appsettings set `
    --resource-group $ResourceGroup `
    --name $WebAppName `
    --settings "${microsoftSecretSetting}=${microsoftSecret}" `
    --output none
}

az webapp config appsettings set `
  --resource-group $ResourceGroup `
  --name $WebAppName `
  --settings "MICROSOFT_AUTH_CLIENT_ID=${microsoftClientId}" `
  --output none

if ($GoogleClientId) {
  if (-not $GoogleClientSecret) {
    $GoogleClientSecret = Read-Host "Google OAuth client secret" -AsSecureString
  }
  $googleSecretText = ConvertFrom-SecureValue $GoogleClientSecret
  try {
    az webapp config appsettings set `
      --resource-group $ResourceGroup `
      --name $WebAppName `
      --settings `
        "GOOGLE_AUTH_CLIENT_ID=${GoogleClientId}" `
        "GOOGLE_PROVIDER_AUTHENTICATION_SECRET=${googleSecretText}" `
      --output none
  }
  finally {
    $googleSecretText = $null
  }
}
elseif ($settingsByName["GOOGLE_AUTH_CLIENT_ID"]) {
  $GoogleClientId = $settingsByName["GOOGLE_AUTH_CLIENT_ID"]
}

az extension add --name authV2 --yes --allow-preview true --output none
az webapp auth microsoft update `
  --resource-group $ResourceGroup `
  --name $WebAppName `
  --client-id $microsoftClientId `
  --client-secret-setting-name $microsoftSecretSetting `
  --issuer "https://login.microsoftonline.com/common/v2.0" `
  --allowed-token-audiences $microsoftClientId `
  --yes `
  --output none

if ($GoogleClientId) {
  az webapp auth google update `
    --resource-group $ResourceGroup `
    --name $WebAppName `
    --client-id $GoogleClientId `
    --client-secret-setting-name "GOOGLE_PROVIDER_AUTHENTICATION_SECRET" `
    --scopes openid profile email `
    --yes `
    --output none
}

az webapp auth update `
  --resource-group $ResourceGroup `
  --name $WebAppName `
  --enabled true `
  --action AllowAnonymous `
  --enable-token-store true `
  --require-https true `
  --runtime-version "~1" `
  --output none

Write-Host ""
Write-Host "Microsoft authentication configured."
Write-Host "Microsoft client ID: $microsoftClientId"
Write-Host "Microsoft callback: $microsoftRedirect"
if ($GoogleClientId) {
  Write-Host "Google authentication configured."
  Write-Host "Google callback: $googleRedirect"
}
else {
  Write-Host "Google authentication is waiting for a Google OAuth client ID and secret."
  Write-Host "Required Google callback: $googleRedirect"
}
