$ErrorActionPreference = 'Stop'
$localRoot = Join-Path $PSScriptRoot '..\.local'
$configPath = Join-Path $localRoot 'clerk-development.json'
$publishablePath = Join-Path $localRoot 'clerk-publishable.json'

if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
  throw 'Create .local/clerk-development.json with the matching Drezivo-internal Clerk Development keys and operator organization ID, then run this setup again.'
}

try {
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
} catch {
  throw 'The local Clerk configuration is not valid JSON. Check .local/clerk-development.json.'
}

if ($config.secretKey -isnot [string] -or -not $config.secretKey.StartsWith('sk_test_')) {
  throw 'The local Clerk secretKey must be a Clerk Development key beginning with sk_test_.'
}
if ($config.publishableKey -isnot [string] -or -not $config.publishableKey.StartsWith('pk_test_')) {
  throw 'The local Clerk publishableKey must be a Clerk Development key beginning with pk_test_.'
}
if ($config.operatorOrganizationId -isnot [string] -or -not $config.operatorOrganizationId.StartsWith('org_')) {
  throw 'The local Clerk operatorOrganizationId must be the Internal Operator organization ID from that same Development instance.'
}

# The web container receives only the publishable key. The Clerk secret remains mounted only
# into the API container through the separate clerk-development Compose secret.
@{ publishableKey = $config.publishableKey } |
  ConvertTo-Json -Compress |
  Set-Content -LiteralPath $publishablePath -NoNewline -Encoding ASCII

Write-Output 'Local Clerk Development configuration is ready. The API secret stays out of the web container.'
