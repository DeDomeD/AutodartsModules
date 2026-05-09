$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js wurde nicht gefunden. Bitte Node.js installieren."
  exit 1
}

Write-Host "Starte Autodarts Modules Log Writer..."
node .\log-writer.js
