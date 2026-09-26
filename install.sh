#!/usr/bin/env bash
# Bottom Info Bar — 一键安装脚本
# 用法：./install.sh [--profile <name>]   （默认安装到 web profile）
set -euo pipefail

PROFILE="web"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      if [[ $# -lt 2 || -z "${2:-}" || "$2" == -* ]]; then
        echo "错误：--profile 需要一个 profile 名称"
        exit 1
      fi
      PROFILE="$2"; shift 2 ;;
    -h|--help) echo "用法: ./install.sh [--profile <name>]"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

command -v dsh >/dev/null 2>&1 || { echo "错误：未找到 dsh CLI（请先安装 DeepSeek Harness）"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "错误：未找到 pnpm（安装：npm i -g pnpm 或 corepack enable）"; exit 1; }

echo "==> 构建插件产物（lib/ 由 build 生成并已入库；这里重建一次，保证跑的和 src/ 一致）"
node "$ROOT/scripts/build.mjs" || { echo "错误：插件构建失败"; exit 1; }

echo "==> 安装 dsh-bottom-info-bar 到 profile '$PROFILE'"
dsh plugin --profile "$PROFILE" add "$ROOT"

echo
echo "✔ 安装完成。"
echo "  下一步：重启 DeepSeek Harness（dsh $PROFILE）后，底部信息栏自动出现，无需手动加载。"
echo "  验证：dsh --profile $PROFILE --dump-config | grep dsh-bottom-info-bar"
echo "  卸载：./uninstall.sh --profile $PROFILE"
