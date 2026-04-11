# Pitflix Windows release: runs the Tauri bundle (NSIS .exe + WiX .msi) and copies artifacts into installers\dist\<version>.
#
# Prerequisites: same as Pitflix.UI npm run tauri:build:win (Visual Studio C++ build tools, Rust, Node).
#
# Usage (from repo root):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\installers\build-windows-installer.ps1
#
# Stage only (skip build — use after a successful tauri:build:win):
#   powershell -NoProfile -ExecutionPolicy Bypass -File .\installers\build-windows-installer.ps1 -StageOnly

param(
    [switch] $StageOnly
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$uiRoot = Join-Path $repoRoot "Pitflix.UI"
$confPath = Join-Path $uiRoot "src-tauri\tauri.conf.json"
if (-not (Test-Path $confPath)) {
    Write-Error "Missing $confPath"
}

$conf = Get-Content $confPath -Raw | ConvertFrom-Json
$version = $conf.version
if (-not $version) {
    Write-Error "Could not read version from tauri.conf.json"
}

$tempBundleRoot = Join-Path $env:TEMP "pitflix-tauri-target\release\bundle"
$localBundleRoot = Join-Path $uiRoot "src-tauri\target\release\bundle"

if (-not $StageOnly) {
    if (-not (Test-Path $uiRoot)) {
        Write-Error "Missing UI folder: $uiRoot"
    }
    Push-Location $uiRoot
    try {
        npm run tauri:build:win
        if ($LASTEXITCODE -ne 0) {
            exit $LASTEXITCODE
        }
    }
    finally {
        Pop-Location
    }
}

$bundleRoot = $null
foreach ($c in @($tempBundleRoot, $localBundleRoot)) {
    if (Test-Path $c) {
        $bundleRoot = $c
        break
    }
}
if (-not $bundleRoot) {
    Write-Error @"
No bundle folder found. Expected one of:
  $tempBundleRoot
  $localBundleRoot
Run a full build first (omit -StageOnly), or build from Pitflix.UI with: npm run tauri:build:win
"@
}

$outDir = Join-Path $repoRoot "installers\dist\$version"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$copied = @()
Get-ChildItem -Path $bundleRoot -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    if ($_.Extension -match '^\.(exe|msi)$') {
        $dest = Join-Path $outDir $_.Name
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
        $copied += $dest
    }
}

if ($copied.Count -eq 0) {
    Write-Warning "No .exe or .msi files found under $bundleRoot"
}
else {
    Write-Host ""
    Write-Host "Staged $($copied.Count) installer(s) to:"
    Write-Host "  $outDir"
    foreach ($p in $copied) {
        Write-Host "  - $(Split-Path -Leaf $p)"
    }
}
