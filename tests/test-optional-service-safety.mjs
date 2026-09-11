// Issue #67 回归：宿主缺少可选服务时，绝不能让整个 getUsageSummary 打挂。
//
// cordis 4 的 Context 是 Proxy：读取未 provide 的服务属性会抛
// "cannot get property \"X\" without inject"。旧实现用裸属性访问兜底探测
// sessionController，于是在没有该服务的宿主上恒返 HTTP 500，界面显示
// 「花费获取失败 / 刷新失败」。
//
// 同类教训本仓库已有先例：host-locale.js 的 v1.10.1 崩溃修复（ctx.settings）。
// 本测试的 ctx 桩带「敌意 Proxy」——访问未知属性即抛错，精确复刻 cordis 4 的脾气。
// 现有 test-session-lineage.mjs 的普通对象桩对未知属性只返回 undefined，天然测不出这类 bug。
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })

const records = [
  { id: 'root-call', ts: 1787000000000, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'root', input: 10, cacheRead: 0, cacheWrite: 0, output: 1, currency: 'CNY', cost: 1 },
  { id: 'child-call', ts: 1787000000001, model: 'deepseek-chat', provider: 'deepseek', sessionId: 'child', input: 20, cacheRead: 0, cacheWrite: 0, output: 2, currency: 'CNY', cost: 2 },
]
const lineage = [
  { sessionId: 'root' },
  { sessionId: 'child', parentSessionId: 'root', origin: 'subagent' },
]

// cordis 4 语义：Inject 满足时以子 ctx 回调，且所列服务在该子 ctx 内是合法属性。
function childCtx(names, services) {
  return new Proxy({
    get(name) { return services[name] },
    on() { return () => {} },
    effect(fn) { const dispose = fn(); return () => dispose && dispose() },
  }, {
    get(target, prop, receiver) {
      if (typeof prop === 'symbol' || prop === 'then') return Reflect.get(target, prop, receiver)
      if (Reflect.has(target, prop)) return Reflect.get(target, prop, receiver)
      if (names.includes(prop)) return services[prop]
      throw new Error('cannot get property "' + String(prop) + '" without inject')
    },
  })
}

// 敌意宿主：访问任何未声明的属性都抛错（= cordis 4 proxy 的真实行为）。
// options.getThrows 用于模拟连 ctx.get 都不可用的极老宿主。
function makeHostCtx(services, options = {}) {
  const target = {
    get: options.getThrows
      ? function () { throw new Error('ctx.get is unavailable on this host') }
      : function (name) {
        if (name === 'agentDefaultModel') return { currentSelection: () => ({ provider: 'deepseek', model: 'deepseek-chat' }) }
        return services[name]
      },
    credentials: { resolve: async () => null },
    interval() { return () => {} },
    timeout() { return () => {} },
    on() { return () => {} },
    // cordis：仅当所列服务全部就绪时才回调；缺席则保持静默。
    inject(names, callback) {
      if (names.every(function (name) { return services[name] !== undefined })) callback(childCtx(names, services))
      return () => {}
    },
  }
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (typeof prop === 'symbol' || prop === 'then') return Reflect.get(t, prop, receiver)
      if (Reflect.has(t, prop)) return Reflect.get(t, prop, receiver)
      // ← 关键：复刻 cordis 4 的抛错行为，而不是返回 undefined
      throw new Error('cannot get property "' + String(prop) + '" without inject')
    },
  })
}

async function runScenario(label, services, options = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'bib-optsvc-'))
  process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = dataDir
  process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(dataDir, 'no-codex.json')
  process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(dataDir, 'no-opencode.json')
  writeFileSync(join(dataDir, 'usage-records.json'), JSON.stringify(records))

  const captured = { route: null }
  const full = Object.assign({
    webServer: { register(route) { captured.route = route; return () => {} } },
  }, services)

  const mod = await import('../plugin/src/host.js?optsvc=' + encodeURIComponent(label + dataDir))
  const plugin = mod.default
  const ctx = makeHostCtx(full, options)
  const dispose = plugin.apply(ctx)

  const listeners = {}
  const req = { url: '/_dsh/dsh-bottom-info-bar/getUsageSummary', method: 'POST', headers: {}, on(name, listener) { (listeners[name] ||= []).push(listener); return req }, destroy() {} }
  let status = 0
  let payload = null
  const pending = captured.route.handler(req, {
    writeHead(code) { status = code },
    end(text) { try { payload = JSON.parse(text) } catch (err) { payload = text } },
  })
  for (const listener of listeners.data || []) listener(Buffer.from(JSON.stringify({ sessionId: 'root', selection: { provider: 'deepseek', model: 'deepseek-chat' } })))
  for (const listener of listeners.end || []) listener()
  await pending
  dispose()
  rmSync(dataDir, { recursive: true, force: true })
  return { status, payload }
}

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? ' — ' + JSON.stringify(detail) : '')) }
}

// 场景 1：宿主没有 sessionController（Issue #67 复现条件）→ 必须 200，且安全降级为“只算选中会话”
const missing = await runScenario('missing', {})
check('缺少 sessionController 时仍返回 200 而非 500', missing.status === 200, missing)
check('缺少 sessionController 时降级为只算选中会话（不含子代理）',
  missing.payload && missing.payload.currentSession && missing.payload.currentSession.tokens === 11 && missing.payload.currentSession.costs.CNY === 1,
  missing.payload && missing.payload.currentSession)

// 场景 2：宿主提供 sessionController → 谱系归并照常生效（确认修复没有削弱原有能力）
const present = await runScenario('present', { sessionController: { list: async () => ({ items: lineage }) } })
check('提供 sessionController 时谱系归并仍然生效（含子代理）',
  present.payload && present.payload.currentSession && present.payload.currentSession.tokens === 33 && present.payload.currentSession.costs.CNY === 3,
  present.payload && present.payload.currentSession)

// 场景 3：服务存在但形状不符（无 list）→ 安全降级，不抛错
const malformed = await runScenario('malformed', { sessionController: { notAList: true } })
check('sessionController 形状不符时安全降级',
  malformed.status === 200 && malformed.payload && malformed.payload.currentSession && malformed.payload.currentSession.tokens === 11,
  { status: malformed.status, current: malformed.payload && malformed.payload.currentSession })

// 场景 4：连 ctx.get 都抛错的极老宿主 → 仍不得影响花费查询
const throwingGet = await runScenario('throwing-get', {}, { getThrows: true })
check('ctx.get 抛错时不影响花费查询', throwingGet.status === 200, throwingGet.status)

// 场景 5：宿主在插件加载后才提供 sessionController → 仍应安全（不抛错即可；此处验证不崩）
check('敌意宿主下不存在裸服务属性访问导致的 500', [missing, present, malformed, throwingGet].every(function (r) { return r.status !== 500 }))

console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
