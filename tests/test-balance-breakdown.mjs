// 余额悬停明细：充值余额 / 赠金余额（2026-10-07 用户拍板）。
//
// 背景：DSH 把账户余额拆成两类钱包 —— AccountDetails.balance.value 是充值钱包，
// bonusWallets 是赠送钱包，官方文案「充值余额 / 赠金余额」。插件底栏只放得下一个总数，
// 明细放进悬停浮窗。本测试把四条硬约束钉死：
//   ① 赠金为正才展开；赠金为 0 / 缺失 / 非数字 / 负值 → 只有一行，与老版本逐字一致（零回归）；
//   ② 文案逐字对齐 DSH 官方（zh 充值余额/赠金余额，en Topped-up balance/Granted balance），
//      总计那一行仍叫「余额」，不被改成「充值余额」；
//   ③ 渲染真的接了这条明细（源码接线）；
//   ④ 宿主真的把 granted/toppedUp 送到了客户端 —— 走真实 RPC 路由，不是读源码猜。
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmpData = mkdtempSync(join(tmpdir(), 'bib-balance-breakdown-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = tmpData
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpData, 'no-codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpData, 'no-opencode-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_SELF_UPDATE = 'off'

const plugin = (await import('../src/host.js')).default
const { LOCALES } = await import('../src/locales.js')
const clientSrc = readFileSync(join(root, 'src', 'client-bundle.js'), 'utf8')

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail)) }
}

// ---------- 纯函数：从源码抽取（client-bundle 是浏览器 bundle，不能直接 import） ----------
const NL = String.fromCharCode(10)
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('未找到函数 ' + name)
  let depth = 0
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('函数体不闭合 ' + name)
}
const balanceHoverLines = new Function(extractFn(clientSrc, 'balanceHoverLines') + NL + 'return balanceHoverLines')()

// ---------- 真实字典：不另造一份文案，直接用发布的那份 ----------
function formatTemplate(template, params) {
  let out = template
  for (const name of Object.keys(params || {})) {
    out = out.split('{' + name + '}').join(String(params[name]))
  }
  return out
}
function makeT(lang) {
  return function (key, params) {
    const template = LOCALES[lang][key]
    if (typeof template !== 'string') throw new Error('字典缺少键 ' + key + '（' + lang + '）')
    return formatTemplate(template, params)
  }
}
const fmt = (n) => Number(n).toFixed(2)

// ---------- ① 展开规则 ----------
const paid = { currency: 'CNY', total: 15.5, granted: 3, toppedUp: 12.5 }
const zhThree = balanceHoverLines('余额：¥15.50', paid, '¥', makeT('zh'), fmt)
check('赠金为正 → 三行（合计 + 充值余额 + 赠金余额）', zhThree.length === 3, JSON.stringify(zhThree))
check('第一行仍与老版本逐字相同', zhThree[0] === '余额：¥15.50', zhThree[0])
check('第二行 = 充值余额：¥12.50', zhThree[1] === '充值余额：¥12.50', zhThree[1])
check('第三行 = 赠金余额：¥3.00', zhThree[2] === '赠金余额：¥3.00', zhThree[2])

const zero = balanceHoverLines('余额：¥41.60', { currency: 'CNY', total: 41.6, granted: 0, toppedUp: 41.6 }, '¥', makeT('zh'), fmt)
check('赠金为 0 → 只有一行（零回归）', zero.length === 1 && zero[0] === '余额：¥41.60', JSON.stringify(zero))
const absent = balanceHoverLines('余额：¥41.60', { currency: 'CNY', total: 41.6 }, '¥', makeT('zh'), fmt)
check('老快照没有 granted 字段 → 只有一行，不猜', absent.length === 1, JSON.stringify(absent))
const stringy = balanceHoverLines('余额：¥41.60', { currency: 'CNY', total: 41.6, granted: '3', toppedUp: '41.6' }, '¥', makeT('zh'), fmt)
check('granted 是字符串（形态不认识）→ 只有一行，不猜', stringy.length === 1, JSON.stringify(stringy))
const negative = balanceHoverLines('余额：¥1.00', { currency: 'CNY', total: 1, granted: -1, toppedUp: 2 }, '¥', makeT('zh'), fmt)
check('granted 为负 → 不展开', negative.length === 1, JSON.stringify(negative))
const noData = balanceHoverLines('余额：¥1.00', null, '¥', makeT('zh'), fmt)
check('data 缺失 → 只有一行', noData.length === 1, JSON.stringify(noData))
const onlyGranted = balanceHoverLines('余额：¥2.00', { currency: 'CNY', total: 2, granted: 2, toppedUp: 0 }, '¥', makeT('zh'), fmt)
check('只有赠金（充值为 0）→ 仍展开，充值余额显示 ¥0.00', onlyGranted.length === 3 && onlyGranted[1] === '充值余额：¥0.00', JSON.stringify(onlyGranted))
const noToppedUp = balanceHoverLines('余额：¥5.00', { currency: 'CNY', total: 5, granted: 5 }, '¥', makeT('zh'), fmt)
check('toppedUp 缺失但有赠金 → 充值余额按 ¥0.00，不抛也不出现占位符', noToppedUp.length === 3 && noToppedUp[1] === '充值余额：¥0.00', JSON.stringify(noToppedUp))

