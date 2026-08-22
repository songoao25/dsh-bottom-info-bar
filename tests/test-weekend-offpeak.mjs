// 周末全天空闲价（端到端，桩环境，直接 import 源码）：
// DeepSeek 官方自 2026-08-23（周日）00:00 北京时间起，周末（按北京日历的
// 周六、周日）全天按空闲价计费，换算成 UTC 是 2026-08-22T16:00:00Z。
// 这里通过真实的 getPricing RPC 打进 host.js 的 currentPeriod / nextSwitchAt，
// 而不是在测试里另抄一份判定——抄一份就抓不到源码里的错。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpData = mkdtempSync(join(tmpdir(), 'bib-weekend-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = tmpData
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpData, 'no-codex-auth.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpData, 'no-opencode-auth.json')

const plugin = (await import('../plugin/src/host.js')).default

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ version: '0.0.0' }) })

function makeStub() {
  const captured = { route: null }
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-v4-flash' }) }
      }
      return undefined
    },
    credentials: { resolve: async () => { throw new Error('no-key') } },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { return () => {} },
    timeout() { return () => {} },
    on() { return () => {} },
    inject(services, cb) {
      cb({
        effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } },
        webServer: { register(route) { captured.route = route; return () => {} } },
      })
      return () => {}
    },
  }
  return { captured, ctx }
}

async function invoke(route, path) {
  const listeners = {}
  const req = { url: path, method: 'GET', headers: {}, on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req }, destroy() {} }
  let status = 0
  let payload = null
  const res = { writeHead(s) { status = s }, end(b) { try { payload = JSON.parse(b) } catch { payload = String(b) } } }
  const pending = route.handler(req, res)
  for (const cb of listeners.end || []) cb()
  await pending
  return { status, payload }
}

const stub = makeStub()
plugin.apply(stub.ctx)
await new Promise((r) => setTimeout(r, 30))

