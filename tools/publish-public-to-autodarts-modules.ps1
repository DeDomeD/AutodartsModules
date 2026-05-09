<#
.SYNOPSIS
  Baut den Public-Extension-Stand (wie Public-ZIP) und schiebt die Dateien ins Repo AutodartsModules.

.DESCRIPTION
  Entspricht build-public-extension-zip.ps1 (WIP-Module raus, Patches), aber ohne ZIP:
  Arbeitskopie -> Klon von https://github.com/DeDomeD/AutodartsModules -> git commit -> git push.

.PARAMETER CloneDir
  Lokaler Klon-Pfad. Standard: <Workspace>/AutodartsModules (neben Autodarts-Modules_Chrome-Erweiterung).

.PARAMETER RepoUrl
  Remote-URL zum Klonen (HTTPS).
#>
[CmdletBinding()]
param(
  [string] $ExtensionRoot = "",
  [string] $RepoUrl = "https://github.com/DeDomeD/AutodartsModules.git",
  [string] $CloneDir = ""
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
$workspaceRoot = Split-Path -Parent $ExtensionRoot
if (-not $CloneDir) {
  $CloneDir = Join-Path $workspaceRoot "AutodartsModules"
}

function Test-LineReferencesRedModule([string] $Line) {
  foreach ($id in $RedModules) {
    if ($Line -match [regex]::Escape("Modules/$id/")) { return $true }
  }
  return $false
}

function Remove-RedModuleFolders([string] $Root) {
  foreach ($id in $RedModules) {
    $p = Join-Path $Root "Modules\$id"
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

function Ensure-GitignoreDocs([string] $RepoRoot) {
  $gi = Join-Path $RepoRoot ".gitignore"
  $lines = @(
    "# OS",
    ".DS_Store",
    "Thumbs.db",
    "",
    "# Docs (nicht tracken)",
    "Main/docs/",
    "docs/",
    "",
    "# Node",
    "node_modules/",
    "",
    "# ZIP-Artefakte",
    "*.zip"
  )
  if (-not (Test-Path -LiteralPath $gi)) {
    Set-Content -LiteralPath $gi -Value ($lines -join "`n") -Encoding utf8
    return
  }
  $existing = Get-Content -LiteralPath $gi -Raw -Encoding UTF8
  if ($existing -notmatch "(?m)^Main/docs/?\s*$" -and $existing -notmatch "(?m)^docs/?\s*$") {
    Add-Content -LiteralPath $gi -Value "`n# Docs (nicht tracken)`nMain/docs/`ndocs/`n" -Encoding utf8
  }
}

# --- Klon vorbereiten
if (Test-Path -LiteralPath $CloneDir) {
  if (-not (Test-Path -LiteralPath (Join-Path $CloneDir ".git"))) {
    throw "Pfad existiert, ist aber kein Git-Repo: $CloneDir"
  }
  Write-Host "Git pull in $CloneDir ..."
  Push-Location $CloneDir
  try {
    git pull --ff-only
  } finally {
    Pop-Location
  }
} else {
  Write-Host "Klone nach $CloneDir ..."
  $parent = Split-Path $CloneDir
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
  git clone $RepoUrl $CloneDir
}

# Alles außer .git löschen, dann frische Public-Kopie
Write-Host "Leere Arbeitsbaum (ohne .git) ..."
Get-ChildItem -LiteralPath $CloneDir -Force | Where-Object { $_.Name -ne ".git" } | ForEach-Object {
  Remove-Item -LiteralPath $_.FullName -Recurse -Force
}

Write-Host "Kopiere Extension nach $CloneDir ..."
Get-ChildItem -LiteralPath $ExtensionRoot -Force | ForEach-Object {
  if ($_.Name -eq ".git") { return }
  $dest = Join-Path $CloneDir $_.Name
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Recurse -Force
}

Remove-RedModuleFolders $CloneDir
Patch-BackgroundJs (Join-Path $CloneDir "Main\core\background.js")
Patch-PopupHtml (Join-Path $CloneDir "Main\popup.html")
Patch-ManifestJson (Join-Path $CloneDir "manifest.json")

Ensure-GitignoreDocs $CloneDir

$verObj = Get-Content -LiteralPath (Join-Path $CloneDir "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$ver = [string]$verObj.version

Push-Location $CloneDir
try {
  git add -A
  $status = git status --porcelain
  if (-not $status) {
    Write-Host "Nichts zu committen (keine Aenderungen)."
    return
  }
  git commit -m "release: public extension v$ver (no WIP modules)"
  git push origin HEAD
} finally {
  Pop-Location
}

Write-Host "Fertig. Version: $ver -> $RepoUrl"
