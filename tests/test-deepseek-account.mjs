// deepseek-account（DSH 桌面端内置账号）余额适配回归（issue #173）。
//
// 覆盖五组约束：
//   ① 余额来源与花费归属是两条独立的轴：balanceAccountForProvider 认 deepseek-account，
//      而 accountForProvider 必须**继续返回 null** —— 后者一变，历史花费记录会失主、
//      账户过滤被打开，用户看到「本会话花费突然归零」（issue 里点名的坑）。
//   ② 金额是字符串且语法宽松（big.js：允许省略整数/小数部分与十进制指数，如 '0E-16'）；
//      形态不认识就让整条快照失败、保留上次好数据，绝不伪造成「余额 0」。
//   ③ 官方 total_balance = granted + topped_up：充值钱包 + 赠送钱包求和；
//      币种优先 CNY 其次 USD。
//   ④ 四种降级都给明确 code 且都不 500：服务缺席 / 未登录 / 取数失败 / 调用抛异常。
//   ⑤ 参数对象必须是完整对象（宿主读 client.version 时传 undefined 会抛 TypeError）。
//
// 纯函数层用源码抽取（host.js 只导出默认的插件对象）；端到端走真实 RPC 路由。
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const tmpData = mkdtempSync(join(tmpdir(), 'bib-ds-account-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = tmpData
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpData, 'no-codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpData, 'no-opencode-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_SELF_UPDATE = 'off'

const plugin = (await import('../src/host.js')).default

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail === undefined ? '' : ' — ' + detail)) }
}

// ---------- 纯函数层：从源码抽取，不依赖导出面 ----------
const hostSrc = readFileSync(join(root, 'src', 'host.js'), 'utf8')
function extractFn(name) {
  const start = hostSrc.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('未找到函数 ' + name)
  let depth = 0
  for (let i = hostSrc.indexOf('{', start); i < hostSrc.length; i += 1) {
    if (hostSrc[i] === '{') depth += 1
    else if (hostSrc[i] === '}') {
      depth -= 1
      if (depth === 0) return hostSrc.slice(start, i + 1)
    }
  }
  throw new Error('函数体不闭合 ' + name)
}
const platformListDecl = hostSrc.match(/const PLATFORM_BALANCE_PROVIDERS = \[[^\]]*\]/)
if (!platformListDecl) throw new Error('未找到 PLATFORM_BALANCE_PROVIDERS（余额来源表）')
const constantsSrc = readFileSync(join(root, 'src', 'constants.js'), 'utf8')
const identityDecl = constantsSrc.match(/export const PROVIDER_IDENTITY = (\{[\s\S]*?\n\});?/)
if (!identityDecl) throw new Error('未找到 PROVIDER_IDENTITY（身份总表）')
const pure = new Function(
  platformListDecl[0] + '\n'
  + 'const PROVIDER_IDENTITY = (' + identityDecl[1] + ')\n'
  + extractFn('parseFiniteNonNegativeAmount') + '\n'
  + extractFn('platformWalletSum') + '\n'
  + extractFn('parsePlatformAccountBalance') + '\n'
  + extractFn('accountForProvider') + '\n'
  + extractFn('balanceAccountForProvider') + '\n'
  + 'return { parseFiniteNonNegativeAmount, parsePlatformAccountBalance, accountForProvider, balanceAccountForProvider }',
)()

// ---------- ① 两条轴分离（issue 里点名的坑） ----------
check('花费归属：accountForProvider 仍不认 deepseek-account（历史记录不会失主）',
  pure.accountForProvider('deepseek-account') === null, String(pure.accountForProvider('deepseek-account')))
check('花费归属：accountForProvider 其它映射未被顺手改动（deepseek-official → deepseek）',
  pure.accountForProvider('deepseek-official') === 'deepseek')
check('余额来源：balanceAccountForProvider 认 deepseek-account',
  pure.balanceAccountForProvider('deepseek-account') === 'deepseek-account')
check('余额来源：其它 provider 原样走花费归属表（deepseek-official → deepseek）',
  pure.balanceAccountForProvider('deepseek-official') === 'deepseek')
check('余额来源：未知 provider 仍返回 null（不借用别人的账户）',
  pure.balanceAccountForProvider('some-unknown') === null)

