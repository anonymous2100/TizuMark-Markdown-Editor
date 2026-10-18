# ============================================================
# TizuMark 一键打包脚本（Windows）
#
# 用法：
#   1) 双击 scripts\build-package.bat（推荐，自动保持窗口打开）
#   2) 终端手动执行：powershell -ExecutionPolicy Bypass -File .\scripts\build-package.ps1 [-NoPause]
#
# 流程：环境检查 → 渲染层构建 → Tauri Release 打包 → 汇总产物并打开目录
#
# 可选环境变量（自动更新签名，见 docs/DEV_SETUP.md）：
#   $env:TAURI_SIGNING_PRIVATE_KEY       —— minisign 私钥（一行）
#   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD —— 私钥口令
#   $env:TAURI_SIGNING_PRIVATE_KEY_PATH  —— 私钥文件路径（与上行二选一）
# 不配置也能打包成功，仅自动更新产物不带 minisign 签名。
# ============================================================
[CmdletBinding()]
param(
    # 构建完成后关闭窗口（双击运行时不传此参数）
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Ok($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Info($msg) { Write-Host "  $msg" -ForegroundColor Cyan }
function Fail($msg) { Write-Host "  [FAIL] $msg" -ForegroundColor Red }
function Step($t)   { Write-Host ""; Write-Host "=== $t ===" -ForegroundColor Cyan }

function Exit-WithPause([int]$code) {
    if (-not $NoPause) { Read-Host "`nPress Enter to close this window" | Out-Null }
    exit $code
}

# ---- 0/3 环境检查 ----
Step "0/3 环境检查"
$allOk = $true
foreach ($tool in @('node', 'npm', 'cargo')) {
    $cmd = Get-Command $tool -ErrorAction SilentlyContinue
    if ($cmd) { Ok "$tool => $($cmd.Source)" }
    else { Fail "未找到 $tool（请先安装 Node.js LTS 与 Rust 工具链，见 docs/DEV_SETUP.md）"; $allOk = $false }
}
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
Info "TizuMark v$version"
if (-not $allOk) { Exit-WithPause 1 }

# ---- 1/3 构建渲染层 ----
Step "1/3 构建渲染层（esbuild + 前端资源）"
npm run build:renderer
if ($LASTEXITCODE -ne 0) { Fail "build:renderer 失败"; Exit-WithPause 1 }
npm run build-frontend
if ($LASTEXITCODE -ne 0) { Fail "build-frontend 失败"; Exit-WithPause 1 }
Ok "渲染层构建完成"

# ---- 2/3 Tauri 打包 ----
Step "2/3 Tauri Release 打包（Rust 编译，首次构建可能需 10 分钟以上，请耐心等待）"
Info "命令等价于 npm run build 的核心步骤（跳过重复构建渲染层）"
$tauriCli = Join-Path $root "node_modules\.bin\tauri.cmd"
if (-not (Test-Path $tauriCli)) { $tauriCli = 'tauri' }
& $tauriCli build
if ($LASTEXITCODE -ne 0) { Fail "tauri build 失败（若是 link.exe 找不到，请先跑 scripts\fix-moved-toolchain.ps1）"; Exit-WithPause 1 }

# postbuild 钩子（package.json）会自动把 tizumark.exe 复制为 TizuMark_<version>_x64.exe
# 但 npx 直接调用 tauri 不触发 npm postbuild，这里显式补一次
$releaseDir = Join-Path $root "src-tauri\target\release"
$exe = Join-Path $releaseDir "tizumark.exe"
$versioned = Join-Path $releaseDir "TizuMark_$($version)_x64.exe"
if ((Test-Path $exe) -and -not (Test-Path $versioned)) {
    Copy-Item $exe $versioned -Force
}

# ---- 3/3 汇总产物 ----
Step "3/3 打包产物"
$bundleDir = Join-Path $releaseDir "bundle"
$nsisDir = Join-Path $bundleDir "nsis"
$msiDir  = Join-Path $bundleDir "msi"
$artifacts = @()
if (Test-Path $nsisDir) {
    $artifacts += Get-ChildItem $nsisDir -File
    Info "NSIS 安装包目录：$nsisDir"
}
if (Test-Path $msiDir) {
    $artifacts += Get-ChildItem $msiDir -File
    Info "MSI 目录：$msiDir"
}
if (Test-Path $versioned) { $artifacts += Get-Item $versioned }

if ($artifacts.Count -eq 0) { Fail "未找到任何产物"; Exit-WithPause 1 }
Write-Host ""
foreach ($f in $artifacts) {
    Write-Host ("  {0,-50} {1,10:N1} MB" -f $f.Name, ($f.Length / 1MB))
}
Write-Host ""

# 未配置更新签名私钥时给出提示（不阻断）
if (-not $env:TAURI_SIGNING_PRIVATE_KEY -and -not $env:TAURI_SIGNING_PRIVATE_KEY_PATH) {
    Info "提示：未配置 TAURI_SIGNING_PRIVATE_KEY，自动更新产物未做 minisign 签名（本地安装包不受影响）"
}

Ok "打包完成，即将打开产物目录…"
Start-Sleep -Seconds 2
try { Invoke-Item $bundleDir } catch { Info "手动打开：$bundleDir" }

Exit-WithPause 0
