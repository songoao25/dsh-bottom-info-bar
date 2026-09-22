#!/usr/bin/env bash
# Bottom Info Bar — 一键卸载脚本
# 用法：./uninstall.sh [--profile <name>]
#       卸载插件本体；ChatGPT 订阅由独立插件 dsh-chatgpt-subscription 负责，不在本脚本清理范围。
set -euo pipefail

PROFILE="web"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    -h|--help) echo "用法: ./uninstall.sh [--profile <name>]"; exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

BUNDLE_NAME="dsh-bottom-info-bar"

command -v dsh >/dev/null 2>&1 || { echo "错误：未找到 dsh CLI"; exit 1; }
command -v pnpm >/dev/null 2>&1 || { echo "错误：未找到 pnpm"; exit 1; }

echo "==> 从 profile '$PROFILE' 卸载 dsh-bottom-info-bar"
if ! dsh plugin --profile "$PROFILE" remove "$BUNDLE_NAME"; then
  echo "  ⚠ 插件移除失败（可能已卸载或 profile 不存在）"
  exit 1
fi

# v1.15.0 配套：把 install.sh 写进 dsh.profile.bundles 的条目也摘掉（避免遗留死 bundle id 触发宿主启动错）
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
    const idx = bundles.indexOf(bundle);
    if (idx !== -1) {
      bundles.splice(idx, 1);
      profile.bundles = bundles;
      parsed.dsh = parsed.dsh || {}; parsed.dsh.profile = profile;
      try {
        fs.writeFileSync(path, JSON.stringify(parsed, null, 2) + '\n');
        console.log('  + 已从 dsh.profile.bundles 摘除 ' + bundle);
      } catch (err) {
        console.error('  ! bundles 写入失败：' + err.message);
      }
    }
  "
fi

echo
echo "✔ 卸载完成。"
echo "  下一步：重启 DeepSeek Harness（dsh $PROFILE），原生统计栏自动恢复，无残留。"