// ---------- ②③ 金额解析 ----------
const ready = (value, bonusWallets) => Object.assign({ status: 'ready', value }, bonusWallets ? { bonusWallets } : {})
check('解析：充值 12.5 + 赠送 3 = 15.5（total_balance = granted + topped_up）',
  JSON.stringify(pure.parsePlatformAccountBalance(ready(
    [{ currency: 'CNY', balance: '12.5' }], [{ currency: 'CNY', balance: '3' }],
  ))) === JSON.stringify({ currency: 'CNY', total: 15.5, granted: 3, toppedUp: 12.5 }))
check('解析：接受 big.js 形态 0E-16（赠送为 0，不是「解析不出来」）',
  JSON.stringify(pure.parsePlatformAccountBalance(ready(
    [{ currency: 'CNY', balance: '5.0000000000000000' }], [{ currency: 'CNY', balance: '0E-16' }],
  ))) === JSON.stringify({ currency: 'CNY', total: 5, granted: 0, toppedUp: 5 }))
check('解析：接受十进制指数 1e+3',
  pure.parsePlatformAccountBalance(ready([{ currency: 'CNY', balance: '1e+3' }])).total === 1000)
check('解析：币种优先 CNY 而非 USD',
  pure.parsePlatformAccountBalance(ready([
    { currency: 'USD', balance: '9' }, { currency: 'CNY', balance: '7' },
  ])).currency === 'CNY')
check('解析：只有 USD 时用 USD',
  pure.parsePlatformAccountBalance(ready([{ currency: 'USD', balance: '9' }])).currency === 'USD')
check('解析：没有任何钱包 → null（不伪造 0 元余额）',
  pure.parsePlatformAccountBalance(ready([])) === null)
check('解析：金额形态非法 → 整条快照失败（保留上次好数据）',
  pure.parsePlatformAccountBalance(ready([{ currency: 'CNY', balance: '12.3garbage' }])) === null)
check('解析：金额为负数 → 整条快照失败',
  pure.parsePlatformAccountBalance(ready([{ currency: 'CNY', balance: '-1' }])) === null)
check('解析：只有赠送钱包也成立（充值 0 + 赠送 2）',
  pure.parsePlatformAccountBalance(ready([], [{ currency: 'CNY', balance: '2' }])).total === 2)
check('解析：status=failed → null',
  pure.parsePlatformAccountBalance({ status: 'failed' }) === null)
check('解析：null（未登录）→ null',
  pure.parsePlatformAccountBalance(null) === null)

// ---------- 端到端：真实 RPC 路由 + 桩宿主账号服务 ----------
function makeStub(options) {
  const opts = options || {}
  const captured = { route: null, getBalanceCalls: [] }
  const credCalls = []
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek-account', model: 'deepseek-flash' }) }
      }
      if (name === 'deepseekAccount') {
        if (opts.account === 'absent') return undefined
        return { getBalance: async (client) => { captured.getBalanceCalls.push(client); return opts.account() } }
      }
      return undefined
    },
    credentials: { resolve: (credName) => { credCalls.push(credName); return Promise.resolve({ value: 'sk-test' }) } },
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
  return { captured, ctx, credCalls }
}

const body = JSON.stringify({ selection: { provider: 'deepseek-account', model: 'deepseek-flash' }, force: true })
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
  for (const cb of listeners.data || []) cb(Buffer.from(body))
  for (const cb of listeners.end || []) cb()
  await pending
  return { status, payload }
}

