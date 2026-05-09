<#
.SYNOPSIS
  Kopiert die Chrome-Extension, entfernt nur die "roten" Nav-Module (WIP) und packt eine ZIP.

.DESCRIPTION
  Rot = MODULE_NAV_WIP in Main/popup.js (overlay, caller, playercam, macros, liga, games).
  Alle anderen Dateien/Ordner bleiben; Referenzen in background.js, Main/popup.html und manifest.json werden bereinigt.

  Standard-Ausgabe (-OutDir): Elternordner vom Extension-Root (eine Ebene darüber).

  Bei Änderung der WIP-Liste popup.js und dieses Skript synchron halten.
#>
[CmdletBinding()]
param(
  [string] $ExtensionRoot = "",
  [string] $OutDir = ""
)

$ErrorActionPreference = "Stop"

$RedModules = @(
  "overlay",
  "caller",
  "playercam",
  "macros",
  "liga",
  "games"
)

if (-not $ExtensionRoot) {
  $ExtensionRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}
if (-not $OutDir) {
  # Standard: eine Ordner-Ebene über dem Extension-Root (z. B. Workspace-Root statt im Extension-Ordner)
  $OutDir = Split-Path -Parent $ExtensionRoot
}

function Test-LineReferencesRedModule([string] $Line) {
  foreach ($id in $RedModules) {
    if ($Line -match [regex]::Escape("Modules/$id/")) { return $true }
  }
  return $false
}

function Remove-RedModuleFolders([string] $StagingRoot) {
  foreach ($id in $RedModules) {
    $p = Join-Path $StagingRoot "Modules\$id"
    if (Test-Path -LiteralPath $p) {
      Remove-Item -LiteralPath $p -Recurse -Force
    }
  }
}

function Write-Utf8NoBom([string] $Path, [string[]] $Lines) {
  $enc = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllLines($Path, $Lines, $enc)
}

function Patch-BackgroundJs([string] $Path) {
  $lines = Get-Content -LiteralPath $Path -Encoding UTF8
  $out = foreach ($line in $lines) {
    if (Test-LineReferencesRedModule $line) { continue }
    $line
  }
  Write-Utf8NoBom $Path @($out)
}

function Patch-PopupHtml([string] $Path) {
  $lines = Get-Content -LiteralPath $Path -Encoding UTF8
  $out = foreach ($line in $lines) {
    if ($line -match '<script\s+src="\.\./Modules/') {
      if (Test-LineReferencesRedModule $line) { continue }
    }
    $line
  }
  Write-Utf8NoBom $Path @($out)
}

function Patch-ManifestJson([string] $Path) {
  $raw = Get-Content -LiteralPath $Path -Raw -Encoding UTF8
  $json = $raw | ConvertFrom-Json
  if ($json.content_scripts -and $json.content_scripts.Count -gt 0) {
    $entry = $json.content_scripts[0]
    if ($entry.js) {
      $filtered = @($entry.js | Where-Object {
          $j = [string]$_
          $drop = $false
          foreach ($id in $RedModules) {
            if ($j -like "*Modules/$id/*") { $drop = $true; break }
          }
          -not $drop
        })
      $entry.js = $filtered
    }
  }
  $text = $json | ConvertTo-Json -Depth 30
  $enc = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $text + "`n", $enc)
}

$stamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
$tempBase = Join-Path $env:TEMP "adm-public-ext-$stamp"
$staging = Join-Path $tempBase "Autodarts-Modules_Chrome-Erweiterung"

New-Item -ItemType Directory -Path $staging -Force | Out-Null

Get-ChildItem -LiteralPath $ExtensionRoot -Force | ForEach-Object {
  if ($_.Name -eq ".git") { return }
  $dest = Join-Path $staging $_.Name
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}

Remove-RedModuleFolders $staging
Patch-BackgroundJs (Join-Path $staging "Main\core\background.js")
Patch-PopupHtml (Join-Path $staging "Main\popup.html")
Patch-ManifestJson (Join-Path $staging "manifest.json")

$verObj = Get-Content -LiteralPath (Join-Path $staging "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = [string]$verObj.version
$zipName = "Autodarts-Modules_Chrome-Erweiterung_Public_v{0}_{1}.zip" -f $ver, $stamp
$zipPath = Join-Path $OutDir $zipName

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $zipPath -Force
Remove-Item -LiteralPath $tempBase -Recurse -Force

Write-Output $zipPath
