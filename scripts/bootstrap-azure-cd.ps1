param(
  [string]$Repository = "huaiyizhu/marknest",
  [string]$Environment = "production",
  [string]$SubscriptionId = "608633d1-cbfb-4a74-9377-b956f3640cda",
  [string]$TenantId = "487cab16-e77e-4753-b8ba-8d0ed7c93332",
  [string]$ResourceGroup = "marknest-prod-rg",
  [string]$Location = "eastasia",
  [string]$ApplicationName = "github-marknest-production"
)

$ErrorActionPreference = "Stop"

az account set --subscription $SubscriptionId
$account = az account show --query "{subscription:id,tenant:tenantId}" --output json | ConvertFrom-Json
if ($account.subscription -ne $SubscriptionId -or $account.tenant -ne $TenantId) {
  throw "Azure CLI is not using the expected Marknest subscription and tenant."
}

az group create `
  --name $ResourceGroup `
  --location $Location `
  --tags application=marknest environment=production managed-by=github-actions `
  --output none

$clientId = az ad app list --display-name $ApplicationName --query "[0].appId" --output tsv
if (-not $clientId) {
  $clientId = az ad app create `
    --display-name $ApplicationName `
    --sign-in-audience AzureADMyOrg `
    --query appId `
    --output tsv
}

$servicePrincipalId = az ad sp list --filter "appId eq '$clientId'" --query "[0].id" --output tsv
if (-not $servicePrincipalId) {
  $servicePrincipalId = az ad sp create --id $clientId --query id --output tsv
}

$subject = "repo:${Repository}:environment:${Environment}"
$credentialName = "github-${Environment}"
$existingCredential = az ad app federated-credential list `
  --id $clientId `
  --query "[?name=='${credentialName}'].name | [0]" `
  --output tsv

if (-not $existingCredential) {
  $credential = @{
    name      = $credentialName
    issuer    = "https://token.actions.githubusercontent.com"
    subject   = $subject
    audiences = @("api://AzureADTokenExchange")
  }
  $credentialFile = Join-Path ([System.IO.Path]::GetTempPath()) "marknest-federated-credential.json"
  $credential | ConvertTo-Json | Set-Content -LiteralPath $credentialFile -Encoding utf8
  try {
    az ad app federated-credential create `
      --id $clientId `
      --parameters $credentialFile `
      --output none
  }
  finally {
    Remove-Item -LiteralPath $credentialFile -Force -ErrorAction SilentlyContinue
  }
}

$scope = "/subscriptions/${SubscriptionId}/resourceGroups/${ResourceGroup}"
$roleAssignment = az role assignment list `
  --assignee-object-id $servicePrincipalId `
  --scope $scope `
  --role Contributor `
  --query "[0].id" `
  --output tsv

if (-not $roleAssignment) {
  az role assignment create `
    --assignee-object-id $servicePrincipalId `
    --assignee-principal-type ServicePrincipal `
    --role Contributor `
    --scope $scope `
    --output none
}

Write-Host ""
Write-Host "Azure bootstrap complete."
Write-Host "Resource group: $ResourceGroup"
Write-Host "Federated subject: $subject"
Write-Host ""
Write-Host "GitHub Actions client ID:"
Write-Host "AZURE_CLIENT_ID=$clientId"
Write-Host ""
Write-Host "Optional application secret:"
Write-Host "MARKNEST_ADMIN_IDENTITIES=aad:<provider-user-id>,google:<provider-user-id>"
