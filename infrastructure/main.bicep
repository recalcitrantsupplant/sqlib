// Azure Container Apps deployment for SPARQL Query Library API
// This template is environment-agnostic - configure via parameters

@description('Azure region for all resources')
param location string = resourceGroup().location

@description('Use existing Container Apps Environment (true) or create new one (false)')
param useExistingEnvironment bool = false

@description('Name of existing Container Apps Environment (required if useExistingEnvironment = true)')
param existingEnvironmentName string = ''

@description('Resource group of existing Container Apps Environment (optional, defaults to current RG)')
param existingEnvironmentResourceGroup string = resourceGroup().name

@description('Environment name for new Container Apps Environment (required if useExistingEnvironment = false)')
param environmentName string = ''

@description('Name of the Container App')
param containerAppName string

@description('ACR login server (e.g., myregistry.azurecr.io)')
param acrLoginServer string

@description('ACR username for authentication')
@secure()
param acrUsername string

@description('ACR password for authentication')
@secure()
param acrPassword string

@description('Container image name (e.g., sparql-query-lib-api)')
param imageName string

@description('Container image tag (e.g., latest, v1.0.0)')
param imageTag string = 'latest'

@description('Target port for the container (default: 3000)')
param targetPort int = 3000

@description('CPU cores for the container (0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0)')
param cpuCores string = '0.5'

@description('Memory in GB (0.5, 1.0, 1.5, 2.0, 3.0, 3.5, 4.0)')
param memorySize string = '1.0'

@description('Environment variables as key-value pairs')
param environmentVariables array = []

@description('Secrets as key-value pairs (referenced in environment variables)')
param secrets array = []

@description('Tags to apply to all resources')
param tags object = {}

// Reference to existing Container Apps Environment (if using existing)
resource existingEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' existing = if (useExistingEnvironment) {
  name: existingEnvironmentName
  scope: resourceGroup(existingEnvironmentResourceGroup)
}

// Log Analytics Workspace (only created for new environments)
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = if (!useExistingEnvironment) {
  name: '${containerAppName}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

// New Container App Environment (only created if not using existing)
resource newEnvironment 'Microsoft.App/managedEnvironments@2023-05-01' = if (!useExistingEnvironment) {
  name: '${environmentName}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

// Get the environment ID based on which path we're using
var environmentId = useExistingEnvironment ? existingEnvironment.id : newEnvironment.id

// Container App
resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  tags: tags
  properties: {
    managedEnvironmentId: environmentId
    configuration: {
      secrets: concat([
        {
          name: 'acr-password'
          value: acrPassword
        }
      ], secrets)
      registries: [
        {
          server: acrLoginServer
          username: acrUsername
          passwordSecretRef: 'acr-password'
        }
      ]
      ingress: {
        external: true
        targetPort: targetPort
        allowInsecure: false
        traffic: [
          {
            latestRevision: true
            weight: 100
          }
        ]
      }
    }
    template: {
      containers: [
        {
          name: containerAppName
          image: '${acrLoginServer}/${imageName}:${imageTag}'
          resources: {
            cpu: json(cpuCores)
            memory: '${memorySize}Gi'
          }
          env: environmentVariables
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

// Outputs
output containerAppFQDN string = containerApp.properties.configuration.ingress.fqdn
output containerAppUrl string = 'https://${containerApp.properties.configuration.ingress.fqdn}'
output logAnalyticsWorkspaceId string = useExistingEnvironment ? '' : logAnalytics.id
output containerAppEnvironmentId string = environmentId