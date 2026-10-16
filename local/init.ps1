$ErrorActionPreference = 'Stop'
$localRoot = Join-Path $PSScriptRoot '..\.local'
New-Item -ItemType Directory -Force -Path $localRoot | Out-Null
function New-LocalSecret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes); return [Convert]::ToBase64String($bytes) } finally { $rng.Dispose() }
}
$credentialFile = Join-Path $localRoot 'credentials.json'
if (-not (Test-Path -LiteralPath $credentialFile)) {
  $credentials = @{ databasePassword = (New-LocalSecret); runtimePassword = (New-LocalSecret); signingSecret = (New-LocalSecret) }
  $credentials | ConvertTo-Json | Set-Content -LiteralPath $credentialFile -Encoding ASCII
  $credentials.databasePassword | Set-Content -LiteralPath (Join-Path $localRoot 'postgres-password') -NoNewline -Encoding ASCII
}
Write-Output 'Local Docker credentials are ready. No hosted credentials were loaded.'
