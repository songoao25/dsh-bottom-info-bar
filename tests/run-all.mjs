// Bottom Info Bar — 全量测试入口
// 用法：node tests/run-all.mjs（或仓库根 npm test）
// 覆盖：
//  - 静态 host 冒烟测试（webServer 路由 / RPC 分发 / 记账 / 同源防护）：tests/smoke-static-host.mjs
//  - 业务逻辑回归（峰谷边界 / 显示名识别 / 密度审计 / 花费聚合），指向正式源码：
//    src/host.js + src/client-bundle.js
// 注意：先执行 build（smoke 测试 import 的是 lib/ 产物，必须先重建避免测到陈旧代码）
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const HOST = join(root, 'src', 'host.js')

// 0) 重建 lib/（smoke 依赖构建产物；lib/ 已入库，CI 另有一致性检查）
const build = spawnSync(process.execPath, ['scripts/build.mjs'], { cwd: root, encoding: 'utf8' })
if (build.status !== 0) {
  console.error('build 失败：' + (build.stderr || build.stdout))
  process.exit(1)
}
console.log('build OK → lib/')

const cases = [
  ['test-release-version（package/manifest/changelog 一致性）', ['tests/test-release-version.mjs'], join(root), process.execPath],
  ['test-release-chain（发布链条契约：标签格式/路径/闸门/钉子必须两边一致）', ['tests/test-release-chain.mjs'], join(root), process.execPath],
  ['test-source-guards（源码守卫：裸服务访问 / 记忆文件唯一性 / 发布元数据不可手工改）', ['tests/test-source-guards.mjs'], join(root), process.execPath],
  ['smoke-static-host', ['tests/smoke-static-host.mjs'], join(root), process.execPath],
  ['test-alpha4-client-contract（alpha.4 client manifest/slots/React）', ['tests/test-alpha4-client-contract.mjs'], join(root), process.execPath],
  ['test-static-client（src/client-bundle.js）', ['tests/test-static-client.cjs'], join(root), process.execPath],
  ['test-client-fault-tolerance（client-bundle.js 失败处理原子性）', ['tests/test-client-fault-tolerance.cjs'], join(root), process.execPath],
  ['test-realtime-session-model（会话级实时模型同步）', ['tests/test-realtime-session-model.js'], join(root), process.execPath],
  ['test-display-name（host.js）', ['tests/test-display-name.cjs'], join(root), process.execPath],
  ['test-density-toggle（host.js + client-bundle.js）', ['tests/test-density-toggle.cjs'], join(root), process.execPath],
  ['test-display-model（渲染级：模式只决定原生行，字段显隐只由字段开关决定）', ['tests/test-display-model.cjs'], join(root), process.execPath],
  ['test-info-bar-rhythm（两行节奏：确定高度收合 / 无 fr 轨道 / 无行间空隙）', ['tests/test-info-bar-rhythm.cjs'], join(root), process.execPath],
  ['test-spend-accounting（host.js）', ['tests/test-spend-accounting.cjs'], join(root), process.execPath],
  ['test-weekend-pricing（host.js 周末峰谷规则）', ['tests/test-weekend-pricing.mjs'], join(root), process.execPath],
  ['test-dual-mode（host.js 双模式逻辑 + client 订阅渲染）', ['tests/test-dual-mode.cjs'], join(root), process.execPath],
  ['test-zai-quota（Issue #85 智谱 CREDIT_LIMIT 积分制 + 窗口时长闸门/百分比推算/降级）', ['tests/test-zai-quota.cjs'], join(root), process.execPath],
  ['test-commandcode-quota（Issue #99 Command Code credits/窗口/未知套餐降级）', ['tests/test-commandcode-quota.cjs'], join(root), process.execPath],
  ['test-minimax-token-plan（MiniMax Token Plan 多桶最紧聚合 + Subscription Key 错误码降级）', ['tests/test-minimax-token-plan.cjs'], join(root), process.execPath],
  ['test-quota-display-mode（订阅窗口百分比方向：默认 remaining / 切换 used / 落盘与回滚）', ['tests/test-quota-display-mode.cjs'], join(root), process.execPath],
  ['test-minimax-e2e（独立装置：真实 apply + 桩 ctx + 拦截 fetch 的双站点路由/错误码/快照降级）', ['tests/test-minimax-e2e.mjs'], join(root), process.execPath],
  ['test-usage-sanitize（host.js 记账数值清洗）', ['tests/test-usage-sanitize.cjs'], join(root), process.execPath],
  ['test-usage-ledger（耐久账本与历史价格）', ['tests/test-usage-ledger.mjs'], join(root), process.execPath],
  ['test-session-lineage（Issue #44 父子会话精确归属）', ['tests/test-session-lineage.mjs'], join(root), process.execPath],
  ['test-optional-service-safety（Issue #67 缺少可选服务时不得 500）', ['tests/test-optional-service-safety.mjs'], join(root), process.execPath],
  ['test-usage-compaction（v1.9 压缩等价/会话锁/回填/扫描量/崩溃安全）', ['tests/test-usage-compaction.mjs'], join(root), process.execPath],
  ['test-field-settings（v1.9 PR2 设置落盘/白名单/密度持久/双重置/configVersion）', ['tests/test-field-settings.mjs'], join(root), process.execPath],
  ['test-field-config-client（v1.9 PR2 客户端过滤/零回归着色/注册表一致性）', ['tests/test-field-config-client.cjs'], join(root), process.execPath],
  ['test-usage-stream-ledger（每次回答只记一笔）', ['tests/test-usage-stream-ledger.mjs'], join(root), process.execPath],
  ['test-host-regressions（host.js 审计必修项回归）', ['tests/test-host-regressions.mjs'], join(root), process.execPath],
  ['test-subscription-providers-consistency（共享常量单一生源一致性）', ['tests/test-subscription-providers-consistency.cjs'], join(root), process.execPath],
  ['test-v17-adapters（v1.7 解析器：JWT/小米/Together/Fireworks/SigV4/Cloudflare/normalize）', ['tests/test-v17-adapters.cjs'], join(root), process.execPath],
  ['test-update-check（启动版本检查与红色提醒）', ['tests/test-update-check.cjs'], join(root), process.execPath],
  ['test-update-command（点击更新标签复制命令 + 命令随安装形态区分）', ['tests/test-update-command.mjs'], join(root), process.execPath],
  ['test-self-update（自更新引擎：版本比较/完整性校验/原子替换/回滚/开关/审计日志 + host/client 接线）', ['tests/test-self-update.mjs'], join(root), process.execPath],
  ['test-pricing-catalog（远程价目目录体系 + 官方价目校验）', ['tests/test-pricing-catalog.mjs'], join(root), process.execPath],
  ['check-host（host.js）', ['tests/check-host.cjs', HOST], join(root), process.execPath],
  ['test-localization（zh/en rendering and host checker regressions）', ['tests/test-localization.mjs'], join(root), process.execPath],
  ['test-locale-copy（locale meta.title / 字典对称 / 错误码文案 / cordis ctx / patch 行 id）', ['tests/test-locale-copy.mjs'], join(root), process.execPath],
  ['test-runtime-uninstall（插件管理页运行时装卸：卸载清空 / 停用重启不动 / 不留残留）', ['tests/test-runtime-uninstall.mjs'], join(root), process.execPath],
]

let failed = 0
// 自更新在整个测试套件里一律关闭：它会真的下载 tarball 并替换包内文件，绝不能让测试触发。
// （自更新引擎本身由 tests/test-self-update.mjs 用桩依赖直接单测，不经 host。）
const testEnv = Object.assign({}, process.env, { DSH_BOTTOM_INFO_BAR_SELF_UPDATE: 'off' })
for (const [name, args, cwd, cmd = process.execPath] of cases) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: testEnv })
  const ok = r.status === 0
  const output = (r.stdout || r.stderr || '').split('\n').filter(Boolean)
  const summary = ok ? output.slice(-3).join(' | ') : output.slice(-60).join(' | ')
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  →  ${summary || r.stderr}`)
  if (!ok) failed += 1
}
console.log(failed === 0 ? '\n全量测试全部通过' : `\n${failed} 项测试失败`)
process.exit(failed === 0 ? 0 : 1)
