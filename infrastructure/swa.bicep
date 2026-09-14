// Azure Static Web Apps deployment for SPARQL Query Library Frontend
// This template is environment-agnostic - configure via parameters

@description('Azure region for the Static Web App (limited regions supported)')
param location string = 'eastasia'

@description('Name of the Static Web App')
param staticWebAppName string

@description('SKU for the Static Web App')
@allowed([
  'Free'
  'Standard'
])
param sku string = 'Standard'

@description('Tags to apply to all resources')
param tags object = {}

@description('App settings as key-value pairs')
param appSettings object = {}

@description('Optional: API Base URL to inject into app settings as NUXT_PUBLIC_API_BASE_URL')
param apiBaseUrl string = ''

@description('Custom domain name (optional, requires Standard SKU)')
param customDomain string = ''

// Static Web App
resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: staticWebAppName
  location: location
  tags: tags
  sku: {
    name: sku
    tier: sku
  }
  properties: {
    repositoryUrl: '' // Empty for manual deployments via CLI
    branch: ''        // Empty for manual deployments via CLI
    buildProperties: {
      skipGithubActionWorkflowGeneration: true
    }
    stagingEnvironmentPolicy: 'Enabled'
    allowConfigFileUpdates: true
    provider: 'None'
  }
}

// Merge provided appSettings with the optional apiBaseUrl
var finalAppSettings = empty(apiBaseUrl) ? appSettings : union(appSettings, {
  NUXT_PUBLIC_API_BASE_URL: apiBaseUrl
})

// App Settings (if any)
resource staticWebAppSettings 'Microsoft.Web/staticSites/config@2022-09-01' = if (!empty(finalAppSettings)) {
  parent: staticWebApp
  name: 'appsettings'
  properties: finalAppSettings
}

// Custom Domain (if provided and using Standard SKU)
resource customDomainResource 'Microsoft.Web/staticSites/customDomains@2022-09-01' = if (!empty(customDomain) && sku == 'Standard') {
  parent: staticWebApp
  name: customDomain
  properties: {}
}

// Outputs
output staticWebAppId string = staticWebApp.id
output staticWebAppName string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
output staticWebAppUrl string = 'https://${staticWebApp.properties.defaultHostname}'
output deploymentToken string = staticWebApp.listSecrets().properties.apiKey