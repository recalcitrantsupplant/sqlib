# Azure Infrastructure Templates

This directory contains Bicep templates and deployment scripts for deploying the SPARQL Query Library to Azure.

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

Copy the example parameters file and customize for your environment:

```bash
cp main.parameters.example.json main.parameters.dev.json
```

Edit `main.parameters.dev.json` with your actual values:
- ACR details (server, username, password)
- Container image name and tag
- Environment variables specific to your deployment
- Secrets (SPARQL credentials, API keys, etc.)

**Important:** Keep your parameters files secure and **do not commit them to version control**. Add `*.parameters.*.json` to `.gitignore`.

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

After deployment completes, retrieve the URL:

```bash
az deployment group show \
  --resource-group rg-sparql-query-lib-dev \
  --name main \
  --query properties.outputs.containerAppUrl.value \
  --output tsv
```

## Template Structure

### Resources Created

- **Log Analytics Workspace** - Centralized logging for Container App
- **Container App Environment** - Managed environment for Container Apps
- **Container App** - Your API application with:
  - ACR integration for private image pull
  - External HTTPS ingress (auto TLS)
  - Fixed scale (1 replica)
  - Environment variables and secrets management

### Parameters

| Parameter | Required | Description | Default |
|-----------|----------|-------------|---------|
| `location` | No | Azure region | Resource group location |
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

Environment variables can reference secrets using `secretRef`:

```json
{
  "name": "DATABASE_PASSWORD",
  "secretRef": "db-password"
}
```

Or be plain values:

```json
{
  "name": "NODE_ENV",
  "value": "production"
}
```

### Secrets

Secrets are stored securely in Container Apps and referenced by environment variables:

```json
{
  "name": "db-password",
  "value": "<db-password>"
}
```

## Common Operations

### Update the container image

After pushing a new image to ACR, update the Container App:

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

### Scale replicas (if needed)

```bash
az containerapp update \
  --name sparql-query-lib-api \
  --resource-group rg-sparql-query-lib-dev \
  --min-replicas 1 \
  --max-replicas 3
```

## Multiple Environments

Create separate parameter files for each environment:

```
infrastructure/
├── main.bicep
├── main.parameters.example.json
├── main.parameters.dev.json
├── main.parameters.staging.json
└── main.parameters.prod.json
```

Deploy to different resource groups:

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

## Security Best Practices

1. **Use Azure Key Vault** for production secrets (future enhancement)
2. **Rotate ACR credentials** regularly
3. **Use managed identities** where possible (ACR supports this)
4. **Keep parameters files secure** - never commit them with real credentials
5. **Use RBAC** to control who can deploy and manage resources
6. **Enable diagnostic settings** on Container Apps for audit logs

## Troubleshooting

### Container fails to start

Check logs:
```bash
az containerapp logs show \
  --name sparql-query-lib-api \
  --resource-group rg-sparql-query-lib-dev \
  --tail 100
```

### Cannot pull image from ACR

Verify ACR credentials:
```bash
az acr login --name myregistry
docker pull myregistry.azurecr.io/sparql-query-lib-api:latest
```

### Deployment validation errors

Validate template before deploying:
```bash
az deployment group validate \
  --resource-group rg-sparql-query-lib-dev \
  --template-file main.bicep \
  --parameters main.parameters.dev.json
```

## Cost Optimization

Current configuration (1 replica, 0.5 CPU, 1GB RAM) is minimal. Estimated costs:
- Container Apps consumption: ~$30-50/month
- Log Analytics: ~$5-20/month (depending on log volume)

To reduce costs further:
- Use scaling to zero for dev environments (set `minReplicas: 0`)
- Reduce Log Analytics retention to 7 days
- Use shared Container App Environment across multiple apps

## Next Steps

- Set up a CI/CD pipeline for automated deployments
- Implement managed identity for ACR (remove password dependency)
- Add Azure Key Vault integration for secrets management
- Configure custom domains and SSL certificates
- Set up Application Insights for advanced monitoring