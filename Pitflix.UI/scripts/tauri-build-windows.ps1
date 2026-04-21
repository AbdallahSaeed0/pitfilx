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
$localKey = Join-Path $uiRoot "src-tauri\.tauri-updater.key"
if (
  [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY) -and
  -not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY_PATH) -and
  (Test-Path -LiteralPath $env:TAURI_SIGNING_PRIVATE_KEY_PATH)
) {
  $env:TAURI_SIGNING_PRIVATE_KEY = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
}
$signPrefix = ""
$hasSigning =
  (Test-Path -LiteralPath $localKey) -or
  (-not [string]::IsNullOrWhiteSpace($env:TAURI_SIGNING_PRIVATE_KEY))

if (Test-Path -LiteralPath $localKey) {
  $env:TAURI_SIGNING_PRIVATE_KEY = $localKey
  $signPrefix = 'set "TAURI_SIGNING_PRIVATE_KEY=' + $localKey + '"'
  Write-Host "Using updater signing key from: $localKey (TAURI_SIGNING_PRIVATE_KEY set to this path)"
  Write-Host ""
}
elseif ($hasSigning) {
  Write-Host "Using TAURI_SIGNING_PRIVATE_KEY from environment."
  Write-Host ""
}

$noSigMerge = Join-Path $uiRoot "src-tauri\tauri.bundle.nosig.json"
$configMerge = ""
if (-not $hasSigning) {
  if (Test-Path $noSigMerge) {
    $configMerge = '--config "' + $noSigMerge + '"'
    Write-Host 'No updater signing key found - merging tauri.bundle.nosig.json (no .sig / updater artifacts).'
    Write-Host 'For signed updates: add src-tauri\.tauri-updater.key or set TAURI_SIGNING_PRIVATE_KEY. See UPDATER_SETUP.md'
    Write-Host ""
  }
}

$batchParts = @(
  ('call "' + $vcvars + '"'),
  ('set "CARGO_TARGET_DIR=' + $targetDir + '"')
)
if ($signPrefix) {
  $batchParts += $signPrefix
}
$batchParts += ('cd /d "' + $uiRoot + '"')
$batchParts += ('npx tauri build ' + $configMerge.Trim())
$batch = ($batchParts | Where-Object { $_.Length -gt 0 }) -join ' && '
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $batch -NoNewWindow -Wait -PassThru

Write-Host ""
Write-Host "Updater signing (optional for local dev, required for release updates):"
Write-Host "  Set TAURI_SIGNING_PRIVATE_KEY (inline key or path to key file) before release builds."
Write-Host "  See Pitflix.UI/UPDATER_SETUP.md"

exit $p.ExitCode
