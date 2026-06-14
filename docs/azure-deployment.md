# Azure Continuous Deployment

Marknest uses GitHub Actions and Azure OIDC authentication. It does not store an
Azure password or publish profile in GitHub.

All deployment resources are dedicated to Marknest:

| Resource | Value |
| --- | --- |
| Subscription | `608633d1-cbfb-4a74-9377-b956f3640cda` |
| Tenant | `487cab16-e77e-4753-b8ba-8d0ed7c93332` |
| Resource group | `marknest-prod-rg` |
| Region | `eastasia` |
| App Service plan | `marknest-prod-plan` |
| Plan SKU | Linux B1, one worker |
| Web App | `marknest-608633d1-0cda` |
| Runtime | Node.js 24 LTS |

The workflow creates missing App Service resources on its first run. Later runs
reuse and update the same resources.

## One-Time Bootstrap

The one-time bootstrap creates:

- The dedicated `marknest-prod-rg` resource group
- A Microsoft Entra application and service principal
- A GitHub OIDC federated credential limited to the repository's `production`
  environment
- A Contributor assignment limited to `marknest-prod-rg`

It does not grant access to other Azure resource groups.

From the repository root, sign in to the confirmed Azure subscription and run:

```powershell
az login
az account set --subscription 608633d1-cbfb-4a74-9377-b956f3640cda
.\scripts\bootstrap-azure-cd.ps1
```

The generated client ID is a non-secret identifier and is committed in the
project workflow:

```text
AZURE_CLIENT_ID=60d75313-6e66-4a50-8823-fc19eff7bf0b
```

GitHub automatically creates the `production` environment on the first
workflow run if it does not already exist. Optionally add an environment secret
named `MARKNEST_ADMIN_IDENTITIES`, for example:

```text
aad:<provider-user-id>,google:<provider-user-id>
```

The bootstrap script is idempotent. Running it again reuses the resource group,
application, service principal, federated credential, and role assignment. If
the Entra application is intentionally recreated, update `AZURE_CLIENT_ID` in
the workflow with the new value printed by the script.

## One-Click Deployment

Open **Actions > Deploy Azure > Run workflow** and select `main`.

The same workflow also runs automatically:

- After every push to `main`
- When a version tag such as `v1.0.0` is pushed

Each run:

1. Installs dependencies.
2. Runs syntax checks and automated tests.
3. Creates a package containing only runtime files and production dependencies.
4. Signs in to Azure with GitHub OIDC.
5. Creates or reuses the dedicated Linux B1 plan and Web App.
6. Applies runtime, HTTPS, TLS, storage, and application settings.
7. Deploys the application.
8. Retries `/api/health` for up to two minutes.

Only one production deployment runs at a time. A newer deployment cancels an
older in-progress deployment.

## Application Storage

The Web App uses:

```text
DATABASE_FILE=/home/data/marknest.db
```

The `/home` directory is persistent on Azure App Service for Linux. The current
SQLite design must remain at one application instance. Before scaling out,
migrate to Azure Database for PostgreSQL or another shared database.

## User Authentication

Application deployment does not automatically create Microsoft or Google OAuth
registrations because those require provider-specific consent and credentials.

After the first deployment, open **Authentication** on the Web App:

1. Add Microsoft as an identity provider.
2. Add Google as an identity provider.
3. Allow unauthenticated access so public articles remain readable.
4. Configure the provider application IDs and secrets.

Azure Easy Auth sends the authenticated identity through the
`X-MS-CLIENT-PRINCIPAL` header. Marknest does not receive provider passwords.

## Verification

Application:

```text
https://marknest-608633d1-0cda.azurewebsites.net
```

Health endpoint:

```text
https://marknest-608633d1-0cda.azurewebsites.net/api/health
```

Expected response:

```json
{"status":"ok"}
```

## Troubleshooting

- OIDC login fails: confirm the workflow `AZURE_CLIENT_ID` matches the bootstrap
  output and rerun the bootstrap script if the repository was renamed.
- Resource creation is forbidden: confirm the service principal still has
  Contributor on `marknest-prod-rg`.
- Health check returns `503`: inspect **Log stream** in Azure Portal.
- Data disappears after scaling: return to one instance or migrate SQLite to a
  shared database.
