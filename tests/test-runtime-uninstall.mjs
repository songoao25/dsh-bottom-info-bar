// Bottom Info Bar — 运行时装卸自检（适配 DSH 0.1.6-alpha.2 的插件管理页）
// 覆盖两件事：
// ① 「真卸载」与「只是停用那一排 / DSH 重启」必须分得清 —— 判错一次就是永久丢花费账本。
// ② 真卸载时数据目录连根清掉，不留残留；其他情况一个字都不删。
// 另有静态断言：插件页 bundle 配置入口（plugins.bundle.config）是唯一配置入口、
// 复制兜底的临时节点必定摘除。
// 用法：node tests/test-runtime-uninstall.mjs
import { fileURLToPath } from 'node:url'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const clientSrc = readFileSync(new URL('../plugin/src/client-bundle.js', import.meta.url), 'utf8')
const hostSrc = readFileSync(new URL('../plugin/src/host.js', import.meta.url), 'utf8')

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
check('宿主卸载判定：读不到 / 判定不了时一律按「还在装」处理（绝不删数据）',
  hostSrc.includes('if (profileDirs === 0 || readableManifests === 0) return true')
  && /\} catch \(err\) \{\s*\n\s*return true\s*\n\s*\}/.test(hostSrc), true)
check('保险①：数据与 profile 不同属一个 DSH home 时绝不清（自定义部署不敢判定）',
  hostSrc.includes('if (dirname(DATA_DIR) !== dirname(PROFILE_ROOT)) return true'), true)
check('卸载判定可用环境变量隔离（测试专用，运行期不设置）',
  hostSrc.includes("const PROFILE_ROOT = process.env.DSH_BOTTOM_INFO_BAR_PROFILE_ROOT || join(homedir(), '.dsh', 'profiles')"), true)
check('dispose 先判卸载再决定清不清空（不是无脑删）',
  hostSrc.includes('if (!bundleStillReferenced()) {\n        clearPluginData();\n        return;\n      }'), true)

// ---------- 运行时判定 ----------
const tmpRoot = mkdtempSync(join(tmpdir(), 'bib-uninstall-'))
const dataDir = join(tmpRoot, 'data')
const profilesRoot = join(tmpRoot, 'profiles')
const manifestPath = join(profilesRoot, 'web', 'package.json')
mkdirSync(join(profilesRoot, 'web'), { recursive: true })

// 必须在 import 宿主之前设置：DATA_DIR / PROFILE_ROOT 都是模块级常量
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
process.env.DSH_BOTTOM_INFO_BAR_PROFILE_ROOT = profilesRoot
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpRoot, 'no-codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpRoot, 'no-opencode-auth.json')

const plugin = (await import('../plugin/lib/index.js')).default

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

// ① 只是停用那一排 / DSH 重启：bundles 里仍有本插件 → 一个字不删
writeFileSync(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'dsh-bottom-info-bar'] } } }))
resetData()
runDispose()
check('停用 / 重启：bundle 仍在 profile 里 → 账本与设置原样保留', existsSync(sentinel), true)

// ② 通过 dependencies 引用也算“还在装”（link: 本地装的形态）
writeFileSync(manifestPath, JSON.stringify({ dependencies: { 'dsh-bottom-info-bar': 'link:/some/path' } }))
resetData()
runDispose()
check('本地 link 安装（只在 dependencies 里）同样判定为还在装 → 保留', existsSync(sentinel), true)

// ③ 真卸载：bundles 与 dependencies 都不再有本插件 → 连目录一起清空
writeFileSync(manifestPath, JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } }, dependencies: {} }))
resetData()
runDispose()
check('真卸载：数据目录连根清空，不留残留', existsSync(dataDir), false)

// ④ manifest 读不出来 → 判定不了 → 保守保留
writeFileSync(manifestPath, '{ this is not json')
resetData()
runDispose()
check('manifest 损坏（判定不了）→ 保守保留，绝不删', existsSync(sentinel), true)

// ⑤ profiles 目录不存在 → 判定不了 → 保守保留
rmSync(profilesRoot, { recursive: true, force: true })
resetData()
runDispose()
check('profiles 目录不存在 → 保守保留，绝不删', existsSync(sentinel), true)

// ⑥ profiles 目录在，但里面一个 profile 子目录都没有 → 判定不了 → 保守保留
mkdirSync(profilesRoot, { recursive: true })
resetData()
runDispose()
check('profiles 目录为空（扫不到任何 profile）→ 保守保留，绝不删', existsSync(sentinel), true)

// ⑦ 保险①：数据目录与 profile 根目录不属于同一个 DSH home → 判定不了 → 保留
//    DATA_DIR / PROFILE_ROOT 都是模块级常量，只能在子进程里换一套环境验证。
{
  const { spawnSync } = await import('node:child_process')
  const splitHome = join(tmpRoot, 'split')
  const splitData = join(splitHome, 'elsewhere', 'data')
  const splitProfiles = join(splitHome, 'profiles')
  const splitManifest = join(splitProfiles, 'web', 'package.json')
  mkdirSync(join(splitProfiles, 'web'), { recursive: true })
  mkdirSync(splitData, { recursive: true })
  writeFileSync(splitManifest, JSON.stringify({ dsh: { profile: { bundles: [] } } }))
  writeFileSync(join(splitData, 'sentinel.json'), '{"keep":true}')
  const script = [
    "import { existsSync } from 'node:fs'",
    "const plugin = (await import(process.env.LIB)).default",
    "const ctx = { get: () => undefined, credentials: { resolve: async () => undefined }, shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) }, interval: () => () => {}, timeout: () => () => {}, on: () => () => {}, inject: (_s, cb) => { cb({ effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } }, webServer: { register: () => () => {} } }); return () => {} } }",
    "const dispose = plugin.apply(ctx)",
    "if (typeof dispose === 'function') dispose()",
    "process.stdout.write(String(existsSync(process.env.SENTINEL)))",
  ].join('\n')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      DSH_BOTTOM_INFO_BAR_DATA_DIR: splitData,
      DSH_BOTTOM_INFO_BAR_PROFILE_ROOT: splitProfiles,
      LIB: fileURLToPath(new URL('../plugin/lib/index.js', import.meta.url)),
      SENTINEL: join(splitData, 'sentinel.json'),
    },
  })
  check('保险①：数据目录不在 profile 所属的 DSH home 下 → 保守保留，绝不删', (r.stdout || '').trim(), 'true')
}

try { rmSync(tmpRoot, { recursive: true, force: true }) } catch (err) { /* 临时目录清不掉不影响结论 */ }

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail > 0 ? 1 : 0)
