// 源码守卫（Source guards）：把几条"血的教训"从文档约定变成 CI 能拦住的硬约束。
//
// 背景：本仓库同一个坑踩了三次 ——
//   v1.10.1  ctx.settings        裸访问 → 插件树加载失败，宿主起不来
//   2026-09-04 同类问题再次出现
//   Issue #67  ctx.sessionController 裸访问 → getUsageSummary 恒返 500
// 每次都只写进记忆，结果每次都复发。文档挡不住，只有自动化能挡住。
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + detail : '')) }
}

// ---------- 守卫 1：禁止裸读宿主服务属性 ----------
//
// cordis 4 的 Context 是 Proxy：读取未在 `inject` 声明的服务属性会抛
// `cannot get property "X" without inject`，**即使该服务确实存在也一样抛**。
// 合法写法只有两种：
//   a) 该服务已在本文件 `inject: [...]` 里声明；
//   b) 用 try/catch 包住（仅用于「老宿主/非 cordis 宿主」的兜底形态）。
// 其余一律视为 bug 苗子。
const FRAMEWORK_MEMBERS = new Set([
  // cordis Context / 服务的公开成员，不是「按名字取服务」，不会触发 without inject
  'get', 'inject', 'on', 'once', 'off', 'emit', 'effect', 'logger', 'provide',
  'plugin', 'timeout', 'interval', 'setTimeout', 'setInterval', 'registry',
  'reflect', 'fiber', 'scope', 'waterfall', 'parallel', 'bail', 'serial',
  'start', 'stop', 'isolate', 'root', 'extend', 'config', 'name', 'dispose',
])

function stripComments(source) {
  // 保留换行与长度，让行号保持准确
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

function injectListOf(source) {
  const m = source.match(/\binject\s*:\s*\[([^\]]*)\]/)
  if (!m) return new Set()
  return new Set([...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]))
}

const SOURCE_FILES = [
  'plugin/src/host.js',
  'plugin/src/client-bundle.js',
  'plugin/src/host-locale.js',
  'plugin/src/constants.js',
  'plugin/src/locales.js',
]

const offenders = []
for (const rel of SOURCE_FILES) {
  const abs = join(root, rel)
  if (!existsSync(abs)) continue
  const raw = readFileSync(abs, 'utf8')
  const injected = injectListOf(raw)
  const lines = stripComments(raw).split('\n')
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/\bctx\.([A-Za-z_$][\w$]*)/g)) {
      const prop = match[1]
      if (FRAMEWORK_MEMBERS.has(prop)) continue
      // a) 已在 inject 声明 → 合法
      if (injected.has(prop)) continue
      // b) 同一行或前 3 行内有 try（= 兜底形态，例如 host-locale.js 与 client-bundle.js 的写法）
      const window = lines.slice(Math.max(0, index - 3), index + 1).join('\n')
      if (/\btry\b/.test(window)) continue
      offenders.push(`${rel}:${index + 1}  ctx.${prop}\n        ${line.trim()}`)
    }
  })
}

check(
  '守卫 1：不存在未声明 inject、又未用 try/catch 保护的裸服务访问',
  offenders.length === 0,
  offenders.length === 0 ? undefined
    : offenders.join('\n      ') +
      '\n\n      修法：① 把该服务加进本文件的 `inject: [...]`；② 或改用 ctx.get(\'name\')；' +
      '\n      ③ 或（仅老宿主兜底）写成同一行的 try { ... } catch { ... }。详见 MEMORY.md / Issue #67。'
)

// ---------- 守卫 2：记忆文件必须唯一且通用 ----------
//
// 项目记忆属于项目，不属于工具。任何工具专属的隐藏记忆目录都不允许出现。
const FORBIDDEN_MEMORY_PATHS = [
  '.workbuddy', '.cursor/memory', '.aider', '.continue/memory', '.codeium',
  '.claude/memory', '.gemini/memory', '.codex/memory', '.specstory',
]
const foundForbidden = FORBIDDEN_MEMORY_PATHS.filter((p) => existsSync(join(root, p)))

