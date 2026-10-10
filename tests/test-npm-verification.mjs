// Exercise the publication checker as a CLI. Every registry response is synthetic;
// no npm credentials, network access, or dist-tag mutations are used.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const temporary = mkdtempSync(join(tmpdir(), 'npm-readback-test-'))
const preload = join(temporary, 'fetch-stub.mjs')
const trace = join(temporary, 'requests.jsonl')

writeFileSync(preload, `
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
const { TEST_NPM_SCENARIO: scenario, TEST_NPM_PACKAGE: name, TEST_NPM_VERSION: version } = process.env
const registry = 'https://registry.npmjs.org'
const bytes = Buffer.from('synthetic publication bytes, not a real package')
const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64')
const published = ['public', 'corrupt-tarball', 'stale-latest'].includes(scenario)
const response = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json' },
})
globalThis.fetch = async (input) => {
  const url = String(input)
  appendFileSync(process.env.TEST_NPM_TRACE, JSON.stringify(url) + '\\n')
  if (url === registry + '/-/package/' + name + '/version/' + version + '/status') {
    if (scenario === 'missing') return response({}, 404)
    if (scenario === 'unauthorized') return response({}, 401)
    if (scenario === 'validating' || scenario === 'pending') return response({ status: scenario })
    return response({ status: 'unknown' })
  }
  if (url === registry + '/' + name + '/' + version) {
    if (!published) return response({}, 404)
    return response({ version, dist: { integrity } })
  }
  if (url === registry + '/' + name + '/-/' + name + '-' + version + '.tgz') {
    return new Response(scenario === 'corrupt-tarball' ? Buffer.from('tampered bytes') : bytes)
  }
  if (url === registry + '/' + name) {
    return response({ versions: { [version]: {} }, 'dist-tags': {
      latest: scenario === 'stale-latest' ? '0.0.0' : version,
    } })
  }
  throw new Error('Unexpected URL in offline publication test: ' + url)
}
`)

function run(scenario, hasToken = true) {
  writeFileSync(trace, '')
  const child = spawnSync(process.execPath, [
    '--import', pathToFileURL(preload).href,
    join(root, 'scripts', 'verify-npm-publication.mjs'),
  ], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      NPM_TOKEN: hasToken ? 'synthetic-test-token' : '',
      NODE_AUTH_TOKEN: '',
      NPM_RELEASE_VERSION: pkg.version,
      NPM_RELEASE_EPOCH: String(Math.floor(Date.now() / 1000)),
      NPM_VERIFY_WAIT_MS: '0',
      NPM_VERIFY_GRACE_MS: '3600000',
      NPM_VERIFY_STUCK_MS: '3600000',
      NPM_VERIFY_REPAIR_DIST_TAG: '0',
      TEST_NPM_SCENARIO: scenario,
      TEST_NPM_PACKAGE: pkg.name,
      TEST_NPM_VERSION: pkg.version,
      TEST_NPM_TRACE: trace,
    },
  })
  assert.ifError(child.error)
  const output = `${child.stdout || ''}${child.stderr || ''}`
  const requests = readFileSync(trace, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  assert.ok(requests.some(url => url === `https://registry.npmjs.org/${pkg.name}/${pkg.version}`), 'must read version metadata')
  return { status: child.status, output, requests }
}

let passed = 0
function check(name, test) {
  test()
  passed += 1
  console.log(`PASS ${name}`)
}

try {
  check('missing version fails within grace period without claiming acceptance', () => {
    const result = run('missing')
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /HTTP 404/)
    assert.doesNotMatch(result.output, /已受理/)
  })
  check('no lifecycle token is unknown, not accepted or successful', () => {
    const result = run('no-token', false)
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /no token/)
    assert.doesNotMatch(result.output, /已受理/)
    assert.ok(result.requests.every(url => !url.endsWith('/status')), 'must not request authenticated lifecycle without a token')
  })
  check('unauthorized lifecycle is unknown, not accepted', () => {
    const result = run('unauthorized')
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /HTTP 401/)
    assert.doesNotMatch(result.output, /已受理/)
  })
  for (const state of ['validating', 'pending']) {
    check(`${state} acknowledges acceptance but remains a failed public readback`, () => {
      const result = run(state)
      assert.equal(result.status, 1, result.output)
      assert.match(result.output, /已受理/)
      assert.match(result.output, new RegExp(state))
      assert.doesNotMatch(result.output, /tarball 完整性校验通过/)
    })
  }
  check('public metadata, matching SHA-512 bytes and latest succeed', () => {
    const result = run('public', false)
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /已公开/)
    assert.match(result.output, /tarball 完整性校验通过/)
    assert.ok(result.requests.some(url => url.endsWith('.tgz')), 'must download and hash the tarball')
    assert.ok(result.requests.some(url => url === `https://registry.npmjs.org/${pkg.name}`), 'must read latest')
  })
  check('public metadata with corrupted tarball must fail', () => {
    const result = run('corrupt-tarball', false)
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /tarball integrity mismatch/)
    assert.doesNotMatch(result.output, /tarball 完整性校验通过/)
    assert.doesNotMatch(result.output, /已受理/)
  })
  check('valid tarball with stale latest must fail without repair permission', () => {
    const result = run('stale-latest', false)
    assert.equal(result.status, 1, result.output)
    assert.match(result.output, /latest still 0\.0\.0/)
    assert.doesNotMatch(result.output, /tarball 完整性校验通过/)
    assert.doesNotMatch(result.output, /已受理/)
  })
  console.log(`${passed} offline npm publication checks passed`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
