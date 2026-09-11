// 发布链条契约（Release chain contract）
//
// 发版是一条两段式流水线：
//   第 1 段 Release Please：算版本号 → 写 CHANGELOG → 打标签
//   第 2 段 publish-npm   ：标签 → 校验 → 发布到 npm
//
// 两段之间靠一个**隐式契约**衔接，而这个契约过去没有任何地方写下来、也没有任何检查：
//   标签格式（v 前缀）必须同时被两边认同。
//
// 一旦有人只改一边（例如把 include-v-in-tag 改成 false），标签会变成 `1.10.20`，
// publish-npm 的 `v*.*.*` 触发器永远匹配不上 → **发版静默失败**：GitHub 上有标签有发布页，
// npm 上却永远没有新版本，而且全程没有任何报错。这是整条链上最危险的失效模式。
//
// 本测试把契约变成断言：改坏任何一环，CI 立刻红。
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const readJson = (rel) => JSON.parse(read(rel))

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + detail : '')) }
}

const config = readJson('release-please-config.json')
const manifest = readJson('.release-please-manifest.json')
const publishNpm = read('.github/workflows/publish-npm.yml')
const releasePlease = read('.github/workflows/release-please.yml')

// ---------- 契约 1：标签格式必须两边一致（最关键，失效时静默）----------
//
// Release Please 侧：include-v-in-tag 决定标签是 `v1.2.3` 还是 `1.2.3`。
// publish-npm 侧：`on.push.tags` 的 glob 决定它认哪种标签。
// 两者必须同时为「带 v」或同时为「不带 v」。
const packageKeys = Object.keys(config.packages || {})
const perPackage = config.packages?.[packageKeys[0]] || {}
// 包级设置覆盖顶层设置（release-please 的语义）
const includeVInTag = perPackage['include-v-in-tag'] ?? config['include-v-in-tag'] ?? true
const publishTriggersOnV = /tags:\s*\n\s*-\s*['"]v\*\.\*\.\*['"]/.test(publishNpm)
const publishTriggersOnBare = /tags:\s*\n\s*-\s*['"][0-9*][^'"]*['"]/.test(publishNpm)

check(
  '契约 1a：Release Please 会打出带 v 前缀的标签（include-v-in-tag: true）',
  includeVInTag === true,
  'include-v-in-tag 为 ' + JSON.stringify(includeVInTag) + '，标签将不带 v 前缀'
)
check(
  '契约 1b：publish-npm 的标签触发器与之一致（v*.*.*）',
  publishTriggersOnV && !publishTriggersOnBare,
  '若两侧不一致，发版会静默失败：GitHub 有标签，npm 永远没有新版本，且无任何报错'
)
check(
  '契约 1c：publish-npm 在比较版本号时剥掉 v 前缀（${GITHUB_REF_NAME#v}）',
  publishNpm.includes('${GITHUB_REF_NAME#v}'),
  '否则 tag 1.2.3 与 package.json 的 1.2.3 会被判为不一致而拒绝发布'
)

// ---------- 契约 2：路径与包名必须对齐 ----------
const pluginPkg = readJson('plugin/package.json')

check(
  '契约 2a：release-please 只有一个包路径，且该路径下确实有 package.json',
  packageKeys.length === 1 && existsSync(join(root, packageKeys[0], 'package.json')),
  '配置里的包路径：' + JSON.stringify(packageKeys)
)
check(
  '契约 2b：manifest 的键与配置的包路径完全一致（否则版本号不会写回 package.json）',
  JSON.stringify(Object.keys(manifest)) === JSON.stringify(packageKeys),
  'manifest: ' + JSON.stringify(Object.keys(manifest)) + ' vs 配置: ' + JSON.stringify(packageKeys)
)
check(
  '契约 2c：package-name 与 plugin/package.json 的 name 一致（否则 Release Please 拒绝发布）',
  perPackage['package-name'] === pluginPkg.name,
  '配置: ' + perPackage['package-name'] + ' vs package.json: ' + pluginPkg.name
)
check(
  '契约 2d：changelog-path 指向仓库根目录的 CHANGELOG.md',
  String(perPackage['changelog-path'] || '').replace(/^\//, '') === 'CHANGELOG.md',
  'changelog-path: ' + perPackage['changelog-path']
)
check(
  '契约 2e：标签里不含组件名前缀（include-component-in-tag: false）',
  config['include-component-in-tag'] === false && perPackage['include-component-in-tag'] === false,
  '否则标签会变成 dsh-bottom-info-bar-v1.2.3，publish-npm 的 v*.*.* 匹配不上'
)

// ---------- 契约 3：两段流水线的触发器都要在 ----------
check(
  '契约 3a：release-please 监听 push 到 main（否则合并后不会自动发版）',
  /branches:\s*\n?\s*-?\s*\[?main\]?/.test(releasePlease) && /release-please-action@/.test(releasePlease),
  'release-please.yml 缺少 push→main 触发或缺少 action 调用'
)
check(
  '契约 3b：publish-npm 保留 workflow_dispatch 手动兜底（自动链断了还能人工发版）',
  /workflow_dispatch:/.test(publishNpm),
  '去掉手动入口后，一旦自动链出问题就只能改代码才能发版'
)
check(
  '契约 3c：publish-npm 用 NPM_TOKEN 发布（唯一密钥入口）',
  /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\.NPM_TOKEN\s*\}\}/.test(publishNpm),
  'publish-npm.yml 未把 NPM_TOKEN 接到 NODE_AUTH_TOKEN'
)

// ---------- 契约 4：人工闸门必须仍然存在 ----------
//
// 这条闸门在 auto-merge-own.yml 里，不在本流水线文件中，所以特别容易被误删。
const autoMerge = read('.github/workflows/auto-merge-own.yml')
check(
  '契约 4a：发布 PR 仍被排除在自动合并之外（分支名判别）',
  autoMerge.includes("!startsWith(github.event.pull_request.head.ref, 'release-please--')"),
  '闸门被移除后，发布 PR 会被静默自动合并 —— 即 v2.0.0 事故的直接成因'
)
check(
  '契约 4b：发布 PR 仍被排除在自动合并之外（autorelease 标签判别，兜底）',
  autoMerge.includes("!contains(join(github.event.pull_request.labels.*.name, ','), 'autorelease')"),
  '标签判别是 release-please 改动分支命名时的兜底'
)

// ---------- 契约 5：基准钉子必须还在 ----------
check(
  '契约 5：last-release-sha 仍然钉死（防止提交遍历无限回溯到远古历史）',
  /^[0-9a-f]{40}$/.test(String(config['last-release-sha'] || '')),
  '钉子被移除后，一旦 Release Please 找不到「上次发布」，就会把全部历史当成未发布内容 —— ' +
  '正是 v2.0.0 被判为 major 的成因'
)

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
