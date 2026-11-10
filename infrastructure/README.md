# Azure Infrastructure Templates

This directory has Bicep templates and scripts that deploy sqlib to Azure. They
are one example of a deployment. See
[deploying](../docs/guides/deploying.md#one-worked-deployment-example).

## Structure

```
infrastructure/
├── main.bicep                    # Azure Container Apps template (Backend API)
├── swa.bicep                     # Azure Static Web Apps template (Frontend UI)
├── main.parameters.example.json  # Example parameters for main.bicep
├── swa.parameters.example.json   # Example parameters for swa.bicep
├── build-and-push.sh            # Build and push Docker image to ACR
└── README.md                     # This file
```

## Prerequisites

- Azure CLI installed and authenticated (`az login`)
- Docker installed (for building images)
- Azure subscription with appropriate permissions
- Azure Container Registry (ACR) set up

## Manual Deployment

### 1. Create a parameters file

Copy the example parameters file, and change it for your environment:

```bash
cp main.parameters.example.json main.parameters.dev.json
```

Put your values in `main.parameters.dev.json`:
- ACR details (server, username, password)
- Container image name and tag
- Environment variables specific to your deployment
- Secrets (SPARQL credentials, API keys, etc.)

Keep your parameters files secure, and **do not commit them to version
control**. Add `*.parameters.*.json` to `.gitignore`.

### 2. Create a resource group (if needed)

```bash
az group create \
  --name rg-sparql-query-lib-dev \
  --location westeurope
```

### 3. Deploy the template

```bash
az deployment group create \
  --resource-group rg-sparql-query-lib-dev \
  --template-file main.bicep \
  --parameters main.parameters.dev.json
```

### 4. Get the application URL

When the deployment is complete, get the URL:

```bash
az deployment group show \
  --resource-group rg-sparql-query-lib-dev \
  --name main \
  --query properties.outputs.containerAppUrl.value \
  --output tsv
```

## Template Structure

### Resources Created

- **Log Analytics Workspace**: central logging for the Container App.
- **Container App Environment**: the managed environment for Container Apps.
- **Container App**: the API application, with:
  - ACR integration for private image pull
  - External HTTPS ingress (auto TLS)
  - Fixed scale (1 replica)
  - Environment variables and secrets management
- **SQLite backup to blob storage** (optional, `enableSqliteBackup`) - see
  [backup to blob storage](../docs/guides/deploying.md#backup-to-blob-storage):
  - A user-assigned managed identity for the app
  - A storage account with TLS 1.2, no anonymous access, no shared keys and
    7-day soft delete (or an existing account, with `createBackupStorage: false`)
  - A blob container, with Storage Blob Data Contributor for the identity on
    that container only
  - Optionally a private endpoint, the `privatelink.blob` DNS zone and its VNet
    link (`backupPrivateEndpointSubnetId`, `backupPrivateDnsVnetId`); the
    account's public access is then off. Needs a VNet-integrated environment.
  - `SQLIB_SQLITE_REPLICA_URL` and `AZURE_CLIENT_ID` on the container, a startup
    probe that allows for the restore and the replica lease, and a 30s grace
    period

  The store then lives on the container's own disk: mount no volume at the
  storage path. Scale stays at one replica; the replica lease covers the
  overlap while a new revision starts.

### Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `location` | No | Azure region | Resource group location |
| `enableSqliteBackup` | No | Back up the SQLite store to Blob Storage | `false` |
| `backupStorageAccountName` | With backup | Storage account for the backup | - |
| `createBackupStorage` | No | Create the account, or use an existing one in this resource group | `true` |
| `backupStorageSku` | No | Redundancy of a created account | `Standard_LRS` |
| `backupContainerName` | No | Blob container | `sqlib-backup` |
| `backupPath` | No | Path in the container; one per deployment | container app name |
| `backupPrivateEndpointSubnetId` | No | Subnet for a private endpoint; empty keeps the public endpoint | - |
| `backupPrivateDnsVnetId` | With a private endpoint | VNet to link the DNS zone to | - |
| `terminationGracePeriodSeconds` | No | Wait after SIGTERM | `30` |
| `environmentName` | Yes | Environment name (dev/staging/prod) | - |
| `containerAppName` | Yes | Name of the Container App | - |
| `acrLoginServer` | Yes | ACR server (e.g., myregistry.azurecr.io) | - |
| `acrUsername` | Yes | ACR username | - |
| `acrPassword` | Yes | ACR password (secure) | - |
| `imageName` | Yes | Container image name | - |
| `imageTag` | No | Container image tag | `latest` |
| `targetPort` | No | Container port | `3000` |
| `cpuCores` | No | CPU allocation | `0.5` |
| `memorySize` | No | Memory in GB | `1.0` |
| `environmentVariables` | No | Array of env vars | `[]` |
| `secrets` | No | Array of secrets | `[]` |
| `tags` | No | Resource tags | `{}` |

### Environment Variables

An environment variable can refer to a secret with `secretRef`:

```json
{
  "name": "DATABASE_PASSWORD",
  "secretRef": "db-password"
}
```

Or it can have a plain value:

```json
{
  "name": "NODE_ENV",
  "value": "production"
}
```

### Secrets

Container Apps stores the secrets. Environment variables refer to them:

```json
{
  "name": "db-password",
  "value": "<db-password>"
}
```

## Common Operations

### Update the container image

After you push a new image to ACR, update the Container App:

```bash
az containerapp update \
  --name sparql-query-lib-api \
  --resource-group rg-sparql-query-lib-dev \
  --image myregistry.azurecr.io/sparql-query-lib-api:v1.2.0
```

### View logs

Stream live logs:

```bash
az containerapp logs show \
  --name sparql-query-lib-api \
  --resource-group rg-sparql-query-lib-dev \
  --follow
```

### Update environment variables

```bash
az containerapp update \
  --name sparql-query-lib-api \
  --resource-group rg-sparql-query-lib-dev \
  --set-env-vars "LOG_LEVEL=debug"
```

### Scale replicas

```bash
az containerapp update \
  --name sparql-query-lib-api \
  --resource-group rg-sparql-query-lib-dev \
  --min-replicas 1 \
  --max-replicas 3
```

## Multiple Environments

Make a separate parameters file for each environment:

```
infrastructure/
├── main.bicep
├── main.parameters.example.json
├── main.parameters.dev.json
├── main.parameters.staging.json
└── main.parameters.prod.json
```

Deploy each to its own resource group:

```bash
# Development
az deployment group create \
  --resource-group rg-sparql-query-lib-dev \
  --template-file main.bicep \
  --parameters main.parameters.dev.json

# Production
az deployment group create \
  --resource-group rg-sparql-query-lib-prod \
  --template-file main.bicep \
  --parameters main.parameters.prod.json
```

## Security

1. **Use Azure Key Vault** for production secrets. The templates do not do this
   yet.
2. **Rotate ACR credentials** at regular intervals.
3. **Use managed identities** where possible. ACR supports them.
4. **Keep parameters files secure.** Never commit them with real credentials.
5. **Use RBAC** to control who can deploy and manage resources.
6. **Turn on diagnostic settings** on Container Apps, for audit logs.

## Troubleshooting

### Container fails to start

Read the logs:
```bash
az containerapp logs show \
  --name sparql-query-lib-api \
  --resource-group rg-sparql-query-lib-dev \
  --tail 100
```

### Cannot pull image from ACR

Check the ACR credentials:
```bash
az acr login --name myregistry
docker pull myregistry.azurecr.io/sparql-query-lib-api:latest
```

### Deployment validation errors

Validate the template before you deploy:
```bash
az deployment group validate \
  --resource-group rg-sparql-query-lib-dev \
  --template-file main.bicep \
  --parameters main.parameters.dev.json
```

## Cost

The current configuration (1 replica, 0.5 CPU, 1GB RAM) is the minimum. Estimated
costs:
- Container Apps consumption: ~$30-50/month
- Log Analytics: ~$5-20/month (depending on log volume)

To reduce costs:

- Scale dev environments to zero (set `minReplicas: 0`).
- Reduce Log Analytics retention to 7 days.
- Share one Container App Environment between several apps.

## To do

- A CI/CD pipeline for automated deployments.
- A managed identity for ACR, to remove the password.
- Azure Key Vault for secrets.
- Custom domains and TLS certificates.
- Set up Application Insights for advanced monitoring