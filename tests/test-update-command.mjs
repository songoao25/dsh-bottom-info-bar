// 版本信息仍由 host 读取（用于版本诊断和未来宿主更新能力），但不能挤进聊天信息栏。
// 桌面客户端并不保证终端命令能更新一个已安装插件，故 UI 不再显示更新标签、复制命令或
// “已复制”反馈。下方保留安装来源命令的 host 单测，确保未来宿主提供真正更新入口时有可信数据。
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })

const root = new URL('..', import.meta.url).pathname
let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + detail : '')) }
}

// ---------- ① 客户端静态断言 ----------
const client = readFileSync(join(root, 'src/client-bundle.js'), 'utf8')
// 2026-09-25：标记改为两枚（待重启 / 更新失败），各自受「提醒信息」组开关约束；
// 「有新版本可复制命令」的旧标签仍然不许回来 —— 桌面端执行不了那些命令。
check(
  '客户端只在待重启 / 更新失败时给短标记，不回到「有新版就挂标签」',
  client.includes("if (restartVersion && fieldVisible('updateNotice'))")
  && client.includes("if (updateFailed && fieldVisible('updateFailure'))")
  && !client.includes('updateInfo.available && fieldVisible')
)
check('客户端不复制可能失效的更新命令', !client.includes('copyTextToClipboard') && !client.includes('setUpdateCopied'))

// ---------- ② 文案：不再引导用户点击标签复制命令 ----------
const { LOCALES } = await import('../src/locales.js')
for (const lang of ['zh', 'en']) {
  const text = LOCALES[lang]['ui.askYourAgentToUpdate'] || ''
  check(
    `文案(${lang})：遗留更新文案不会要求点击标签复制命令`,
    !/点击.*复制|click.*copy/i.test(text),
    text
  )
}

// ---------- ③ host 运行时：命令必须匹配安装形态，且 link: 的命令真的能跑 ----------
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
    const mod = await import('../src/host.js?upd=' + encodeURIComponent(dataDir))
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
          connection: { requestRejection(req) { return req.headers['sec-fetch-site'] === 'cross-site' ? 403 : undefined } },
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

// ④ 用的夹具：把 host 模块复制进临时目录，配一份**可改版本号**的 package.json
// （模拟「本机已安装的那一份」），并允许覆盖 npm 查询 TTL。
async function openUpdateInfoHost(options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'bib-upd-'))
  const dataDir = mkdtempSync(join(tmpdir(), 'bib-upd-data-'))
  const prevHome = process.env.DSH_HOME
  const prevData = process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR
  const prevTtl = process.env.DSH_BOTTOM_INFO_BAR_UPDATE_TTL_MS
  process.env.DSH_HOME = home
  process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
  if (options.updateTtlMs !== undefined) process.env.DSH_BOTTOM_INFO_BAR_UPDATE_TTL_MS = String(options.updateTtlMs)
  mkdirSync(join(home, 'profiles', 'web'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'web', 'package.json'), JSON.stringify({ dependencies: { 'dsh-bottom-info-bar': 'link:/opt/example/dsh-bottom-info-bar' } }))
  const mod = await import((options.moduleUrl || new URL('../src/host.js', import.meta.url).href) + '?upd=' + encodeURIComponent(dataDir))
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
        connection: { requestRejection(req) { return req.headers['sec-fetch-site'] === 'cross-site' ? 403 : undefined } },
        webServer: { register(route) { captured.route = route; return () => {} } },
      })
      return () => {}
    },
  }
  const disposePlugin = mod.default.apply(ctx)
  const call = async () => {
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
    return payload
  }
  return {
    call,
    dispose() {
      disposePlugin()
      if (prevHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prevHome
      if (prevData === undefined) delete process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR; else process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = prevData
      if (prevTtl === undefined) delete process.env.DSH_BOTTOM_INFO_BAR_UPDATE_TTL_MS; else process.env.DSH_BOTTOM_INFO_BAR_UPDATE_TTL_MS = prevTtl
      rmSync(home, { recursive: true, force: true })
      rmSync(dataDir, { recursive: true, force: true })
    },
  }
}

