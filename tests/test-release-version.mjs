// Release metadata must move together. A manually bumped package version
// with an older Release Please manifest can make the next release downgrade.
import assert from 'node:assert/strict'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const readJson = (relativePath) => JSON.parse(readFileSync(join(root, relativePath), 'utf8'))

const packageVersion = readJson('package.json').version
// 键是 Release Please 的包路径：包在仓库根，所以是 "."
const manifestVersion = readJson('.release-please-manifest.json')['.']
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
const firstChangelogVersion = changelog.match(/^## \[(\d+\.\d+\.\d+)\]/m)?.[1]

assert.match(packageVersion, /^\d+\.\d+\.\d+$/, 'package.json must contain a semantic version')
assert.equal(manifestVersion, packageVersion, 'Release Please manifest and package version must match')
assert.equal(firstChangelogVersion, packageVersion, 'CHANGELOG top entry must match the package version')

// 旧安装路径兼容层：仓库里保留 `plugin/` 软链，指向仓库根的同名文件与目录，
// 让 1.15.0 及更早用本地代码安装（profile 里是 `link: <仓库>/plugin`）的用户不必重装。
// 软链一旦丢失或指错，这些老用户的插件会在下次启动时静默加载失败 —— 所以在这里钉死。
for (const name of ['package.json', 'lib', 'locale', 'cordis.patch.yml']) {
  const link = join(root, 'plugin', name)
  assert.ok(existsSync(link), 'legacy shim missing: plugin/' + name)
  assert.ok(lstatSync(link).isSymbolicLink(), 'plugin/' + name + ' must be a symlink')
  assert.equal(readlinkSync(link), '../' + name, 'plugin/' + name + ' must point at ../' + name)
}
assert.ok(existsSync(join(root, 'plugin', 'lib', 'index.js')), 'plugin/lib must resolve to the built host entry')

console.log(`release metadata OK: v${packageVersion}`)