check(
  '守卫 2：不存在工具专属的记忆目录（记忆必须只放 MEMORY.md）',
  foundForbidden.length === 0,
  foundForbidden.length === 0 ? undefined
    : '发现：' + foundForbidden.join(', ') +
      '\n      修法：把内容迁入根目录 MEMORY.md 后删除该目录。规则见 MEMORY.md 顶部「使用规则」。'
)

// ---------- 守卫 3：通用记忆文件必须存在，且被 AGENTS.md 指向 ----------
const memoryPath = join(root, 'MEMORY.md')
const hasMemory = existsSync(memoryPath)
check('守卫 3a：根目录存在唯一的通用记忆文件 MEMORY.md', hasMemory)

if (hasMemory) {
  const agents = readFileSync(join(root, 'AGENTS.md'), 'utf8')
  check(
    '守卫 3b：AGENTS.md 明确指向 MEMORY.md（保证任何 Agent 都能找到记忆）',
    /MEMORY\.md/.test(agents) && /严禁任何 Agent 自建/.test(agents),
    'AGENTS.md 缺少「项目记忆」段或未声明「禁止自建记忆」规则'
  )
  const memory = readFileSync(memoryPath, 'utf8')
  check(
    '守卫 3c：MEMORY.md 自身写明「禁止自建工具专属记忆」的规则',
    /严禁任何 Agent 自建/.test(memory),
    'MEMORY.md 顶部「使用规则」缺少该条'
  )
}

// ---------- 守卫 4：发布元数据不允许被手工修改（仅 PR 场景）----------
//
// 手工 bump 版本号会让 Release Please 找不到「上次发布」的基准，从而把全部历史
// 当成未发布内容、算出错误的大版本 —— 2026-09-11 的 v2.0.0 事故即由此而来。
// 该守卫需要 CI 提供的 git 上下文，本地跑（无 GITHUB_BASE_REF）时自动跳过。
const baseRef = process.env.GITHUB_BASE_REF || ''
const headRef = process.env.GITHUB_HEAD_REF || ''
if (!baseRef) {
  console.log('SKIP  守卫 4：非 PR 场景（无 GITHUB_BASE_REF），跳过发布元数据检查')
} else if (headRef.startsWith('release-please--')) {
  console.log('PASS  守卫 4：Release Please 的发布 PR 有权修改版本元数据')
} else {
  const { execFileSync } = await import('node:child_process')
  const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  let changed = null
  try {
    git(['fetch', '--no-tags', '--quiet', 'origin', baseRef])
    changed = git(['diff', '--name-only', `origin/${baseRef}...HEAD`]).split('\n').filter(Boolean)
  } catch (err) {
    console.log('WARN  守卫 4：无法取得基线（' + String(err && err.message).split('\n')[0] + '），跳过本次检查')
  }
  if (changed) {
    const GUARDED = ['.release-please-manifest.json', 'plugin/package.json', 'CHANGELOG.md']
    const touched = changed.filter((f) => GUARDED.includes(f))
    // 逃生舱：万一 Release Please 自身把元数据弄坏了，必须还有办法人工抢修。
    // 因为 main 开了 enforce_admins，没有这个标记就会被永久卡死。
    // 用法：在 PR 的任一提交信息里写上 [release-metadata-override]，并在 PR 描述里说明原因。
    let override = false
    try {
      const log = git(['log', `origin/${baseRef}..HEAD`, '--format=%B'])
      override = log.includes('[release-metadata-override]')
    } catch (err) { /* 取不到提交信息就当作没有授权，宁可拦住 */ }
    check(
      '守卫 4：普通 PR 不得手工修改版本元数据（版本号由 Release Please 独占）',
      touched.length === 0 || override,
      touched.length === 0 ? undefined
        : '被修改：' + touched.join(', ') +
          (override ? '\n      （已检测到 [release-metadata-override]，本次放行）' : '') +
          '\n      版本号 / CHANGELOG / manifest 由 Release Please 自动维护，手工改会破坏它的基准，' +
          '\n      进而重演 v2.0.0 误发事故。发版请合并 Release Please 开出的「发布 PR」。详见 AGENTS.md「发布机制」。' +
          '\n      确有抢修需要时：在提交信息里加 [release-metadata-override] 并在 PR 描述里说明原因。'
    )
  }
}

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
