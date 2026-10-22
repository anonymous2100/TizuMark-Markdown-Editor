# TizuMark one-click build script (called by build.cmd in the repo root).
#
# NOTE: This file is intentionally ASCII-only. Windows PowerShell 5.1 reads
# BOM-less files as ANSI, so non-ASCII text here would be garbled and can even
# break parsing. User-facing Chinese guidance lives in docs/BUILD.md.
#
# What it does:
#   1. Check toolchain (Node / Rust / MSVC), stop any running TizuMark
#   2. Optionally bump the version (9 places, via Node so no BOM corruption)
#   3. Build the three artifacts (NSIS / MSI / portable exe)
#   4. Copy artifacts to release\ and to ..\TizuMark-dist (outside the repo)
#
# Why artifacts are also copied outside the repo:
#   Measured on this machine: launching the exe from inside the project folder
#   hangs before the main window appears (only the single-instance hidden window
#   exists), while the identical exe works fine from any folder outside the
#   project. That hung process keeps the single-instance lock, so every later
#   launch silently exits - which looks exactly like "the app will not open".
#   Run the portable build from TizuMark-dist, or use the installer.
#
# Usage:
#   .\scripts\build-release.ps1                 # interactive (asks for version)
#   .\scripts\build-release.ps1 -Version 1.2.6  # set version, no prompt
#   .\scripts\build-release.ps1 -NoBump         # build current version as-is
#   .\scripts\build-release.ps1 -Sign           # sign the NSIS installer

[CmdletBinding()]
param(
  [string]$Version,
  [switch]$NoBump,
  [switch]$Sign,
  [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$logFile = Join-Path $root 'build-output.log'
$transcriptStarted = $false

function Write-Step([string]$text) {
  Write-Host ''
  Write-Host ('=' * 66) -ForegroundColor DarkCyan
  Write-Host "  $text" -ForegroundColor Cyan
  Write-Host ('=' * 66) -ForegroundColor DarkCyan
}
function Write-Ok([string]$text)   { Write-Host "  [OK]    $text" -ForegroundColor Green }
function Write-Note([string]$text) { Write-Host "  [NOTE]  $text" -ForegroundColor Yellow }
function Write-Bad([string]$text)  { Write-Host "  [FAIL]  $text" -ForegroundColor Red }

function Pause-IfNeeded {
  if ($NoPause) { return }
  Write-Host ''
  Write-Host 'Press Enter to close...' -ForegroundColor DarkGray
  try { [void](Read-Host) } catch { Start-Sleep -Seconds 5 }
}

function Find-Vcvars64 {
  $pf86 = ${env:ProgramFiles(x86)}
  $installs = @()
  if ($pf86) {
    $vswhere = Join-Path $pf86 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
      $found = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
      if ($found) { $installs += @($found) }
    }
  }
  if ($installs.Count -eq 0) {
    foreach ($base in @("$env:ProgramFiles\Microsoft Visual Studio", "${env:ProgramFiles(x86)}\Microsoft Visual Studio")) {
      if (-not $base -or -not (Test-Path $base)) { continue }
      Get-ChildItem $base -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        foreach ($y in @('2022', '2019')) {
          $c = Join-Path $_.FullName "$y\Community\VC\Auxiliary\Build\vcvars64.bat"
          if (Test-Path $c) { $installs += $c }
          $c2 = Join-Path $_.FullName "$y\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
          if (Test-Path $c2) { $installs += $c2 }
        }
      }
    }
  }
  foreach ($i in $installs) {
    $candidate = if ($i -like '*vcvars64.bat') { $i } else { Join-Path $i 'VC\Auxiliary\Build\vcvars64.bat' }
    if (Test-Path $candidate) { return $candidate }
  }
  return $null
}

try {
  Start-Transcript -Path $logFile -Force | Out-Null
  $transcriptStarted = $true
} catch { }

Write-Host ''
Write-Host '  TizuMark build' -ForegroundColor White
Write-Host "  repo: $root" -ForegroundColor DarkGray