const realNow = Date.now
/** 把时钟钉在某个 UTC 时刻，走一遍真正的 getPricing。 */
async function pricingAt(iso) {
  const fixed = Date.parse(iso)
  Date.now = () => fixed
  try {
    return (await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/getPricing')).payload
  } finally {
    Date.now = realNow
  }
}

// 北京星期，用来证明下面每个时刻确实落在注释说的那一天上。
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
function bjDay(iso) { return WEEK[new Date(Date.parse(iso) + 8 * 3600 * 1000).getUTCDay()] }

// ---------- ① 生效后的周末，峰段时间也按空闲价 ----------
{
  check('2026-08-23T01:30Z 是北京周日', bjDay('2026-08-23T01:30:00Z') === '周日')
  const p = await pricingAt('2026-08-23T01:30:00Z') // 周日 09:30 北京
  check('周末 09:30 北京 → offpeak（旧代码在这里报 peak，按两倍价记账）',
    p.period === 'offpeak', 'period=' + (p && p.period))
  const q = await pricingAt('2026-08-29T07:00:00Z') // 周六 15:00 北京
  check('2026-08-29T07:00Z 是北京周六', bjDay('2026-08-29T07:00:00Z') === '周六')
  check('周末 15:00 北京 → offpeak', q.period === 'offpeak', 'period=' + (q && q.period))
}

// ---------- ② 工作日不受影响 ----------
{
  const p = await pricingAt('2026-08-24T01:30:00Z') // 周一 09:30 北京
  check('2026-08-24T01:30Z 是北京周一', bjDay('2026-08-24T01:30:00Z') === '周一')
  check('工作日 09:30 北京 → peak（原有行为不变）', p.period === 'peak', 'period=' + (p && p.period))
  const q = await pricingAt('2026-08-24T05:00:00Z') // 周一 13:00 北京
  check('工作日 13:00 北京 → offpeak（原有行为不变）', q.period === 'offpeak', 'period=' + (q && q.period))
}

// ---------- ③ 周末是北京的周末，不是 UTC 的 ----------
// 北京的周末从周五 16:00 UTC 到周日 16:00 UTC。UTC 日历和北京日历只在
// 16:00–24:00 UTC 这一段不一致，而两个峰段窗口都不在这一段里——所以拿
// 未平移的 UTC 星期去判断，今天写什么用例都能过，等哪天峰段挪过 16:00
// UTC 才开始出错。这两条钉的就是那条平移。
{
  const p = await pricingAt('2026-08-28T16:30:00Z') // UTC 周五，北京周六 00:30
  check('2026-08-28T16:30Z 在 UTC 是周五，在北京是周六', bjDay('2026-08-28T16:30:00Z') === '周六')
  check('UTC 周五 16:30 → 已进北京周末 → offpeak', p.period === 'offpeak', 'period=' + (p && p.period))
  const q = await pricingAt('2026-08-23T16:00:00Z') // 北京周一 00:00 整
  check('2026-08-23T16:00Z 是北京周一', bjDay('2026-08-23T16:00:00Z') === '周一')
  check('周日 16:00 UTC 起就是北京周一，周末规则到此为止', q.period === 'offpeak' && q.mode === 'peak-valley')
}

// ---------- ④ 生效时刻之前，答案必须和从前一样 ----------
{
  check('2026-08-15T01:00Z 是北京周六', bjDay('2026-08-15T01:00:00Z') === '周六')
  const p = await pricingAt('2026-08-15T01:00:00Z') // 新规生效前的周六 09:00 北京
  check('新规生效前的周六 09:00 → 仍是 peak（回放旧账本不被改价）',
    p.period === 'peak', 'period=' + (p && p.period))
  const q = await pricingAt('2026-08-22T16:00:00Z') // 生效的第一毫秒
  check('新规第一刻（北京周日 00:00）→ offpeak', q.period === 'offpeak', 'period=' + (q && q.period))
}

// ---------- ⑤ 倒计时不能承诺一个不会发生的切换 ----------
{
  const p = await pricingAt('2026-08-23T01:30:00Z') // 周日 09:30 北京
  const hours = p.nextSwitch ? (p.nextSwitch.at - Date.parse('2026-08-23T01:30:00Z')) / 3600000 : null
  check('周日 09:30 北京，下次切换是周一 09:00（23.5 小时后），不是 2.5 小时后',
    p.nextSwitch && p.nextSwitch.atLabel === '09:00' && Math.abs(hours - 23.5) < 1e-6,
    'atLabel=' + (p.nextSwitch && p.nextSwitch.atLabel) + ' hours=' + hours)
  const q = await pricingAt('2026-08-28T10:30:00Z') // 周五 18:30 北京
  const qh = q.nextSwitch ? (q.nextSwitch.at - Date.parse('2026-08-28T10:30:00Z')) / 3600000 : null
  check('周五 18:30 北京，跨过整个周末，下次切换在 62.5 小时后的周一 09:00',
    q.nextSwitch && q.nextSwitch.atLabel === '09:00' && Math.abs(qh - 62.5) < 1e-6,
    'atLabel=' + (q.nextSwitch && q.nextSwitch.atLabel) + ' hours=' + qh)
  const r = await pricingAt('2026-08-24T01:30:00Z') // 周一 09:30 北京
  const rh = r.nextSwitch ? (r.nextSwitch.at - Date.parse('2026-08-24T01:30:00Z')) / 3600000 : null
  check('工作日的倒计时一如从前：周一 09:30 → 2.5 小时后 12:00',
    r.nextSwitch && r.nextSwitch.atLabel === '12:00' && Math.abs(rh - 2.5) < 1e-6,
    'atLabel=' + (r.nextSwitch && r.nextSwitch.atLabel) + ' hours=' + rh)
}

rmSync(tmpData, { recursive: true, force: true })
console.log(failures === 0 ? '结果：全部 PASS' : '结果：' + failures + ' FAIL')
process.exit(failures === 0 ? 0 : 1)