// 场景 A：已登录 + 充值/赠送钱包 —— 最关键的一条：余额真的出来了
{
  const stub = makeStub({
    account: () => ({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '41.6000000000000000' }],
      bonusWallets: [{ currency: 'CNY', balance: '0E-16' }],
    }),
  })
  const dispose = plugin.apply(stub.ctx)
  await new Promise((r) => setTimeout(r, 30))
  const r = await snapshot(stub.captured.route)
  check('端到端：deepseek-account 不再报「未适配」',
    r.status === 200 && !!r.payload && !r.payload.unmapped,
    JSON.stringify(r.payload && r.payload.unmapped))
  check('端到端：余额 = 充值 41.6 + 赠送 0',
    r.payload && r.payload.data && r.payload.data.total === 41.6 && r.payload.data.currency === 'CNY' && r.payload.error === null,
    JSON.stringify(r.payload && r.payload.data))
  check('端到端：余额 provider 键 = deepseek-account，displayName = DeepSeek',
    r.payload && r.payload.provider === 'deepseek-account' && r.payload.displayName === 'DeepSeek',
    JSON.stringify(r.payload && r.payload.provider))
  check('端到端：非估算（estimate=false，不给真数据戴「估算」帽子）',
    r.payload && r.payload.estimate === false)
  {
    const client = stub.captured.getBalanceCalls[0]
    check('端到端：调用方元数据是完整对象（宿主读 client.version，传 undefined 会抛 TypeError）',
      !!client && typeof client === 'object')
    check('端到端：version 是可读的语义化版本号',
      !!client && typeof client.version === 'string' && /^\d+\.\d+\.\d+/.test(client.version), client && client.version)
    check('端到端：locale 是 BCP-47 形态（zh-CN / en-US）',
      !!client && /^(zh-CN|en-US)$/.test(client.locale), client && client.locale)
    check('端到端：时区是「东为正的秒数」',
      !!client && typeof client.timezoneOffsetSeconds === 'number' && Number.isFinite(client.timezoneOffsetSeconds),
      client && client.timezoneOffsetSeconds)
  }
  check('端到端：全程不读任何 API Key（账号路与 API Key 路互不干涉）',
    stub.credCalls.length === 0, JSON.stringify(stub.credCalls))
  dispose()
}

// 场景 B：未登录（宿主返回 null）→ 配置引导，且不崩
{
  const stub = makeStub({ account: () => null })
  const dispose = plugin.apply(stub.ctx)
  await new Promise((r) => setTimeout(r, 30))
  const r = await snapshot(stub.captured.route)
  check('端到端：未登录 → 200 且 error.code = balance.account-signed-out',
    r.status === 200 && r.payload && r.payload.error && r.payload.error.code === 'balance.account-signed-out',
    JSON.stringify(r.payload && r.payload.error))
  check('端到端：未登录不是「未适配」（那是另一回事，不该混用文案）',
    !!r.payload && !r.payload.unmapped)
  check('端到端：未登录走 no-key 引导槽位（要求用户去设置里做点什么）',
    r.payload && r.payload.error && r.payload.error.kind === 'no-key')
  dispose()
}

// 场景 C：取数失败（宿主返回 { status: 'failed' }）
{
  const stub = makeStub({ account: () => ({ status: 'failed' }) })
  const dispose = plugin.apply(stub.ctx)
  await new Promise((r) => setTimeout(r, 30))
  const r = await snapshot(stub.captured.route)
  check('端到端：取数失败 → 200 且 error.code = balance.account-request-failed',
    r.status === 200 && r.payload && r.payload.error && r.payload.error.code === 'balance.account-request-failed',
    JSON.stringify(r.payload && r.payload.error))
  check('端到端：取数失败按 HTTP 类失败处理（不是配置问题，不去指引用户配 API Key）',
    r.payload && r.payload.error && r.payload.error.kind === 'http')
  dispose()
}

// 场景 D：宿主没有这个服务（老宿主 / 网页端）→ 明确报不可用，不崩
{
  const stub = makeStub({ account: 'absent' })
  const dispose = plugin.apply(stub.ctx)
  await new Promise((r) => setTimeout(r, 30))
  const r = await snapshot(stub.captured.route)
  check('端到端：服务缺席 → 200 且 error.code = balance.account-unavailable',
    r.status === 200 && r.payload && r.payload.error && r.payload.error.code === 'balance.account-unavailable',
    JSON.stringify(r.payload && r.payload.error))
  check('端到端：服务缺席不读 API Key（不会「顺便」去拿 DEEPSEEK_API_KEY）',
    stub.credCalls.length === 0, JSON.stringify(stub.credCalls))
  dispose()
}

// 场景 E：账号服务抛异常 → 归一到 exception，不 500
{
  const stub = makeStub({ account: () => { throw new Error('platform exploded') } })
  const dispose = plugin.apply(stub.ctx)
  await new Promise((r) => setTimeout(r, 30))
  const r = await snapshot(stub.captured.route)
  check('端到端：账号服务抛异常 → 200 且 error.kind = exception（不 500）',
    r.status === 200 && r.payload && r.payload.error && r.payload.error.kind === 'exception',
    r.status + ' ' + JSON.stringify(r.payload && r.payload.error))
  dispose()
}

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
