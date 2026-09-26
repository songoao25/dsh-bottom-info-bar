# Bottom Info Bar — Windows 一键卸载脚本
# 用法：.\uninstall.ps1 [-Profile <name>]
#       卸载插件本体；ChatGPT 订阅由独立插件 dsh-chatgpt-sub 负责，不在本脚本清理范围。
param([string]$Profile = 'web')

$ErrorActionPreference = 'Stop'

foreach ($cmd in @('dsh', 'pnpm')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Error "错误：未找到 $cmd"; exit 1
  }
}

Write-Host "==> 从 profile '$Profile' 卸载 dsh-bottom-info-bar"
& dsh plugin --profile $Profile remove dsh-bottom-info-bar
if ($LASTEXITCODE -ne 0) {
  Write-Host '  ⚠ 插件移除失败（可能已卸载或 profile 不存在）'
  exit 1
}

Write-Host ''
Write-Host '✔ 卸载完成。'
Write-Host '  下一步：重启 DeepSeek Harness，原生统计栏自动恢复，无残留。'
