#!/usr/bin/env bash
# Bottom Info Bar — 一键安装脚本
# 用法：./install.sh [--profile <name>]   （默认安装到 web profile）
set -euo pipefail

PROFILE="web"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    -h|--help) echo "用法: ./install.sh [--profile <name>]"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLUGIN_DIR="$ROOT/plugin"
BUNDLE_NAME="dsh-bottom-info-bar"

command -v dsh >/dev/null 2>&1 || { echo "错误：未找到 dsh CLI（请先安装 DeepSeek Harness）"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "错误：未找到 pnpm（安装：npm i -g pnpm 或 corepack enable）"; exit 1; }

echo "==> 构建插件产物（plugin/lib/ 由 build 生成，不入 git）"
node "$PLUGIN_DIR/scripts/build.mjs" || { echo "错误：插件构建失败"; exit 1; }

echo "==> 安装 dsh-bottom-info-bar 到 profile '$PROFILE'"
dsh plugin --profile "$PROFILE" add "$PLUGIN_DIR" || { echo "错误：插件添加失败"; exit 1; }

# v1.15.0 补漏（用户实测：仅 pnpm add 不会自动加入 bundles，重启后插件仍不加载）。
# 必须在 dsh.profile.bundles 里追加本插件，DSH 才会把它装载进宿主。
# 复用 dsh plugin add 已经做好的 dependencies + node_modules 软链；这里只补 manifest 缺口。
# 在 manifest 缺失 / 解析失败时静默跳过（与 dsh plugin add 自己的兜底一致），保留主流程成功。
DSH_HOME_DIR="${DSH_HOME:-$HOME/.dsh}"
PROFILE_MANIFEST="$DSH_HOME_DIR/profiles/$PROFILE/package.json"
if [[ -f "$PROFILE_MANIFEST" ]]; then
  node -e "
    const fs = require('node:fs');
    const path = '$PROFILE_MANIFEST';
    const bundle = '$BUNDLE_NAME';
    let raw, parsed = {};
    try { raw = fs.readFileSync(path, 'utf8'); parsed = JSON.parse(raw); }
    catch (err) { console.error('  ! bundles 跳过：' + path + ' 解析失败：' + err.message); process.exit(0); }
    const profile = parsed.dsh && parsed.dsh.profile ? parsed.dsh.profile : {};
    const bundles = Array.isArray(profile.bundles) ? profile.bundles : [];
    if (bundles.indexOf(bundle) === -1) {
      bundles.push(bundle);
      profile.bundles = bundles;
      parsed.dsh = parsed.dsh || {}; parsed.dsh.profile = profile;
      try {
        fs.writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n');
        console.log('  + 已把 ' + bundle + ' 追加到 dsh.profile.bundles');
      } catch (err) {
        console.error('  ! bundles 写入失败：' + err.message);
      }
    } else {
      console.log('  = ' + bundle + ' 已在 dsh.profile.bundles，无需重复追加');
    }
  "
fi

echo
echo "✔ 安装完成。"
echo "  下一步：重启 DeepSeek Harness（dsh $PROFILE）后，底部信息栏自动出现，无需手动加载。"
echo "  验证：dsh --profile $PROFILE --dump-config | grep dsh-bottom-info-bar"
echo "  卸载：./uninstall.sh --profile $PROFILE"
