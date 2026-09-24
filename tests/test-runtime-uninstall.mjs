// Bottom Info Bar — 运行时装卸自检（适配 DSH 0.1.6-alpha.2 的插件管理页）
// 覆盖两件事：
// ① 更新、停用、卸载与 DSH 重启都不得删除用户账本。
// ② 账本只允许通过设置页的明确“清除账单数据”操作删除。
// 另有静态断言：插件页 bundle 配置入口（plugins.bundle.config）是唯一配置入口、
// 复制兜底的临时节点必定摘除。
// 用法：node tests/test-runtime-uninstall.mjs
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const clientSrc = readFileSync(new URL('../src/client-bundle.js', import.meta.url), 'utf8')
const hostSrc = readFileSync(new URL('../src/host.js', import.meta.url), 'utf8')

let pass = 0
let fail = 0
function check(label, actual, expected) {
  if (actual === expected) { pass += 1; console.log('PASS  ' + label) }
  else { fail += 1; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)) }
}

// ---------- 静态断言 ----------
check('插件页 bundle 配置入口已注册（键为包名 dsh-bottom-info-bar）',
  clientSrc.includes("slots.inject('plugins.bundle.config', function () {")
  && clientSrc.includes("{ name: 'plugins.bundle.config', key: 'dsh-bottom-info-bar'"), true)
check('不注册全局设置页入口（配置仅在插件详情页维护）',
  !clientSrc.includes("slots.inject('settings.section', function () {"), true)
check('bundle 配置按宿主要求的两种视图渲染（summary 一行简介 / page 带保存的表单）',
  clientSrc.includes("if (view === 'summary') {")
  && clientSrc.includes("return React.createElement(InfoBarSettingsSection);"), true)
check('复制兜底的临时 textarea 在 finally 里必被摘除（不留游离节点）',
  /document\.body\.appendChild\(area\);[\s\S]*?\} finally \{[\s\S]*?if \(area\.parentNode\) area\.parentNode\.removeChild\(area\);/.test(clientSrc), true)
check('导出用的下载链接与 objectURL 均被回收',
  clientSrc.includes('if (link.parentNode) link.parentNode.removeChild(link);')
  && clientSrc.includes('window.URL.revokeObjectURL(url)'), true)
check('卸载不再扫描 profile 或自动清理账本目录',
  !hostSrc.includes('function bundleStillReferenced()') && !hostSrc.includes('function clearPluginData()'), true)
check('dispose 只冲刷未落盘记录，不根据卸载状态删除用户数据',
  hostSrc.includes('if (dirty || summariesDirty) flushSave();') && !hostSrc.includes('clearPluginData();'), true)

// ---------- 运行时判定 ----------
const tmpRoot = mkdtempSync(join(tmpdir(), 'bib-uninstall-'))
const dataDir = join(tmpRoot, 'data')
const profilesRoot = join(tmpRoot, 'profiles')
const manifestPath = join(profilesRoot, 'web', 'package.json')
mkdirSync(join(profilesRoot, 'web'), { recursive: true })

// 必须在 import 宿主之前设置：DATA_DIR 是模块级常量
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
process.env.DSH_BOTTOM_INFO_BAR_PROFILE_ROOT = profilesRoot
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpRoot, 'no-codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpRoot, 'no-opencode-auth.json')

const plugin = (await import('../lib/index.js')).default

function stubCtx() {
  return {
    get() { return undefined },
    credentials: { resolve: async () => undefined },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { return () => {} },
    timeout() { return () => {} },
    on() { return () => {} },
    inject(services, cb) {
      const inner = {
        effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        connection: { requestRejection() { return undefined } },
        webServer: { register() { return () => {} } },
      }
      cb(inner)
      return () => {}
    },
  }
}

const sentinel = join(dataDir, 'sentinel.json')
function resetData() {
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(sentinel, '{"keep":true}')
}
function runDispose() {
  const dispose = plugin.apply(stubCtx())
  if (typeof dispose === 'function') dispose()
  else console.log('WARN  apply 未返回 dispose 函数')
}

// ① 停用 / 重启：一个字不删
writeFileSync(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-bottom-info-bar'] } } }))
resetData()
runDispose()
check('停用 / 重启：bundle 仍在 profile 里 → 账本与设置原样保留', existsSync(sentinel), true)

// ② 不同安装形态同样保留
writeFileSync(manifestPath, JSON.stringify({ dependencies: { 'dsh-bottom-info-bar': 'link:/some/path' } }))
resetData()
runDispose()
check('本地 link 安装（只在 dependencies 里）同样判定为还在装 → 保留', existsSync(sentinel), true)

// ③ 真卸载：账本仍归用户保留
writeFileSync(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, dependencies: {} }))
resetData()
runDispose()
check('真卸载：账本与设置仍保留，重新安装后可继续使用', existsSync(sentinel), true)

// ④ manifest 损坏不影响数据保留
writeFileSync(manifestPath, '{ this is not json')
resetData()
runDispose()
check('manifest 损坏（判定不了）→ 保守保留，绝不删', existsSync(sentinel), true)

// ⑤ profiles 目录不存在不影响数据保留
rmSync(profilesRoot, { recursive: true, force: true })
resetData()
runDispose()
check('profiles 目录不存在 → 保守保留，绝不删', existsSync(sentinel), true)

// ⑥ profiles 目录为空不影响数据保留
mkdirSync(profilesRoot, { recursive: true })
resetData()
runDispose()
check('profiles 目录为空（扫不到任何 profile）→ 保守保留，绝不删', existsSync(sentinel), true)

try { rmSync(tmpRoot, { recursive: true, force: true }) } catch (err) { /* 临时目录清不掉不影响结论 */ }

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail > 0 ? 1 : 0)