// 夹具：用纯文件系统搭一个「像真的 clone」的 git 副本（HEAD / config / refs/remotes/origin/HEAD），
// 不依赖机器上装没装 git。（host 的探测也全走只读文件读取，见 test-update-check 的子进程守卫。）
// 包在仓库根（官方布局）；legacySubdir 复现 1.15.0 之前「包在 plugin/ 子目录」的历史安装。
const fixtureDirs = []
function makeRepoFixture(options = {}) {
  const repo = join(mkdtempSync(join(tmpdir(), 'bib-repo-')), options.name || 'repo')
  fixtureDirs.push(repo)
  const gitDir = join(repo, '.git')
  mkdirSync(join(gitDir, 'refs', 'remotes', 'origin'), { recursive: true })
  writeFileSync(join(gitDir, 'HEAD'), 'ref: refs/heads/' + (options.branch || 'main') + '\n')
  writeFileSync(
    join(gitDir, 'config'),
    '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://github.com/songoao25/dsh-bottom-info-bar.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n'
  )
  if (options.defaultBranch) {
    writeFileSync(join(gitDir, 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/' + options.defaultBranch + '\n')
  }
  if (options.packedRefs) writeFileSync(join(gitDir, 'packed-refs'), options.packedRefs)
  const target = options.legacySubdir ? join(repo, 'plugin') : repo
  mkdirSync(target, { recursive: true })
  if (options.withBuildScript) {
    mkdirSync(join(target, 'scripts'), { recursive: true })
    writeFileSync(join(target, 'scripts', 'build.mjs'), '// fixture\n')
  }
  return { repo, target }
}

const npmCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': '^1.10.19' } })
check(
  'host：npm 安装 → 命令为 dsh plugin add …@latest',
  npmCase && npmCase.installMode === 'npm' && /^dsh plugin --profile \S+ add dsh-bottom-info-bar@latest$/.test(npmCase.updateCommand || ''),
  npmCase && { mode: npmCase.installMode, cmd: npmCase.updateCommand }
)
check('host：getUpdateInfo 仍带回当前版本号（未破坏原有用途）', npmCase && typeof npmCase.current === 'string' && npmCase.current.length > 0)
check(
  'host：返回的可用性由「磁盘上的已安装版本」决定（更新完本地副本刷新即可看到新版本）',
  npmCase && npmCase.available === false && npmCase.latest === null,
  npmCase && { available: npmCase.available, latest: npmCase.latest }
)

const linkCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:/opt/example/dsh-bottom-info-bar' } })
check(
  'host：link: 安装但目标不是 git 副本 → 保守退回 git pull（不误报 npm 命令）',
  linkCase && linkCase.installMode === 'link' && linkCase.updateCommand === 'git -C /opt/example/dsh-bottom-info-bar pull --ff-only',
  linkCase && { mode: linkCase.installMode, cmd: linkCase.updateCommand }
)

// ③-a 默认分支上：fetch + merge --ff-only，不依赖上游、不再出现裸 git pull
const onMain = makeRepoFixture({ branch: 'main', defaultBranch: 'main' })
const mainCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + onMain.target } })
check(
  'host：link: 在默认分支 → fetch origin 后 --ff-only 快进默认分支（不依赖上游）',
  mainCase && mainCase.updateCommand === 'git -C ' + onMain.repo + ' fetch origin && git -C ' + onMain.repo + ' merge --ff-only origin/main',
  mainCase && { mode: mainCase.installMode, cmd: mainCase.updateCommand }
)
// ③-a1 历史安装：link 目标曾是仓库内的 plugin/ 子目录（1.15.0 之前），命令仍须以探测到的仓库根为准
const legacy = makeRepoFixture({ branch: 'main', defaultBranch: 'main', legacySubdir: true })
const legacyCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + legacy.target } })
check(
  'host：历史安装的 plugin/ 子目录目标 → 命令仍指向仓库根',
  legacyCase && (legacyCase.updateCommand || '').indexOf('git -C ' + legacy.repo + ' ') === 0
    && (legacyCase.updateCommand || '').indexOf(legacy.target) === -1,
  legacyCase && legacyCase.updateCommand
)
check(
  'host：回归——不能退回「当前分支无上游」就失败的裸 git pull',
  mainCase && !/ pull --ff-only/.test(mainCase.updateCommand || ''),
  mainCase && mainCase.updateCommand
)

