# v1.9.0 部署记录（DEPLOY）

- 日期：2026-08-28
- 产品：DSH 底部信息栏插件（dsh-bottom-info-bar）

## 部署方式
本产品是 DSH 插件，无独立服务端；「部署」= 把新版本插件安装到用户 DSH 的 web profile：
1. 仓库合并发布后，运行 `./install.sh`（默认装到 web profile；可用 `--profile` 覆盖）重新安装插件包
2. 用户重启 `dsh web`（插件在宿主启动时组合，刷新页面不够）
3. 新代码随宿主生效；客户端轮询节奏不变，无需其他运维动作

## 冒烟测试（发布前由门禁负责人执行）
- `(cd plugin && npm run build)` → OK（lib/index.js + lib/constants.js + lib/client.js）
- `node tests/run-all.mjs` → 21/21 套件全绿（test-field-config-client 82 项、test-field-settings 52 项、test-usage-compaction 32 项等）
- 构建产物 = 源码同源（constants 锚点注入 + 双源拼接，构建脚本断言提取成功）

## 部署结果（2026-08-28 已执行）
- `./install.sh` 执行：构建 → `dsh plugin --profile web add` → ✔ 安装完成
- 官方验证：`dsh --profile web --dump-config | grep -c dsh-bottom-info-bar` = **3 命中**（插件已合成进 web 配置）
- lib 产物含 v1.9.0 标记：lib/client.js 含「信息底栏」设置页注册（24 处引用）、lib/constants.js 含 FIELD_GROUP_ORDER 分组注入
- 待生效：用户重启 `dsh web`（插件在宿主启动时组合；新版本代码即时加载，旧账本数据自动兼容）

## 用户真机验收清单（发布后执行，7 项）
1. 设置 → 「信息底栏」：28 个字段全部可开关（含服务商·模型）；原生/插件两组、原生在前、出现条件说明正确
2. 全关所有字段 → 信息栏彻底消失，无空行
3. 给任意字段选颜色（预设/取色器/hex）→ 信息栏即时变色；浅色下选浅色字自动加深可读；切深色主题仍可读
4. 开关/改色后刷新页面、重启 dsh web → 设置保留（存盘生效）
5. 「重置标签」「重置颜色」分别恢复默认
6. 默认不设置：信息栏外观与 v1.8 一致（零回归）
7. 性能：账本折叠后余额/本会话/今日/本月/全部金额与之前一致；刷新节奏不变

## 回滚方案
- 卸载：`./uninstall.sh` → 重装旧版 → 重启 dsh web
- 数据：usage-summaries.json 可删（从明细重建）；冷归档 usage-archive/ 保留逐条明细；journal 与快照 id 去重兜底

## v1.9.1 补录（2026-08-28）
- 部署内容：设置页白屏修复（单文件化重构 + 屏显错误保障），功能无变化
- 部署动作：合并发布后重新执行 ./install.sh（覆盖 web profile 中的插件副本），用户重启 dsh web 生效
- 验收重点：设置 → 「信息底栏」应完整显示字段开关/颜色/双重置；若出现异常，页面会直接显示原因文字（把文字反馈给团队即可，无需调试工具）