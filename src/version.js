// Bottom Info Bar — 版本身份与语义化比较：唯一的定义处。
// host（读包版本、检查更新）与自更新引擎（比版本、拼 registry 地址）共用这一份；
// 以前两边各抄一份同正则，真改比较规则时必然漏改一边。
// 注意：本文件与 host.js / self-update.js 同在 src/（构建后同在 lib/），
// 所以 '../package.json' 在两边解析到同一个包根，PACKAGE_FILE/DIR 放在这里是安全的。
import { readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_NAME = 'dsh-bottom-info-bar'
export const UPDATE_REGISTRY_ORIGIN = 'https://registry.npmjs.org'
export const UPDATE_REGISTRY_URL = UPDATE_REGISTRY_ORIGIN + '/' + PACKAGE_NAME + '/latest'
export const PACKAGE_FILE = new URL('../package.json', import.meta.url)
export const PACKAGE_DIR = dirname(fileURLToPath(PACKAGE_FILE))

// 运行中代码的版本号：读包内 package.json（构建产物与源码同包，路径同构）。
export function packageVersion() {
  try {
    const pkg = JSON.parse(readFileSync(PACKAGE_FILE, 'utf8'))
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

// 语义化版本比较：只接受 x.y.z（可带 v 前缀），返回 [major, minor, patch] 或 null。
export function parseSemver(value) {
  const match = typeof value === 'string' && value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareSemver(left, right) {
  const a = parseSemver(left)
  const b = parseSemver(right)
  if (!a || !b) return 0
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1
  }
  return 0
}