# ------------------------------------------------------------ 1. toolchain
Write-Step '1/5  Toolchain check'

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) { Write-Bad 'node not found in PATH'; Pause-IfNeeded; exit 1 }
Write-Ok "node $((& node -v) 2>$null)"

$cargoCmd = Get-Command cargo -ErrorAction SilentlyContinue
if (-not $cargoCmd) { Write-Bad 'cargo not found in PATH (install Rust)'; Pause-IfNeeded; exit 1 }
Write-Ok "cargo $((& cargo -V) 2>$null)"

$vcvars = Find-Vcvars64
if (-not $vcvars) {
  Write-Bad 'vcvars64.bat not found (Visual Studio C++ build tools required)'
  Write-Host '         see docs/DEV_SETUP.md' -ForegroundColor DarkGray
  Pause-IfNeeded; exit 1
}
Write-Ok "MSVC: $vcvars"

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Note 'node_modules missing, running npm ci ...'
  & npm ci
  if ($LASTEXITCODE -ne 0) { Write-Bad 'npm ci failed'; Pause-IfNeeded; exit 1 }
}

# -------------------------------------------------------------- 2. version
Write-Step '2/5  Version'

$currentVersion = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "  current: v$currentVersion" -ForegroundColor White

$targetVersion = $null
if ($Version) {
  $targetVersion = $Version
} elseif (-not $NoBump) {
  Write-Host ''
  Write-Host "  Enter a new version (e.g. 1.2.6), or press Enter to keep v${currentVersion}:" -ForegroundColor Yellow
  $verInput = Read-Host '  version'
  if ($verInput -and $verInput.Trim()) { $targetVersion = $verInput.Trim() }
}

if ($targetVersion) {
  if ($targetVersion -notmatch '^\d+\.\d+\.\d+$') {
    Write-Bad "bad version format: '$targetVersion' (expected x.y.z)"
    Pause-IfNeeded; exit 1
  }
  Write-Host "  bumping to v$targetVersion ..." -ForegroundColor White
  & node (Join-Path $root 'scripts\bump-version.mjs') $targetVersion
  if ($LASTEXITCODE -ne 0) { Write-Bad 'version bump failed'; Pause-IfNeeded; exit 1 }
  $currentVersion = $targetVersion
} else {
  Write-Ok "keep v$currentVersion"
}

& node (Join-Path $root 'scripts\check-version.mjs')
if ($LASTEXITCODE -ne 0) {
  Write-Note 'version consistency check did not pass (usually the updater signature is stale) - continuing'
} else {
  Write-Ok 'version strings consistent'
}

# ------------------------------------------------------ 3. stop old process
Write-Step '3/5  Stop running TizuMark'

$killed = 0
Get-Process -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessName -match '^(tizumark|TizuMark)' } |
  ForEach-Object {
    Write-Host "    stop $($_.ProcessName) (PID $($_.Id))" -ForegroundColor DarkGray
    try { Stop-Process -Id $_.Id -Force -ErrorAction Stop; $killed++ } catch { }
  }
if ($killed -gt 0) { Write-Ok "stopped $killed process(es)"; Start-Sleep -Seconds 2 }
else { Write-Ok 'no running instance' }

# ---------------------------------------------------------------- 4. build
Write-Step '4/5  Build (Rust release, usually 2-5 minutes)'

$buildCmd = 'call "' + $vcvars + '" && cd /d "' + $root + '" && npm run build'
Write-Host '  compiling, please wait ...' -ForegroundColor DarkGray
Write-Host ''

& cmd /c $buildCmd
$buildExit = $LASTEXITCODE

if ($buildExit -ne 0) {
  Write-Bad "build failed (exit $buildExit)"
  Write-Host ''
  Write-Host '  common causes:' -ForegroundColor Yellow
  Write-Host '    - the three version fields differ (package.json / tauri.conf.json / Cargo.toml)' -ForegroundColor DarkGray
  Write-Host '    - TizuMark still running and locking the exe' -ForegroundColor DarkGray
  Write-Host "    - full log: $logFile" -ForegroundColor DarkGray
  Pause-IfNeeded; exit 1
}
Write-Ok 'build finished'