// ③-a2 源码副本：main 指向 lib/index.js；lib 虽已入库，本地副本可能改过 src 没重建，
// 只拉代码不重建 = 重启后加载的还是旧 lib，等于「更新了却没生效」。
const withBuild = makeRepoFixture({ branch: 'main', defaultBranch: 'main', withBuildScript: true })
const buildCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + withBuild.target } })
check(
  'host：link: 源码副本 → 命令末尾重建 lib（对齐 install.sh 的 build 步骤）',
  buildCase && buildCase.updateCommand
    === 'git -C ' + withBuild.repo + ' fetch origin && git -C ' + withBuild.repo + ' merge --ff-only origin/main && node ' + join(withBuild.target, 'scripts', 'build.mjs'),
  buildCase && buildCase.updateCommand
)

// ③-b 用户在功能分支上（正是 2026-09-22 用户遇到的情形：分支没推到远端、本地版本落后）
const onBranch = makeRepoFixture({ branch: 'codex/plugin-page-only-config', defaultBranch: 'main' })
const branchCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + onBranch.target } })
check(
  'host：link: 在功能分支 → 先 checkout 默认分支再快进（否则装了也还是分支旧代码）',
  branchCase && branchCase.updateCommand
    === 'git -C ' + onBranch.repo + ' fetch origin && git -C ' + onBranch.repo + ' checkout main && git -C ' + onBranch.repo + ' merge --ff-only origin/main',
  branchCase && { mode: branchCase.installMode, cmd: branchCase.updateCommand }
)
check(
  'host：功能分支未推送（无远端跟踪 ref）也不再产出会失败的 git pull',
  branchCase && !/ pull --ff-only/.test(branchCase.updateCommand || ''),
  branchCase && branchCase.updateCommand
)

// ③-c detached HEAD（用户手动 checkout 过 tag / commit）同样应当回到默认分支
const detached = makeRepoFixture({ branch: '', defaultBranch: 'main' })
writeFileSync(join(detached.repo, '.git', 'HEAD'), '0123456789abcdef0123456789abcdef01234567\n')
const detachedCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + detached.target } })
check(
  'host：detached HEAD → 回到默认分支再快进',
  detachedCase && detachedCase.updateCommand.indexOf(' checkout main ') > 0 && /merge --ff-only origin\/main$/.test(detachedCase.updateCommand || ''),
  detachedCase && detachedCase.updateCommand
)

// ③-d 没有 refs/remotes/origin/HEAD（remote add + fetch 的仓库）→ 从 packed-refs 认出 main
const packed = makeRepoFixture({
  branch: 'feature', packedRefs: '# pack-refs with: peeled fully-peeled sorted \nabcdef0123456789abcdef0123456789abcdef01 refs/remotes/origin/main\n',
})
const packedCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + packed.target } })
check(
  'host：远端没有 HEAD ref 时用 packed-refs 认出默认分支',
  packedCase && packedCase.updateCommand
    === 'git -C ' + packed.repo + ' fetch origin && git -C ' + packed.repo + ' checkout main && git -C ' + packed.repo + ' merge --ff-only origin/main',
  packedCase && packedCase.updateCommand
)

