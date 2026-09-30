// 读回校验 + 自愈：确认某个版本在 npm 上真的公开可安装，并在需要时校正 latest 标签。
//
// 为什么需要它：npm 的发布是**异步**的。`npm publish` 返回 0 只代表「已受理」，
// 版本要等服务端扫描/校验（生命周期状态 validating）结束后才会出现在 registry 上，
// 这期间 https://registry.npmjs.org/<pkg>/<version> 一律 404：
//
//   npm notice Your package is being processed and may take a few minutes to become available.
//
// 实测「上传完成 → 公开可下载」的延迟（同一个包、同样的内容，只有 npm 侧在变）：
//   2026-09-26  v1.20.4 ~ v1.20.8   74s / 96s / 95s / 95s / 157s
//   2026-09-30  v1.20.9             1098s（≈18 分钟）
//   2026-09-30  v1.20.10            1370s（≈23 分钟）
//   2026-09-30  v1.20.11            >25 分钟
// npm 状态页 9 月三次同类事件都写着「Some newly published package versions may take
// longer than expected to become available」。这段延迟我们控制不了。
//
// 我们能控制的两件事，就是本脚本存在的全部理由：
//   1. 绝不把这段等待挂进发布 job（发布 job 只发不等，见 publish-npm.yml）；
//   2. npm 把版本放出来了、却忘了把 latest 指过去时，替它指过去（v1.20.10 就丢了）。
//
// 判定规则：
//   版本公开 + latest 不落后                     => 成功
//   npm 明确说「有，正在 validating」             => 待定放行（已受理，只是慢）
//      但超过 NPM_VERIFY_STUCK_MS（默认 6h）     => 失败（该找 npm 了）
//   npm 说没收到这个版本，且已超过宽限期          => 失败（发布确实没跑成）
//   查不到状态（无 token / 网络失败）             => 退化为按年龄判断
//
// 环境变量：
//   NPM_RELEASE_VERSION        要校验的版本；默认取 package.json，且必须与之一致
//   NPM_RELEASE_EPOCH          该版本的发布时刻（unix 秒）；缺省视为「刚刚发布」
//   NPM_VERIFY_WAIT_MS         最多轮询多久（默认 0 = 只读一次；硬上限 30 分钟）
//   NPM_VERIFY_GRACE_MS        宽限期，默认 45 分钟
//   NPM_VERIFY_STUCK_MS        validating 超过多久算异常，默认 6 小时
//   NPM_VERIFY_REPAIR_DIST_TAG 设为 1 时，允许在 latest 落后时执行 npm dist-tag add
//   NPM_TOKEN                  用于查询生命周期状态、以及校正 latest
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const PACKAGE = 'dsh-bottom-info-bar'
const REGISTRY = 'https://registry.npmjs.org'
const MAX_WAIT_MS = 30 * 60 * 1000
const noCache = { 'cache-control': 'no-cache', pragma: 'no-cache' }

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const requestedVersion = String(process.env.NPM_RELEASE_VERSION || pkg.version).replace(/^v/, '')

if (!/^\d+\.\d+\.\d+$/.test(requestedVersion) || requestedVersion !== pkg.version) {
  throw new Error('Release version must exactly match package.json')
}

