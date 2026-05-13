# Run Tauri release build inside MSVC environment so link.exe is Microsoft's, not GNU (Git/MSYS).
# Usage from Pitflix.UI:  npm run tauri:build:win
$ErrorActionPreference = "Stop"
$uiRoot = Split-Path -Parent $PSScriptRoot
Set-Location $uiRoot

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path $vswhere)) {
  Write-Error @"
Visual Studio vswhere.exe not found.
Install Visual Studio 2022 or 'Build Tools for Visual Studio' with:
  Workload -> Desktop development with C++
"@
}

$vsPath = & $vswhere -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
  -property installationPath
if (-not $vsPath) {
  Write-Error @"
MSVC (VC.Tools.x86.x64) not found. Open Visual Studio Installer and add the C++ workload.
"@
}

$vcvars = Join-Path $vsPath "VC\Auxiliary\Build\vcvars64.bat"
if (-not (Test-Path $vcvars)) {
  Write-Error "Missing: $vcvars"
}

# Project-local target dir avoids flaky writes under %TEMP% (short paths / cleanup races).
$targetDir = Join-Path $uiRoot ".cargo-tauri-target"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

Write-Host "VS: $vsPath"
Write-Host "CARGO_TARGET_DIR: $targetDir"
Write-Host ""
Write-Host "If build still fails with 'link: extra operand', Git's usr\bin is ahead of MSVC in PATH."
Write-Host "Temporarily rename C:\Program Files\Git\usr\bin\link.exe or use 'x64 Native Tools for VS' prompt."
Write-Host ""

# npm runs this script in a fresh PowerShell, so signing must reach the Node/tauri-cli process.
# tauri-cli reads only TAURI_SIGNING_PRIVATE_KEY. If that value is a path to an existing file, it loads the key from disk.
# (TAURI_SIGNING_PRIVATE_KEY_PATH is not read by the bundler — do not rely on it.)
if (
  [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY) -and
  -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH) -and
  (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH)
) {
  $env:TAURI_SIGNING_PRIVATE_KEY = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
}

# Keeps `createUpdaterArtifacts: false` explicit (in-app updates use GitHub Releases installers, not Tauri signed bundles).
$noSigMerge = Join-Path $uiRoot "src-tauri\tauri.bundle.nosig.json"
$configMerge = ""
if (Test-Path $noSigMerge) {
  $configMerge = '--config "' + $noSigMerge + '"'
}

$batchParts = @(
  ('call "' + $vcvars + '"'),
  ('set "CARGO_TARGET_DIR=' + $targetDir + '"')
)
$batchParts += ('cd /d "' + $uiRoot + '"')
$batchParts += ('npx tauri build ' + $configMerge.Trim())
$batch = ($batchParts | Where-Object { $_.Length -gt 0 }) -join ' && '
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $batch -NoNewWindow -Wait -PassThru

Write-Host ""
Write-Host "Ship Windows builds via GitHub Releases (.exe). Users update from Check for updates (GitHub API + installer download)."

exit $p.ExitCode
