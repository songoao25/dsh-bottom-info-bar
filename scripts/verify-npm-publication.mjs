import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const PACKAGE = 'dsh-bottom-info-bar'
const REGISTRY = 'https://registry.npmjs.org'
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version
const requestedVersion = (process.env.NPM_RELEASE_VERSION || packageVersion).replace(/^v/, '')
const timeoutMs = process.env.NPM_VERIFY_TIMEOUT_MS === undefined || process.env.NPM_VERIFY_TIMEOUT_MS === ''
  ? 25 * 60 * 1000 : Number(process.env.NPM_VERIFY_TIMEOUT_MS)

if (!/^\d+\.\d+\.\d+$/.test(requestedVersion) || requestedVersion !== packageVersion) {
  throw new Error('Release version must exactly match package.json')
}
if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 30 * 60 * 1000) {
  throw new Error('Invalid npm verification timeout')
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const noCache = { 'cache-control': 'no-cache', pragma: 'no-cache' }

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

async function publicReadback() {
  const versionResponse = await fetch(`${REGISTRY}/${PACKAGE}/${requestedVersion}`, { headers: noCache })
  if (!versionResponse.ok) return `version metadata HTTP ${versionResponse.status}`
  const version = await versionResponse.json()
  if (version.version !== requestedVersion || typeof version.dist?.integrity !== 'string'
    || !version.dist.integrity.startsWith('sha512-')) return 'version metadata or integrity mismatch'

  const latestResponse = await fetch(`${REGISTRY}/${PACKAGE}/latest`, { headers: noCache })
  if (!latestResponse.ok) return `latest metadata HTTP ${latestResponse.status}`
  const latest = await latestResponse.json()
  if (latest.version !== requestedVersion) return `latest still ${latest.version || 'unknown'}`

  // npm publish can finish while its malware scan still holds the tarball.
  // Download and verify the same bytes a user would install before declaring success.
  const tarballUrl = `${REGISTRY}/${PACKAGE}/-/${PACKAGE}-${requestedVersion}.tgz`
  const tarballResponse = await fetch(tarballUrl, { headers: noCache })
  if (!tarballResponse.ok) return `tarball HTTP ${tarballResponse.status}`
  const bytes = Buffer.from(await tarballResponse.arrayBuffer())
  const actual = createHash('sha512').update(bytes).digest('base64')
  if (`sha512-${actual}` !== version.dist.integrity) return 'tarball integrity mismatch'
  return null
}

const deadline = Date.now() + timeoutMs
let last = ''
do {
  try {
    const problem = await publicReadback()
    if (!problem) {
      console.log(`${PACKAGE}@${requestedVersion} is public, latest, downloadable, and integrity-verified`)
      process.exit(0)
    }
    if (problem !== last) console.log(`npm ${requestedVersion} pending: ${problem}`)
    last = problem
  } catch (error) {
    last = `readback error: ${error.name || 'network error'}`
    console.log(`npm ${requestedVersion} pending: ${last}`)
  }
  if (Date.now() >= deadline) break
  await sleep(Math.min(30_000, Math.max(0, deadline - Date.now())))
} while (true)

console.error(`npm ${requestedVersion} is not publicly installable: ${last}; lifecycle status: ${await lifecycleStatus()}`)
process.exit(1)
