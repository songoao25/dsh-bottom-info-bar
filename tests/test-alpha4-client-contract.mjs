import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pluginRoot = join(root, 'plugin')
const pkg = JSON.parse(readFileSync(join(pluginRoot, 'package.json'), 'utf8'))
const patchPath = join(pluginRoot, pkg.dsh.bundle.patch)
const source = readFileSync(join(pluginRoot, 'src', 'client-bundle.js'), 'utf8')
const artifact = readFileSync(join(pluginRoot, 'lib', 'client.js'), 'utf8')

const retiredRuntime = ['@deepseek-ai', 'dsh-client-' + 'runtime'].join('/')
assert.deepEqual(pkg.dsh.client.inject, [
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-settings',
  '@deepseek-ai/dsh-client-ui-settings-general',
])
assert.ok(!pkg.dsh.client.inject.includes(retiredRuntime), 'retired client runtime must not be injected')
assert.ok(existsSync(patchPath), 'bundle patch must exist')
assert.ok(existsSync(join(pluginRoot, pkg.main)), 'host entry must exist')
assert.match(readFileSync(patchPath, 'utf8'), /- insert:/)

assert.match(source, /inject:\s*\['slots'\]/, 'client must wait on the public slots service')
assert.match(source, /slots\.inject\('conversation\.composer\.dock'/, 'composer dock slot must remain registered')
assert.match(source, /slots\.inject\('settings\.section'/, 'settings section slot must remain registered')
assert.match(source, /require\('react'\)/, 'React must stay an external client module')
assert.match(artifact, /window\.__ModuleLoader__\.load/, 'built client must use the DSH module loader')
assert.match(artifact, /require\('react'\)/, 'built client must retain external React loading')

console.log('alpha.4 client contract OK (conversation composer + settings + React)')
