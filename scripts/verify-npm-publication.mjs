// 读回校验：确认某个版本在 npm 上真的公开可安装。
//
// 为什么需要它：npm 的发布是**异步**的。`npm publish` 返回 0 只代表「已受理」，
// 版本要等服务端扫描/校验（生命周期状态 validating）结束后才会出现在 registry 上，
// 这期间 https://registry.npmjs.org/<pkg>/<version> 一律 404：
//
//   npm notice Your package is being processed and may take a few minutes to become available.
//
// 实测「上传完成 → 公开可下载」的延迟：
//   2026-09-26  v1.20.4 ~ v1.20.8   74s / 96s / 95s / 95s / 157s
//   2026-09-30  v1.20.9             1098s（≈18 分钟）   ← npm 侧队列劣化
//   2026-09-30  v1.20.10            >25 分钟仍未公开
//
// 所以本脚本**绝不能挂在发布 job 里**：那会把「发包耗时」直接绑到 npm 的服务端队列上，
// 以前几十秒变十几分钟就是这么来的。发布 job 只发不等，校验交给独立的
// .github/workflows/verify-npm-release.yml（后台哨兵，慢也只慢它自己）。
//
// 判定规则只有一条，宽限期就是唯一的旋钮：
//   未公开 且 距发布已超过 NPM_VERIFY_GRACE_MS  => 失败（发布确实没生效）
//   未公开 但 仍在宽限期内                      => 等一会儿；等不到就判「待定」放行
//
// 环境变量：
//   NPM_RELEASE_VERSION  要校验的版本；默认取 package.json，且必须与之一致
//   NPM_RELEASE_EPOCH    该版本的发布时刻（unix 秒）；缺省视为「刚刚发布」
//   NPM_VERIFY_WAIT_MS   最多轮询多久（默认 0 = 只读一次；硬上限 30 分钟）
//   NPM_VERIFY_GRACE_MS  宽限期（默认 45 分钟）
//   NPM_TOKEN            可选；用于失败时报告 npm 服务端生命周期状态
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

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

// latest 只要「不落后于」被校验的版本就算数。npm 的校验队列不保证先来先服务，
// 新版本可能先公开、旧版本后公开，此时 latest 指向更旧的版本只是短暂现象。
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0)
  }
  return 0
}

async function lifecycleStatus() {
  if (!process.env.NPM_TOKEN) return 'unavailable (no token)'
  try {
    const response = await fetch(`${REGISTRY}/-/package/${PACKAGE}/version/${requestedVersion}/status`, {
      headers: { authorization: `Bearer ${process.env.NPM_TOKEN}`, ...noCache },
    })
    if (!response.ok) return `unavailable (HTTP ${response.status})`
    const body = await response.json()
    return typeof body.status === 'string' ? body.status : 'unavailable (empty response)'
  } catch (error) {
    return `unavailable (${error.name || 'network error'})`
  }
}

// 返回 null 表示「完全就绪」，否则返回一条人话原因。
async function publicReadback() {
  const versionResponse = await fetch(`${REGISTRY}/${PACKAGE}/${requestedVersion}`, { headers: noCache })
  if (!versionResponse.ok) return `version metadata HTTP ${versionResponse.status}`
  const version = await versionResponse.json()
  if (version.version !== requestedVersion || typeof version.dist?.integrity !== 'string'
    || !version.dist.integrity.startsWith('sha512-')) return 'version metadata or integrity mismatch'

  const latestResponse = await fetch(`${REGISTRY}/${PACKAGE}/latest`, { headers: noCache })
  if (!latestResponse.ok) return `latest metadata HTTP ${latestResponse.status}`
  const latest = await latestResponse.json()
  if (typeof latest.version !== 'string' || compareVersions(latest.version, requestedVersion) < 0) {
    return `latest still ${latest.version || 'unknown'}`
  }

  // npm publish 可能在恶意软件扫描还没放行时就返回；这里下载用户真正会装到的那份字节，
  // 逐一比对 integrity，避免把「元数据有了、tarball 还是坏的」当成发布成功。
  const tarballUrl = `${REGISTRY}/${PACKAGE}/-/${PACKAGE}-${requestedVersion}.tgz`
  const tarballResponse = await fetch(tarballUrl, { headers: noCache })
  if (!tarballResponse.ok) return `tarball HTTP ${tarballResponse.status}`
  const bytes = Buffer.from(await tarballResponse.arrayBuffer())
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (`sha512-${actual}` !== version.dist.integrity) return 'tarball integrity mismatch'
  return null
}

async function reportPending(last) {
  console.log(`${PACKAGE}@${requestedVersion} 尚未公开：${last}`)
  console.log(`  距发布 ${fmt(releaseAgeMs())}，宽限期 ${fmt(graceMs)}，生命周期状态：${await lifecycleStatus()}`)
}

const deadline = Date.now() + waitMs
let last = ''
for (;;) {
  let problem
  try {
    problem = await publicReadback()
  } catch (error) {
    problem = `readback error: ${error.name || 'network error'}`
  }

  if (!problem) {
    console.log(`${PACKAGE}@${requestedVersion} 已公开、latest 不落后、tarball 完整性校验通过`)
    process.exit(0)
  }

  if (problem !== last) await reportPending(problem)
  last = problem

  if (releaseAgeMs() >= graceMs) {
    console.error(`${PACKAGE}@${requestedVersion} 发布 ${fmt(releaseAgeMs())} 后仍未公开，已超过 ${fmt(graceMs)} 宽限期。`)
    console.error('这说明发布没有真正生效（发布 job 没跑 / 被 npm 拒绝 / 版本号对不上），需要人工排查。')
    process.exit(1)
  }

  if (Date.now() >= deadline) break
  await sleep(Math.min(20_000, Math.max(0, deadline - Date.now())))
}

// 仍在宽限期内：npm 已受理但还没放行。这不是失败，后台哨兵会继续复查。
console.log(`结果：待定 —— npm 已受理 ${PACKAGE}@${requestedVersion}，但 ${fmt(releaseAgeMs())} 后仍在服务端处理中（宽限期 ${fmt(graceMs)}）。`)
console.log('这是 npm 的异步发布队列，与本次发布是否成功无关；定时复查会继续确认它最终公开。')
process.exit(0)