// ③-e 路径带空格必须转义，否则粘到终端直接断词
const spaced = makeRepoFixture({ branch: 'main', defaultBranch: 'main', name: 'dsh bottom info bar' })
const spacedCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + spaced.target } })
check(
  'host：仓库路径带空格 → 单引号转义',
  spacedCase && spacedCase.updateCommand === "git -C '" + spaced.repo + "' fetch origin && git -C '" + spaced.repo + "' merge --ff-only origin/main",
  spacedCase && spacedCase.updateCommand
)

// ③-f linked worktree（.git 是文件 + commondir）：远端信息在 commondir 里
const worktreeRoot = mkdtempSync(join(tmpdir(), 'bib-wt-'))
fixtureDirs.push(worktreeRoot)
const commonGit = join(worktreeRoot, 'common.git')
const wtGit = join(worktreeRoot, 'wt-gitdir')
mkdirSync(join(commonGit, 'refs', 'remotes', 'origin'), { recursive: true })
mkdirSync(wtGit, { recursive: true })
mkdirSync(join(worktreeRoot, 'wt'), { recursive: true })
writeFileSync(join(commonGit, 'config'), '[remote "origin"]\n\turl = https://github.com/songoao25/dsh-bottom-info-bar.git\n')
writeFileSync(join(commonGit, 'refs', 'remotes', 'origin', 'HEAD'), 'ref: refs/remotes/origin/main\n')
writeFileSync(join(wtGit, 'HEAD'), 'ref: refs/heads/main\n')
writeFileSync(join(wtGit, 'commondir'), '../common.git\n')
writeFileSync(join(worktreeRoot, 'wt', '.git'), 'gitdir: ' + wtGit + '\n')
const worktreeCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'link:' + join(worktreeRoot, 'wt') } })
check(
  'host：linked worktree（.git 文件 + commondir）也能读远端默认分支',
  worktreeCase && worktreeCase.updateCommand === 'git -C ' + join(worktreeRoot, 'wt') + ' fetch origin && git -C ' + join(worktreeRoot, 'wt') + ' merge --ff-only origin/main',
  worktreeCase && worktreeCase.updateCommand
)

// ③-g DSH 插件页的「GitHub 仓库地址」安装：更新 = 重跑同一条 add 命令
const gitCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'github:songoao25/dsh-bottom-info-bar' } })
check(
  'host：GitHub 地址安装 → 命令重跑同一条 add（npm 那条会被「已安装」挡下）',
  gitCase && gitCase.installMode === 'git'
    && /^dsh plugin --profile \S+ add github:songoao25\/dsh-bottom-info-bar$/.test(gitCase.updateCommand || ''),
  gitCase && { mode: gitCase.installMode, cmd: gitCase.updateCommand }
)
const pathSpecCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'github:songoao25/dsh-bottom-info-bar#path:plugin' } })
check(
  'host：带 #path: 的历史地址原样重跑（老用户不必换写法；# 会被引号包住，否则 shell 当注释）',
  pathSpecCase && pathSpecCase.updateCommand === "dsh plugin --profile web add 'github:songoao25/dsh-bottom-info-bar#path:plugin'",
  pathSpecCase && pathSpecCase.updateCommand
)
const sshCase = await getUpdateInfoWithProfile({ dependencies: { 'dsh-bottom-info-bar': 'git+ssh://git@github.com/songoao25/dsh-bottom-info-bar.git' } })
check(
  'host：git+ssh 地址同样按重装处理',
  sshCase && sshCase.updateCommand === 'dsh plugin --profile web add git+ssh://git@github.com/songoao25/dsh-bottom-info-bar.git',
  sshCase && sshCase.updateCommand
)

// ---------- ④ 提醒自愈：本地副本更新完，available 必须自己变 false ----------
const pkgDir = mkdtempSync(join(tmpdir(), 'bib-pkg-'))
mkdirSync(join(pkgDir, 'src'), { recursive: true })
for (const file of ['host.js', 'constants.js', 'host-locale.js', 'locales.js', 'self-update.js']) {
  copyFileSync(join(root, 'src', file), join(pkgDir, 'src', file))
}
const setInstalledVersion = (version) => writeFileSync(
  join(pkgDir, 'package.json'),
  JSON.stringify({ name: 'dsh-bottom-info-bar', version: version, type: 'module' })
)
setInstalledVersion('1.16.0')

