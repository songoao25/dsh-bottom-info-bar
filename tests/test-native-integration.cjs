// DSH Go native integration (the card lives in the plugin's own secondary page):
//   - no composer.strip; the native conversation has no long bar below the composer;
//   - exactly one panel; the "Plugins" button opens the plugin page and renders it;
//   - the card is filled by a background poll of the most recently used conversation
//     and the plugin's real balance / subscription / billing / ledger functions;
//   - 本对话 (ui.thisChat), not 本场/本会话, in all 13 dictionaries.
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const native = fs.readFileSync(path.join(root, 'src', 'native.js'), 'utf8')
const host = fs.readFileSync(path.join(root, 'src', 'host.js'), 'utf8')
const locales = fs.readFileSync(path.join(root, 'src', 'locales.js'), 'utf8')
const build = fs.readFileSync(path.join(root, 'scripts', 'build.mjs'), 'utf8')

let pass = 0
let fail = 0
function check(name, condition) {
  if (condition) {
    pass += 1
    console.log('PASS  ' + name)
  } else {
    fail += 1
    console.log('FAIL  ' + name)
  }
}

const dshGo = pkg.dshGo || {}
const contributes = dshGo.contributes || {}
const panels = contributes.panels || []

check('dshGo 清单 v1 / minApp / wallet 图标', dshGo.v === 1 && typeof dshGo.minApp === 'string' && dshGo.icon === 'wallet')
check('没有 composer.strip（原生对话不挂长条）', !contributes['composer.strip'])
check('只有一个 panel，覆盖 chat.panel / session.tab / features',
  panels.length === 1 && panels[0].id === 'info-panel'
  && Array.isArray(panels[0].placement)
  && ['chat.panel', 'session.tab', 'features'].every((p) => panels[0].placement.includes(p)))
check('不再注册胶囊 / 加号菜单 / 回合脚注 / 会话信息',
  !contributes['composer.actions'] && !contributes['composer.tools']
  && !contributes['turn.note'] && !contributes['session.actions'])
check('host 导入并调用 registerNative', host.includes("import { registerNative } from './native.js'") && host.includes('registerNative(ctx, {'))
check('registerNative 拿到真实数据函数 + 余额强制刷新',
  host.includes('getUsageSummary,') && host.includes('currentSessionSummary,')
  && host.includes('activeBalanceSummary,') && host.includes('refreshBalanceForNative,')
  && host.includes('getSubscriptionSnapshotRpc,') && host.includes('getBillingSnapshotRpc,')
  && host.includes('detectBillingMode,'))
check('native 只注册面板，不再注册 strip',
  native.includes("dshGo.panel('info-panel'") && !native.includes("dshGo.strip("))
check('后台轮询最近使用的会话（不依赖 App 的面板 data 流）',
  native.includes('recentSession()') && native.includes('listSessionFiles()')
  && native.includes('setInterval(function () { tick(false)') && native.includes('REFRESH_MS'))
check('原生会话从 session 记录解析 provider/model', native.includes('readSessionSelection') && native.includes("rec.type !== 'assistant/message'") && native.includes('.source'))
check('面板使用最近一次真实快照，不会把别的对话的数字画到当前对话',
  native.includes('cache.get(keyOf(scope))') && native.includes('scope && scope.sessionId ? null : last'))
check('面板指标/明细使用真实余额、订阅窗口、账单、账本',
  native.includes('refreshBalanceForNative') && native.includes('getSubscriptionSnapshotRpc')
  && native.includes('getBillingSnapshotRpc') && native.includes('currentSessionSummary(null, sessionId)'))
check('面板刷新按钮强制刷新余额并返回 refresh',
  native.includes("load(scope, true)") && native.includes("return { refresh: true }"))
check('「本对话」标签（zh）', /"ui.thisChat": "本对话"/.test(locales) && native.includes("chatLabel(locale)"))
check('13 个语言都有 ui.thisChat（字典对称）', (locales.match(/"ui\.thisChat":/g) || []).length === 13)
check('面板是静态快照视图，不依赖 App 的 data 绑定',
  !native.includes("{ $: 'data.") && native.includes("type: 'stack'") && native.includes("type: 'keyValue'"))
check('build 会把 native.js 复制进 lib', /native\.js/.test(build))

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL')
process.exit(fail === 0 ? 0 : 1)
