// 版本更新提醒：点击标签复制更新命令（2026-09-11 需求）
//
// 两件事必须锁死，否则会退化：
//   ① 点击标签只复制，**不能顺带切换简洁/完整模式**——信息栏根节点自带 onClick，
//      所以标签的点击处理必须 stopPropagation。这条最容易在后续重构中被删掉。
//   ② 复制出来的命令必须与「安装形态」匹配：npm 安装用 dsh plugin add，
//      link: 安装（一键脚本 / 本地代码）必须用 git pull——用错会把用户的本地代码顶掉。
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })

const root = new URL('..', import.meta.url).pathname
let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + detail : '')) }
}

// ---------- ① 客户端静态断言 ----------
const client = readFileSync(join(root, 'plugin/src/client-bundle.js'), 'utf8')
const badge = client.slice(client.indexOf("className: 'bi-update'"), client.indexOf("className: 'bi-update'") + 400)

check('客户端：更新标签绑定了点击处理', /onClick:\s*copyUpdateCommand/.test(badge), badge.slice(0, 200))
check(
  '客户端：点击处理调用 stopPropagation（否则点复制会切换简洁/完整模式）',
  /copyUpdateCommand\s*=\s*function[\s\S]{0,120}stopPropagation\(\)/.test(client),
  '未找到 stopPropagation：信息栏根节点的 onClick 会把这次点击当成「切换密度」'
)
check(
  '客户端：复制走 copyTextToClipboard（含非安全上下文的兜底路径）',
  /copyTextToClipboard\(updateCommand\)/.test(client) && /document\.execCommand\('copy'\)/.test(client),
  '缺少兜底：从局域网 IP 访问时 navigator.clipboard 不存在，点了会毫无反应'
)
check(
  '客户端：复制成功后标签文字临时切换（updateCommandCopied 状态被使用）',
  /setUpdateCopied\(true\)/.test(client) && /ui\.updateCommandCopied/.test(client)
)
check(
  '客户端：更新标签有可点击暗示（cursor: pointer）',
  /\.bi-update\{[^}]*cursor:\s*pointer/.test(client),
  '无可点击暗示，用户不会知道能点'
)

// ---------- ② 文案：必须写明「点击标签即可复制」----------
const { LOCALES } = await import('../plugin/src/locales.js')
for (const lang of ['zh', 'en']) {
  const text = LOCALES[lang]['ui.askYourAgentToUpdate'] || ''
  check(
    `文案(${lang})：hover 提示同时给出「找 Agent」与「点击标签复制」两条路径`,
    /Agent|agent/.test(text) && /点击|click/i.test(text),
    text
  )
  check(`文案(${lang})：提供「已复制」反馈文案`, typeof LOCALES[lang]['ui.updateCommandCopied'] === 'string' && LOCALES[lang]['ui.updateCommandCopied'].length > 0)
}

// ---------- ③ host 运行时：命令必须匹配安装形态 ----------
async function getUpdateInfoWithProfile(profilePackage) {
  const home = mkdtempSync(join(tmpdir(), 'bib-upd-'))
  const dataDir = mkdtempSync(join(tmpdir(), 'bib-upd-data-'))
  const prevHome = process.env.DSH_HOME
  const prevData = process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR
  process.env.DSH_HOME = home
  process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
  if (profilePackage) {
    mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
    writeFileSync(join(home, 'profiles', 'web', 'package.json'), JSON.stringify(profilePackage))
  }
  try {
    const mod = await import('../plugin/src/host.js?upd=' + encodeURIComponent(dataDir))
    const captured = { route: null }
    const ctx = {
      get(name) {
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
        return undefined
      },
      credentials: { resolve: async () => null },
      interval() { return () => {} },
      timeout() { return () => {} },
      on() { return () => {} },
      inject(services, callback) {
        callback({
          effect(fn) { const d = fn(); return () => d && d() },
          webServer: { register(route) { captured.route = route; return () => {} } },
        })
        return () => {}
      },
    }
    const dispose = mod.default.apply(ctx)
    const listeners = {}
    const req = {
      url: '/_dsh/dsh-bottom-info-bar/getUpdateInfo', method: 'POST', headers: {},
      on(name, listener) { (listeners[name] ||= []).push(listener); return req }, destroy() {},
    }
    let payload = null
    const pending = captured.route.handler(req, { writeHead() {}, end(text) { payload = JSON.parse(text) } })
    for (const listener of listeners.data || []) listener(Buffer.from('{}'))
    for (const listener of listeners.end || []) listener()
    await pending
    dispose()
    return payload
  } finally {
    if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
    if (prevData === undefined) delete process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR; else process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = prevData
    rmSync(home, { recursive: true, force: true })
    rmSync(dataDir, { recursive: true, force: true })
  }
}

const npmCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': '^1.10.19' } })
check(
  'host：npm 安装 → 命令为 dsh plugin add …@latest',
  npmCase && npmCase.installMode === 'npm' && /^dsh plugin --profile \S+ add dsh-bottom-info-bar@latest$/.test(npmCase.updateCommand || ''),
  npmCase && { mode: npmCase.installMode, cmd: npmCase.updateCommand }
)
check('host：getUpdateInfo 仍带回当前版本号（未破坏原有用途）', npmCase && typeof npmCase.current === 'string' && npmCase.current.length > 0)

const linkCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:/opt/example/dsh-bottom-info-bar/plugin' } })
check(
  'host：link: 安装 → 命令为 git pull（用 npm 命令会把用户本地代码顶掉）',
  linkCase && linkCase.installMode === 'link' && linkCase.updateCommand === 'git -C /opt/example/dsh-bottom-info-bar/plugin pull --ff-only',
  linkCase && { mode: linkCase.installMode, cmd: linkCase.updateCommand }
)

const noProfile = await getUpdateInfoWithProfile(null)
check(
  'host：读不到 profile 配置时安全退回 npm 命令（不抛错）',
  noProfile && noProfile.installMode === 'npm' && typeof noProfile.updateCommand === 'string' && noProfile.updateCommand.length > 0,
  noProfile && { mode: noProfile.installMode, cmd: noProfile.updateCommand }
)

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