// 只数发往 npm registry 的请求（host 还会拉远程价目目录，别把它算进来）。
// 判据用「解析后比 hostname」，不写域名字符串包含（守卫 5 / CodeQL 的要求）。
let npmFetches = 0
const isNpmRegistryRequest = (url) => {
  try { return new URL(String(url)).hostname === 'registry.npmjs.org' } catch { return false }
}
globalThis.fetch = async (url) => {
  if (isNpmRegistryRequest(url)) npmFetches += 1
  return { ok: true, status: 200, json: async () => ({ version: '1.16.1' }) }
}
const versionHost = await openUpdateInfoHost({ moduleUrl: pathToFileURL(join(pkgDir, 'src', 'host.js')).href })
const fetchesAfterStartup = npmFetches

const beforeUpdate = await versionHost.call()
check(
  '版本提醒：npm 有新版 → available=true，且带回两端版本号',
  beforeUpdate && beforeUpdate.available === true && beforeUpdate.current === '1.16.0' && beforeUpdate.latest === '1.16.1',
  beforeUpdate && { available: beforeUpdate.available, current: beforeUpdate.current, latest: beforeUpdate.latest }
)
await versionHost.call()
check('版本提醒：TTL 内重复读取不再请求 npm（不打扰 registry）',
  npmFetches === fetchesAfterStartup, '启动后新增 fetch 次数 ' + (npmFetches - fetchesAfterStartup))

// 用户跑完更新命令（或 npm 装上新版）之后：本地那一份的版本号变了
setInstalledVersion('1.16.1')
const afterUpdate = await versionHost.call()
check(
  '版本提醒：本地副本更新到与 npm 同版后，提醒自己消失（不必重启宿主）',
  afterUpdate && afterUpdate.available === false && afterUpdate.current === '1.16.1' && afterUpdate.latest === '1.16.1',
  afterUpdate && { available: afterUpdate.available, current: afterUpdate.current, latest: afterUpdate.latest }
)
check('版本提醒：已安装版本每次从磁盘重读（TTL 内也没多发 npm 请求）',
  npmFetches === fetchesAfterStartup, '启动后新增 fetch 次数 ' + (npmFetches - fetchesAfterStartup))
versionHost.dispose()
rmSync(pkgDir, { recursive: true, force: true })

// TTL 到期后重查 npm：新版本不必等宿主重启才出现
npmFetches = 0
const ttlHost = await openUpdateInfoHost({ updateTtlMs: 0 })
const fetchesAfterTtlStartup = npmFetches
await ttlHost.call()
await ttlHost.call()
await ttlHost.call()
check('版本提醒：TTL 到期后重查 npm（新版本无需重启宿主即可出现）',
  npmFetches - fetchesAfterTtlStartup >= 2, '三次读取新增 fetch 次数 ' + (npmFetches - fetchesAfterTtlStartup))
globalThis.fetch = async () => { throw new Error('offline') }
const flaky = await ttlHost.call()
check(
  '版本提醒：npm 查询失败时保留上一次已知版本（网络抖动不让提醒闪烁）',
  flaky && flaky.latest === '1.16.1',
  flaky && flaky.latest
)
ttlHost.dispose()

const noProfile = await getUpdateInfoWithProfile(null)
check(
  'host：读不到 profile 配置时安全退回 npm 命令（不抛错）',
  noProfile && noProfile.installMode === 'npm' && typeof noProfile.updateCommand === 'string' && noProfile.updateCommand.length > 0,
  noProfile && { mode: noProfile.installMode, cmd: noProfile.updateCommand }
)

for (const dir of fixtureDirs) rmSync(dir, { recursive: true, force: true })

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
