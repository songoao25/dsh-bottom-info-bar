// Release metadata must move together. A manually bumped package version
// with an older Release Please manifest can make the next release downgrade.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const readJson = (relativePath) => JSON.parse(readFileSync(join(root, relativePath), 'utf8'))

const packageVersion = readJson('plugin/package.json').version
const manifestVersion = readJson('.release-please-manifest.json').plugin
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const firstChangelogVersion = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1]

assert.match(packageVersion, /^\d+\.\d+\.\d+$/, 'plugin/package.json must contain a semantic version')
assert.equal(manifestVersion, packageVersion, 'Release Please manifest and package version must match')
assert.equal(firstChangelogVersion, packageVersion, 'CHANGELOG top entry must match the package version')

console.log(`release metadata OK: v${packageVersion}`)
