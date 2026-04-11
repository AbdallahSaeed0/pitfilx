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

$targetDir = Join-Path $env:TEMP "pitflix-tauri-target"
New-Item -ItemType Directory -Force -Path $targetDir | Out-Null

Write-Host "VS: $vsPath"
Write-Host "CARGO_TARGET_DIR: $targetDir"
Write-Host ""
Write-Host "If build still fails with 'link: extra operand', Git's usr\bin is ahead of MSVC in PATH."
Write-Host "Temporarily rename C:\Program Files\Git\usr\bin\link.exe or use 'x64 Native Tools for VS' prompt."
Write-Host ""

$batch = "call `"$vcvars`" && set `"CARGO_TARGET_DIR=$targetDir`" && cd /d `"$uiRoot`" && npx tauri build"
$p = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", $batch -NoNewWindow -Wait -PassThru

Write-Host ""
Write-Host "Updater signing (optional for local dev, required for release updates):"
Write-Host "  Set TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH before release builds."
Write-Host "  See Pitflix.UI/UPDATER_SETUP.md"

exit $p.ExitCode
