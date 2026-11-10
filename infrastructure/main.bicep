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

// --- SQLite backup to blob storage (docs/guides/deploying.md, "Backup to blob storage")

@description('Back up the SQLite store to Azure Blob Storage with Litestream, through a managed identity. The store then lives on the container\'s own disk.')
param enableSqliteBackup bool = false

@description('Storage account for the backup. Created when createBackupStorage is true; otherwise it must exist in this resource group.')
param backupStorageAccountName string = ''

@description('Create the storage account (true) or use an existing one (false)')
param createBackupStorage bool = true

@description('Redundancy of a created storage account')
@allowed(['Standard_LRS', 'Standard_ZRS', 'Standard_GRS', 'Standard_RAGRS'])
param backupStorageSku string = 'Standard_LRS'

@description('Blob container for the backup. Use one per environment.')
param backupContainerName string = 'sqlib-backup'

@description('Path inside the container. Never share one between two deployments.')
param backupPath string = containerAppName

@description('Subnet for a private endpoint to the storage account. Empty keeps the public endpoint (protected by Entra ID only, no shared keys). Set it only with a VNet-integrated environment.')
param backupPrivateEndpointSubnetId string = ''

@description('VNet to link the privatelink.blob DNS zone to (required with backupPrivateEndpointSubnetId)')
param backupPrivateDnsVnetId string = ''

@description('Seconds the platform waits after SIGTERM: covers the server shutdown and Litestream\'s last sync')
param terminationGracePeriodSeconds int = 30

var backupPrivate = enableSqliteBackup && !empty(backupPrivateEndpointSubnetId)
// Storage Blob Data Contributor
var blobDataContributorRoleId = 'ba92f5b4-2d11-453d-a403-e96b0029c9fe'

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

// Identity the container uses for the backup. User-assigned, so its role can be
// granted before the app exists and survives the app being re-created.
resource backupIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = if (enableSqliteBackup) {
  name: '${containerAppName}-backup'
  location: location
  tags: tags
}

// The account baseline: TLS 1.2, no anonymous blob access, and no shared keys,
// so only an Entra ID identity can reach the data. Soft delete covers a
// mistaken delete; no immutability policy, since Litestream deletes old files.
resource backupStorage 'Microsoft.Storage/storageAccounts@2023-05-01' = if (enableSqliteBackup && createBackupStorage) {
  name: backupStorageAccountName
  location: location
  tags: tags
  sku: {
    name: backupStorageSku
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
    allowBlobPublicAccess: false
    allowSharedKeyAccess: false
    publicNetworkAccess: backupPrivate ? 'Disabled' : 'Enabled'
    networkAcls: {
      defaultAction: backupPrivate ? 'Deny' : 'Allow'
      bypass: 'None'
    }
    encryption: {
      services: {
        blob: {
          enabled: true
        }
      }
      keySource: 'Microsoft.Storage'
    }
  }
}

resource backupBlobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = if (enableSqliteBackup && createBackupStorage) {
  parent: backupStorage
  name: 'default'
  properties: {
    deleteRetentionPolicy: {
      enabled: true
      days: 7
    }
    containerDeleteRetentionPolicy: {
      enabled: true
      days: 7
    }
  }
}

resource backupContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = if (enableSqliteBackup) {
  name: '${backupStorageAccountName}/default/${backupContainerName}'
  properties: {
    publicAccess: 'None'
  }
  dependsOn: [
    backupBlobService
  ]
}

// Write access to this one container, nothing else in the account.
resource backupRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (enableSqliteBackup) {
  scope: backupContainer
  name: guid(resourceGroup().id, backupStorageAccountName, backupContainerName, containerAppName, blobDataContributorRoleId)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataContributorRoleId)
    principalId: backupIdentity!.properties.principalId
    principalType: 'ServicePrincipal'
  }
}

resource backupDnsZone 'Microsoft.Network/privateDnsZones@2020-06-01' = if (backupPrivate) {
  name: 'privatelink.blob.${environment().suffixes.storage}'
  location: 'global'
  tags: tags
}

resource backupDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = if (backupPrivate) {
  parent: backupDnsZone
  name: '${containerAppName}-backup'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: backupPrivateDnsVnetId
    }
  }
}

resource backupPrivateEndpoint 'Microsoft.Network/privateEndpoints@2023-11-01' = if (backupPrivate) {
  name: '${backupStorageAccountName}-blob-pe'
  location: location
  tags: tags
  properties: {
    subnet: {
      id: backupPrivateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'blob'
        properties: {
          privateLinkServiceId: resourceId('Microsoft.Storage/storageAccounts', backupStorageAccountName)
          groupIds: [
            'blob'
          ]
        }
      }
    ]
  }
  dependsOn: [
    backupStorage
  ]
}

resource backupDnsZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2023-11-01' = if (backupPrivate) {
  parent: backupPrivateEndpoint
  name: 'default'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'blob'
        properties: {
          privateDnsZoneId: backupDnsZone.id
        }
      }
    ]
  }
}

var backupEnvironmentVariables = enableSqliteBackup ? [
  {
    name: 'SQLIB_SQLITE_REPLICA_URL'
    value: 'abs://${backupStorageAccountName}@${backupContainerName}/${backupPath}'
  }
  {
    // Picks the user-assigned identity for both Litestream and the lease.
    name: 'AZURE_CLIENT_ID'
    value: backupIdentity!.properties.clientId
  }
] : []

// Container Apps starts a new revision before it stops the old one; the
// replica lease makes the new one wait. The startup probe allows for that wait
// (up to SQLIB_SQLITE_REPLICA_LEASE_WAIT, 120s) plus the restore.
var backupProbes = enableSqliteBackup ? [
  {
    type: 'Startup'
    httpGet: {
      path: '/health'
      port: targetPort
    }
    periodSeconds: 5
    failureThreshold: 40
  }
] : []

// Get the environment ID based on which path we're using
var environmentId = useExistingEnvironment ? existingEnvironment.id : newEnvironment.id

// Container App
resource containerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: containerAppName
  location: location
  tags: tags
  identity: enableSqliteBackup ? {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${backupIdentity!.id}': {}
    }
  } : {
    type: 'None'
  }
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
          env: concat(environmentVariables, backupEnvironmentVariables)
          probes: backupProbes
        }
      ]
      terminationGracePeriodSeconds: terminationGracePeriodSeconds
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
output backupReplicaUrl string = enableSqliteBackup ? 'abs://${backupStorageAccountName}@${backupContainerName}/${backupPath}' : ''