# Bottom Info Bar — Windows 一键安装脚本
# 用法：.\install.ps1 [-Profile <name>]   （默认安装到 web profile；桌面客户端用 -Profile desktop）
param([string]$Profile = 'web')

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path

foreach ($cmd in @('dsh', 'pnpm', 'node')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "错误：未找到 $cmd（dsh 请先安装 DeepSeek Harness；pnpm 可用 npm i -g pnpm 安装）"
    exit 1
  }
}

Write-Host "==> 构建插件产物（lib/ 由 build 生成并已入库；这里重建一次，保证跑的和 src/ 一致）"
& node (Join-Path $Root 'scripts\build.mjs')
if ($LASTEXITCODE -ne 0) { Write-Error '错误：插件构建失败'; exit 1 }

Write-Host "==> 安装 dsh-bottom-info-bar 到 profile '$Profile'"
& dsh plugin --profile $Profile add $Root
if ($LASTEXITCODE -ne 0) { Write-Error '错误：插件安装失败'; exit 1 }

Write-Host ''
Write-Host '✔ 安装完成。'
Write-Host "  下一步：重启 DeepSeek Harness 后，底部信息栏自动出现，无需手动加载。"
Write-Host "  验证：dsh --profile $Profile --dump-config | Select-String dsh-bottom-info-bar"
Write-Host "  卸载：.\uninstall.ps1 -Profile $Profile"
