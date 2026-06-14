# Azure Deployment

Marknest can run on Azure App Service with Microsoft and Google sign-in provided by App Service Authentication (Easy Auth).

## Required App Settings

Configure these values in Azure App Service:

```text
NODE_ENV=production
PORT=8080
DATABASE_FILE=/home/data/marknest.db
PUBLIC_BASE_URL=https://<your-app>.azurewebsites.net
ADMIN_IDENTITIES=aad:<provider-user-id>,google:<provider-user-id>
```

For a multi-instance production deployment, replace SQLite with Azure Database for PostgreSQL. SQLite is appropriate for a single-instance v1 deployment.

## Authentication

In Azure Portal:

1. Open the App Service.
2. Select Authentication.
3. Add Microsoft as an identity provider.
4. Add Google as an identity provider.
5. Allow unauthenticated access so public articles remain readable.
6. Configure provider application IDs and secrets.

Azure Easy Auth sends the authenticated identity to Marknest through the `X-MS-CLIENT-PRINCIPAL` header. Marknest does not receive or store provider passwords.

## GitHub Actions

Create a GitHub production environment and configure:

- Repository variable `AZURE_WEBAPP_NAME`
- Repository secret `AZURE_WEBAPP_PUBLISH_PROFILE`

Download the publish profile from Azure App Service and store the complete XML as the secret value.

The `Deploy Azure` workflow runs:

- Manually through `workflow_dispatch`
- Automatically when a version tag such as `v1.0.0` is pushed

The workflow runs syntax checks and tests before deployment.

