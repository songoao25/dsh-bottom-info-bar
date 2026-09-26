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
  'src/host.js',
  'src/client-bundle.js',
  'src/host-locale.js',
  'src/constants.js',
  'src/locales.js',
  'src/self-update.js',
  'src/version.js',
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

// DSH 0.1.6-alpha.2 的 web Cordis Context 不保证 `timeout` 成员可读；
// 2026-09-21 这会让回答完成后的账单持久化失败。插件自己的防抖落盘应
// 使用标准计时器，不能再把宿主 Context 当成定时器服务。
check(
  '守卫 1b：账单防抖不读取 ctx.timeout',
  !/\bctx\.timeout\s*\(/.test(readFileSync(join(root, 'src/host.js'), 'utf8')),
  'ctx.timeout 会在当前 DSH web Cordis Context 中触发未注入服务错误'
)

// ---------- 守卫 2：本项目只允许通用 Agent 资产 ----------
//
// 举一反三（2026-09-26 用户拍板）：禁的不只是记忆目录。一切 Agent 专属物都不许进仓库 ——
// 记忆目录、配置目录、私有指令文件，改用通用等价物（MEMORY.md / AGENTS.md / docs/）。
// 专属物把项目知识锁死在某一个工具里，换一个 Agent 接手就看不到了，等于丢失。
const FORBIDDEN_AGENT_PATHS = [
  // 工具专属记忆/配置目录
  '.workbuddy', '.cursor/memory', '.aider', '.continue', '.codeium',
  '.claude/memory', '.gemini/memory', '.codex/memory', '.specstory',
  '.windsurf', '.opencode', '.trae', '.cline', '.roo', '.kilocode',
  '.qodo', '.cody', '.tabnine', '.amazonq', '.ai',
  // 工具专属指令/配置文件（仓库根）
  'CLAUDE.md', 'CURSOR.md', 'CODEX.md', 'GEMINI.md', 'WINDSURF.md', 'COPILOT.md',
  '.cursorrules', '.cursorignore', '.clinerules', '.windsurfrules',
]
const foundForbidden = FORBIDDEN_AGENT_PATHS.filter((p) => existsSync(join(root, p)))

check(
  '守卫 2：不存在任何 Agent 专属物（记忆/配置/指令只允许通用资产）',
  foundForbidden.length === 0,
  foundForbidden.length === 0 ? undefined
    : '发现：' + foundForbidden.join(', ') +
      '\n      修法：内容迁入通用位置（记忆进根目录 MEMORY.md，其余进 AGENTS.md/docs/）后删除。规则见 MEMORY.md 顶部「使用规则」。'
)

// ---------- 守卫 3：过程文稿不得入仓 ----------
// 仓库只收用户文档与代码：根目录不留过程记忆与 Agent 指令文件，docs/ 只留用户说明。
// 想法、方向、调研过程、复盘一律不进仓库。
const FORBIDDEN_PROCESS_DOCS = ['MEMORY.md', 'AGENTS.md']
const foundProcessDocs = FORBIDDEN_PROCESS_DOCS.filter((p) => existsSync(join(root, p)))
check(
  '守卫 3a：根目录不存在过程文稿（MEMORY.md / AGENTS.md）',
  foundProcessDocs.length === 0,
  foundProcessDocs.length === 0 ? undefined : '发现：' + foundProcessDocs.join(', ')
)
const ALLOWED_DOCS = ['INSTALL.md', 'PROVIDER-COMPATIBILITY.md']
let extraDocs = []
try {
  extraDocs = readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md') && !ALLOWED_DOCS.includes(f))
} catch (err) { extraDocs = ['docs/ 不可读：' + String((err && err.message) || err)] }
check(
  '守卫 3b：docs/ 只留用户说明（INSTALL.md / PROVIDER-COMPATIBILITY.md）',
  extraDocs.length === 0,
  extraDocs.length === 0 ? undefined : '发现：' + extraDocs.join(', ')
)

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
    // manifest 与 CHANGELOG 整文件锁死（Release Please 只会整体重写它们）。
    // package.json 只锁 version 字段：description / keywords 等非版本字段的
    // 正常改动不该被拦（守卫的意图是防手工 bump 版本号，不是冻结整个文件）。
    const GUARDED = ['.release-please-manifest.json', 'CHANGELOG.md']
    const touched = changed.filter((f) => GUARDED.includes(f))
    if (changed.includes('package.json')) {
      let versionTouched = null
      try {
        const pkgDiff = git(['diff', `origin/${baseRef}...HEAD`, '--', 'package.json'])
        versionTouched = pkgDiff.split('\n').some((l) => /^[+-]\s*"version"\s*:/.test(l))
      } catch (err) { /* 取不到 diff 就当作动过版本号，宁可拦住 */ }
      if (versionTouched !== false) touched.push('package.json（version 字段）')
    }
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

// ---------- 守卫 5：禁止用「字符串包含」判断 URL 主机 ----------
//
// CodeQL js/incomplete-url-substring-sanitization（2026-09-23 两条 High 告警）：
// `entry.url.includes('https://api.commandcode.ai/')` 只要求域名出现在 URL 的任意位置，
// `https://evil.example/?u=https://api.commandcode.ai/` 同样会通过，等于没判断。
// 判断请求目标必须解析 URL 后精确比较协议 / 主机名（new URL(...).hostname / .origin）。
const URL_HOST_SUBSTRING = /\.(?:includes|startsWith|endsWith|indexOf|lastIndexOf)\(\s*['"`]https?:\/\//
const SELF_PATH = fileURLToPath(import.meta.url)
const urlOffenders = []
function scanUrlHostChecks(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) { scanUrlHostChecks(abs); continue }
    if (!/\.(?:js|mjs|cjs)$/.test(entry.name)) continue
    if (abs === SELF_PATH) continue // 本文件：上面的模式定义本身写在这里
    const lines = stripComments(readFileSync(abs, 'utf8')).split('\n')
    lines.forEach((line, index) => {
      if (URL_HOST_SUBSTRING.test(line)) {
        urlOffenders.push(abs.slice(root.length + 1) + ':' + (index + 1) + '\n        ' + line.trim())
      }
    })
  }
}
for (const dir of ['src', 'scripts', 'tests']) {
  const abs = join(root, dir)
  if (existsSync(abs)) scanUrlHostChecks(abs)
}
check(
  '守卫 5：不存在「URL 字符串包含域名」式判断（CodeQL incomplete-url-substring-sanitization）',
  urlOffenders.length === 0,
  urlOffenders.length === 0 ? undefined
    : urlOffenders.join('\n      ') +
      "\n      修法：不要写 url.includes('https://host/')，改为 new URL(url) 后比较 protocol / hostname / origin；" +
      "\n      示例：const u = new URL(String(url)); u.protocol === 'https:' && u.hostname === 'api.commandcode.ai'"
)

// ---------- 守卫 6：超时信号必须走唯一入口 ----------
//
// 2026-09-25 审计 P0-2：`AbortSignal.timeout` 在部分内嵌运行时里不存在。修之前有 14 处裸用、
// 只有 1 处写了守卫 —— 缺 API 的宿主上会「余额、订阅、账单一起报错」，而根因只有一个。
// 守卫写在调用点就等于没写：写 14 次一定会漏第 15 次。所以把「只准出现一次」变成硬约束。
const timeoutOffenders = []
for (const rel of SOURCE_FILES) {
  const abs = join(root, rel)
  if (!existsSync(abs)) continue
  let source = stripComments(readFileSync(abs, 'utf8'))
  // 唯一被允许出现的地方就是封装本身：先把它挖掉，再要求「一处都不剩」。
  if (rel === 'src/host.js') source = source.replace(/function timeoutSignal\([\s\S]*?\n\}/, '')
  source.split('\n').forEach((line, index) => {
    if (/AbortSignal\.timeout/.test(line)) timeoutOffenders.push(`${rel}:${index + 1}  ${line.trim()}`)
  })
}
check(
  '守卫 6：AbortSignal.timeout 只允许出现在统一封装 timeoutSignal() 内',
  timeoutOffenders.length === 0,
  timeoutOffenders.length === 0 ? undefined
    : '封装外共 ' + timeoutOffenders.length + ' 处：\n      ' + timeoutOffenders.join('\n      ') +
      '\n      修法：调用处一律写 timeoutSignal(ms)（src/host.js 顶部唯一封装，内部已含 API 守卫）。' +
      '\n      调用点自己写守卫 = 守卫必然漏掉；缺失该 API 时应降级为「无超时」而不是直接抛。'
)

// ---------- 守卫 7：模块级函数不得直接用模块级 t（语言必须由调用方传入）----------
//
// 2026-09-25 审计 P0-1：parseZaiQuota 是模块级函数，内部用了模块级 `t` —— 而模块级 t 没有 ctx，
// 恒为中文；只有 apply 内部重建的 t 才认宿主语言。后果：英文宿主下智谱套餐名一直显示中文。
// 规则：顶层函数体里只要出现 t(，就必须同时出现 translate（= 接受了译法参数）。
const localeOffenders = []
for (const rel of ['src/host.js']) {
  const src = stripComments(readFileSync(join(root, rel), 'utf8'))
  const lines = src.split('\n')
  let current = null
  lines.forEach((line, index) => {
    const decl = line.match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/)
    if (decl) { current = { name: decl[1], from: index, body: [] }; return }
    if (current === null) return
    if (line === '}') {
      const body = current.body.join('\n')
      if (/\bt\(/.test(body) && !/\btranslate\b/.test(body)) {
        localeOffenders.push(`${rel}:${current.from + 1}  function ${current.name}`)
      }
      current = null
      return
    }
    current.body.push(line)
  })
}
check(
  '守卫 7：模块级函数用 t() 时必须接收 translate 参数（否则恒为中文）',
  localeOffenders.length === 0,
  localeOffenders.length === 0 ? undefined
    : '以下顶层函数调用了模块级 t：\n      ' + localeOffenders.join('\n      ') +
      '\n      修法：加第三个参数 translate，函数内写 `if (translate === undefined) translate = t`，' +
      '\n      调用处显式传 apply 内部那个语言感知的 t。参见 mergeSubscriptionResult 的写法。'
)

// ---------- 守卫 8：时间显示无自定义格式 ----------
//
// 日期格式不提供用户选项：时间统一用通用格式 YYYY-MM-DD HH:mm。
// 曾经有过「年/月/日/时/分/秒 6 开关」的 timeFormat 定制，但设置页实际并不提供该入口，
// 文案里提「显示格式」会误导用户以为能调 —— 删定制的同时必须删误导文案，且不许加回来。
const TIME_FORMAT_OFFENDERS = []
for (const rel of ['src/host.js', 'src/client-bundle.js', 'src/locales.js', 'src/constants.js']) {
  const abs = join(root, rel)
  if (!existsSync(abs)) continue
  stripComments(readFileSync(abs, 'utf8')).split('\n').forEach((line, index) => {
    if (/timeFormat|TIME_FORMAT/.test(line)) TIME_FORMAT_OFFENDERS.push(`${rel}:${index + 1}  ${line.trim().slice(0, 120)}`)
  })
}
check(
  '守卫 8：源码不再含日期格式自定义（timeFormat 定制已下线，文案不得提“显示格式”）',
  TIME_FORMAT_OFFENDERS.length === 0,
  TIME_FORMAT_OFFENDERS.length === 0 ? undefined
    : '共 ' + TIME_FORMAT_OFFENDERS.length + ' 处：\n      ' + TIME_FORMAT_OFFENDERS.join('\n      ') +
      '\n      修法：时间显示固定用通用格式，不加用户选项；字段 note 与设置区描述只讲“时区”。'
)

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