# ------------------------------------------------------ 5. archive + sign
Write-Step '5/5  Archive artifacts'

$artifacts = @(
  @{ Rel = "src-tauri\target\release\bundle\nsis\TizuMark_${currentVersion}_x64-setup.exe"; Name = "TizuMark_${currentVersion}_x64-setup.exe" },
  @{ Rel = "src-tauri\target\release\bundle\msi\TizuMark_${currentVersion}_x64_en-US.msi"; Name = "TizuMark_${currentVersion}_x64_en-US.msi" },
  @{ Rel = "src-tauri\target\release\TizuMark_${currentVersion}_x64.exe"; Name = "TizuMark_${currentVersion}_x64.exe" }
)

$releaseDir = Join-Path $root 'release'
$outsideDir = Join-Path (Split-Path -Parent $root) 'TizuMark-dist'
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
New-Item -ItemType Directory -Force -Path $outsideDir | Out-Null

$missing = @()
foreach ($a in $artifacts) {
  $src = Join-Path $root $a.Rel
  if (-not (Test-Path $src)) { $missing += $a.Name; continue }
  Copy-Item $src (Join-Path $releaseDir $a.Name) -Force
  Copy-Item $src (Join-Path $outsideDir $a.Name) -Force
  $mb = [math]::Round((Get-Item $src).Length / 1MB, 1)
  Write-Ok "$($a.Name)  ($mb MB)"
}

if ($missing.Count -gt 0) {
  Write-Bad 'these artifacts were not produced:'
  foreach ($m in $missing) { Write-Host "        - $m" -ForegroundColor Red }
  Pause-IfNeeded; exit 1
}

$keyPath = Join-Path $env:USERPROFILE '.tauri\tizu-updater.key'
if ($Sign) {
  if (-not (Test-Path $keyPath)) {
    Write-Note "signing key not found: $keyPath - skipped"
  } else {
    Write-Host ''
    Write-Host '  signing installer ...' -ForegroundColor White
    $pw = Read-Host '  key password'
    $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = $pw
    & npx tauri signer sign -f $keyPath (Join-Path $releaseDir $artifacts[0].Name)
    if ($LASTEXITCODE -ne 0) { Write-Note 'signing failed' } else { Write-Ok "signed $($artifacts[0].Name)" }
    Remove-Item Env:\TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
    Write-Host ''
    Write-Note 'remember to write the new NSIS signature into update-windows-x86_64.json'
  }
} else {
  if (Test-Path $keyPath) { Write-Note "not signed this run (pass -Sign to sign); key found: $keyPath" }
  else { Write-Note 'not signed, and no signing key on this machine - must be signed before publishing' }
}

Write-Host ''
Write-Host ('=' * 66) -ForegroundColor Green
Write-Host "  DONE  v$currentVersion" -ForegroundColor Green
Write-Host ('=' * 66) -ForegroundColor Green
Write-Host ''
Write-Host "  archive (inside repo):      $releaseDir" -ForegroundColor White
Write-Host "  run this (outside repo):    $outsideDir" -ForegroundColor Green
Write-Host ''
Write-Host '  IMPORTANT: do not double-click the portable exe inside release\.' -ForegroundColor Yellow
Write-Host '  Launching from inside the project folder hangs before the main window' -ForegroundColor DarkGray
Write-Host '  appears, and that hung process keeps the single-instance lock so later' -ForegroundColor DarkGray
Write-Host '  launches exit silently - which looks like "the app will not open".' -ForegroundColor DarkGray
Write-Host '  Use the installer, or run it from the folder above.' -ForegroundColor DarkGray
Write-Host ''
Write-Host "  build log: $logFile" -ForegroundColor DarkGray

if ($transcriptStarted) { try { Stop-Transcript | Out-Null } catch { } }
Pause-IfNeeded
exit 0