// ---------- ② 文案对齐 DSH 官方 ----------
check('zh 明细与 DSH 设置页逐字一致（充值余额 / 赠金余额）',
  LOCALES.zh['ui.balanceDetailToppedUp'] === '充值余额：{symbol}{value}' && LOCALES.zh['ui.balanceDetailGranted'] === '赠金余额：{symbol}{value}',
  JSON.stringify([LOCALES.zh['ui.balanceDetailToppedUp'], LOCALES.zh['ui.balanceDetailGranted']]))
check('en 明细与 DSH 设置页逐字一致（Topped-up balance / Granted balance）',
  LOCALES.en['ui.balanceDetailToppedUp'] === 'Topped-up balance: {symbol}{value}' && LOCALES.en['ui.balanceDetailGranted'] === 'Granted balance: {symbol}{value}',
  JSON.stringify([LOCALES.en['ui.balanceDetailToppedUp'], LOCALES.en['ui.balanceDetailGranted']]))
check('总计那一行仍叫「余额」（没被改成「充值余额」）', LOCALES.zh['ui.balance'] === '余额：{symbol}{value}', LOCALES.zh['ui.balance'])
const enThree = balanceHoverLines('Balance: ¥15.50', paid, '¥', makeT('en'), fmt)
check('英文第二/三行 = Topped-up balance: ¥12.50 / Granted balance: ¥3.00',
  enThree.length === 3 && enThree[1] === 'Topped-up balance: ¥12.50' && enThree[2] === 'Granted balance: ¥3.00', JSON.stringify(enThree))

// ---------- ③ 接线：渲染真的用了这条明细 ----------
check('接线：余额 title 由 balanceHoverLines(balTitle, bal.data, …) 拼接',
  clientSrc.includes('const balHoverTitle = balanceHoverLines(balTitle, bal.data, symbol, t, fmt)')
  && clientSrc.includes('{ title: balHoverTitle }'),
  '缺少接线')
check('接线：估算与普通两条路都仍在（明细只是叠加，不改原语义）',
  clientSrc.includes("? t('ui.estimatedBalance', { symbol: symbol, value: fmt(bal.data.total) })")
  && clientSrc.includes(": t('ui.balance', { symbol: symbol, value: fmt(bal.data.total) })"),
  '原 balTitle 分支被改动')

// ---------- ④ 端到端：宿主真的把 granted/toppedUp 送到客户端 ----------
function makeStub(options) {
  const opts = options || {}
  const captured = { route: null }
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
      }
      if (name === 'deepseekAccount') {
        return { getBalance: async () => opts.account() }
      }
      return undefined
    },
    credentials: { resolve: () => Promise.resolve({ value: 'sk-test' }) },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { return () => {} },
    timeout() { return () => {} },
    on() { return () => {} },
    inject(services, cb) {
      cb({
        effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
        connection: { requestRejection() { return undefined } },
        webServer: { register(route) { captured.route = route; return () => {} } },
      })
      return () => {}
    },
  }
  return { captured, ctx }
}

const rpcBody = JSON.stringify({ selection: { provider: 'deepseek-account', model: 'deepseek-flash' }, force: true })
async function snapshot(route) {
  const listeners = {}
  const req = {
    url: '/_dsh/dsh-bottom-info-bar/getBalanceSnapshot',
    method: 'POST',
    headers: { 'sec-fetch-site': 'same-origin' },
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req },
    destroy() {},
  }
  let status = 0
  let payload = null
  const res = { writeHead(s) { status = s }, end(b) { try { payload = JSON.parse(b) } catch { payload = String(b) } } }
  const pending = route.handler(req, res)
  for (const cb of listeners.data || []) cb(Buffer.from(rpcBody))
  for (const cb of listeners.end || []) cb()
  await pending
  return { status, payload }
}

{
  const stub = makeStub({
    account: () => ({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '12.5' }],
      bonusWallets: [{ currency: 'CNY', balance: '3' }],
    }),
  })
  const dispose = plugin.apply(stub.ctx)
  await new Promise((r) => setTimeout(r, 30))
  const r = await snapshot(stub.captured.route)
  const d = r.payload && r.payload.data
  check('端到端：真实 RPC 快照带 granted=3 / toppedUp=12.5 / total=15.5（客户端拿得到拆分）',
    r.status === 200 && !!d && d.granted === 3 && d.toppedUp === 12.5 && d.total === 15.5, JSON.stringify(d))
  if (d) {
    const lines = balanceHoverLines('余额：¥' + fmt(d.total), d, '¥', makeT('zh'), fmt)
    check('端到端：这份真实快照能拼出三行浮窗', lines.length === 3 && lines[1] === '充值余额：¥12.50' && lines[2] === '赠金余额：¥3.00', JSON.stringify(lines))
  }
  dispose()
}

{
  const stub = makeStub({
    account: () => ({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '41.6' }],
      bonusWallets: [{ currency: 'CNY', balance: '0E-16' }],
    }),
  })
  const dispose = plugin.apply(stub.ctx)
  await new Promise((r) => setTimeout(r, 30))
  const r = await snapshot(stub.captured.route)
  const d = r.payload && r.payload.data
  check('端到端：赠金是 0E-16（真实平台形态）→ 客户端只显示一行，零回归',
    !!d && d.granted === 0 && balanceHoverLines('余额：¥41.60', d, '¥', makeT('zh'), fmt).length === 1, JSON.stringify(d))
  dispose()
}

console.log(failures === 0 ? '结果：全部 PASS' : '结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