function readNumber(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid ${name}`)
  return value
}

const waitMs = Math.min(readNumber('NPM_VERIFY_WAIT_MS', 0), MAX_WAIT_MS)
const graceMs = readNumber('NPM_VERIFY_GRACE_MS', 45 * 60 * 1000)
const stuckMs = readNumber('NPM_VERIFY_STUCK_MS', 6 * 60 * 60 * 1000)
const repairEnabled = process.env.NPM_VERIFY_REPAIR_DIST_TAG === '1' && Boolean(process.env.NPM_TOKEN)
const releaseEpochMs = readNumber('NPM_RELEASE_EPOCH', Math.floor(Date.now() / 1000)) * 1000
const releaseAgeMs = () => Math.max(0, Date.now() - releaseEpochMs)

const fmt = (ms) => {
  const seconds = Math.round(ms / 1000)
  if (seconds < 90) return seconds + 's'
  const minutes = Math.round(seconds / 60)
  if (minutes < 90) return minutes + 'min'
  return (minutes / 60).toFixed(1) + 'h'
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// latest 只要「不落后于」被校验的版本就算数。npm 的校验队列不保证先来先服务。
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

// 生命周期状态是判断「npm 到底收没收到」的唯一权威信号：
//   validating / pending => 已受理，正在服务端校验（metadata 此间一律 404）
//   404                  => npm 根本没有这个版本（发布确实没跑成）
async function lifecycle() {
  if (!process.env.NPM_TOKEN) return { state: 'unknown', detail: 'no token' }
  try {
    const response = await fetch(`${REGISTRY}/-/package/${PACKAGE}/version/${requestedVersion}/status`, {
      headers: { authorization: `Bearer ${process.env.NPM_TOKEN}`, ...noCache },
    })
    if (response.status === 404) return { state: 'missing', detail: 'HTTP 404' }
    if (!response.ok) return { state: 'unknown', detail: `HTTP ${response.status}` }
    const body = await response.json()
    const status = typeof body.status === 'string' ? body.status : 'unknown'
    return { state: status, detail: status }
  } catch (error) {
    return { state: 'unknown', detail: error.name || 'network error' }
  }
}

async function packument() {
  const response = await fetch(`${REGISTRY}/${PACKAGE}`, { headers: noCache })
  if (!response.ok) return null
  return response.json()
}

// 返回 null 表示「版本本身公开且可下载」，否则返回一条人话原因。
async function versionReadback() {
  const versionResponse = await fetch(`${REGISTRY}/${PACKAGE}/${requestedVersion}`, { headers: noCache })
  if (!versionResponse.ok) return `version metadata HTTP ${versionResponse.status}`
  const version = await versionResponse.json()
  if (version.version !== requestedVersion || typeof version.dist?.integrity !== 'string'
    || !version.dist.integrity.startsWith('sha512-')) return 'version metadata or integrity mismatch'

  // npm publish 可能在扫描还没放行时就返回；这里下载用户真正会装到的那份字节，
  // 重算 integrity，避免把「元数据有了、tarball 还是坏的」当成发布成功。
  const tarballUrl = `${REGISTRY}/${PACKAGE}/-/${PACKAGE}-${requestedVersion}.tgz`
  const tarballResponse = await fetch(tarballUrl, { headers: noCache })
  if (!tarballResponse.ok) return `tarball HTTP ${tarballResponse.status}`
  const bytes = Buffer.from(await tarballResponse.arrayBuffer())
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (`sha512-${actual}` !== version.dist.integrity) return 'tarball integrity mismatch'
  return null
}

// npm 有时会把版本放进 registry 却漏掉 latest 标签（v1.20.10 实测）。
// 只在「被校验的版本就是已发布的最高版本」时才动手，避免把 latest 往回指。
async function repairLatestTag(latestVersion) {
  const doc = await packument()
  const published = doc ? Object.keys(doc.versions || {}) : []
  const highest = published.reduce((acc, v) => (/^\d+\.\d+\.\d+$/.test(v) && compareVersions(v, acc) > 0 ? v : acc), '0.0.0')
  if (compareVersions(requestedVersion, highest) < 0) {
    console.log(`latest 停在 ${latestVersion}，但 registry 上已有更高的 ${highest}，不代为校正。`)
    return false
  }
  const spec = `${PACKAGE}@${requestedVersion}`
  console.log(`npm 已公开 ${spec} 但 latest 仍停在 ${latestVersion}，执行 npm dist-tag add ${spec} latest`)
  const result = spawnSync('npm', ['dist-tag', 'add', spec, 'latest'], {
    encoding: 'utf8',
    env: { ...process.env, NODE_AUTH_TOKEN: process.env.NPM_TOKEN, npm_config_registry: REGISTRY },
  })
  const output = `${result.stdout || ''}${result.stderr || ''}`.trim()
  if (output) console.log(output)
  if (result.status !== 0) {
    console.error(`latest 校正失败（exit ${result.status}）`)
    return false
  }
  await sleep(3_000)
  const after = await packument()
  const nowLatest = after?.['dist-tags']?.latest
  console.log(`latest 校正后为 ${nowLatest || 'unknown'}`)
  return nowLatest === requestedVersion
}

const deadline = Date.now() + waitMs
let last = ''
let repairAttempted = false

for (;;) {
  let problem = null
  try {
    problem = await versionReadback()
  } catch (error) {
    problem = `readback error: ${error.name || 'network error'}`
  }

  if (!problem) {
    const doc = await packument()
    const latestVersion = doc?.['dist-tags']?.latest
    if (typeof latestVersion === 'string' && compareVersions(latestVersion, requestedVersion) >= 0) {
      console.log(`${PACKAGE}@${requestedVersion} 已公开、latest=${latestVersion}、tarball 完整性校验通过`)
      process.exit(0)
    }
    if (!repairAttempted && repairEnabled) {
      repairAttempted = true
      if (await repairLatestTag(latestVersion || 'unknown')) {
        console.log(`${PACKAGE}@${requestedVersion} 已公开、latest 已校正、tarball 完整性校验通过`)
        process.exit(0)
      }
    }
    problem = `latest still ${latestVersion || 'unknown'}`
  }

  if (problem !== last) {
    const state = await lifecycle()
    console.log(`${PACKAGE}@${requestedVersion} 尚未就绪：${problem}`)
    console.log(`  距发布 ${fmt(releaseAgeMs())}，宽限期 ${fmt(graceMs)}，npm 生命周期状态：${state.detail}`)
  }
  last = problem

  const state = await lifecycle()

  // npm 明确说「有，正在校验」：已受理，只是慢。等待，但不会因此判失败。
  if (state.state === 'validating' || state.state === 'pending') {
    if (releaseAgeMs() >= stuckMs) {
      console.error(`${PACKAGE}@${requestedVersion} 在 npm 服务端停留 ${fmt(releaseAgeMs())} 仍未公开，超过 ${fmt(stuckMs)} 上限。`)
      console.error('发布本身已受理，但 npm 长时间没有放行，需要联系 npm 支持。')
      process.exit(1)
    }
    if (Date.now() >= deadline) break
    await sleep(Math.min(20_000, Math.max(0, deadline - Date.now())))
    continue
  }

  // npm 根本没有这个版本：这才是「发布确实没跑成」。
  if (releaseAgeMs() >= graceMs) {
    console.error(`${PACKAGE}@${requestedVersion} 发布 ${fmt(releaseAgeMs())} 后仍未公开，且 npm 侧没有该版本（${state.detail}）。`)
    console.error('这说明发布没有真正生效（发布 job 没跑 / 被 npm 拒绝 / 版本号对不上），需要人工排查。')
    process.exit(1)
  }

  if (Date.now() >= deadline) break
  await sleep(Math.min(20_000, Math.max(0, deadline - Date.now())))
}

const finalState = await lifecycle()
console.log(`结果：待定 —— npm 已受理 ${PACKAGE}@${requestedVersion}（状态：${finalState.detail}），${fmt(releaseAgeMs())} 后仍在服务端处理中。`)
console.log('这是 npm 的异步发布队列，与本次发布是否成功无关；定时复查会继续确认它最终公开。')
process.exit(0)
