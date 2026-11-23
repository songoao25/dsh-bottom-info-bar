// Issue #313 回归：DSH 0.2.3 的 Connection 重构移除了 connection.requestRejection，
// 插件路由 handler 无守卫直调 → TypeError → 全部 RPC 被 catch 转成 500 internal error，
// 设置页 getFieldConfig 首当其冲。本测试钉死两件事：
//   1) 宿主没有 requestRejection 时（新宿主形态），RPC 必须正常 200，绝不 500；
//   2) 宿主仍提供 requestRejection 时（旧宿主），原有准入行为（跨站 403）保持不变。
// 数据目录铁律：import 被测模块前先把 env 指向临时目录，绝不触碰真实用户数据。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const tmpData = mkdtempSync(join(tmpdir(), 'bib-conn313-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = tmpData
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmpData, 'no-codex.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmpData, 'no-opencode.json')
process.env.DSH_BOTTOM_INFO_BAR_COMMAND_CODE_AUTH = join(tmpData, 'no-command-code.json')
process.env.DSH_BOTTOM_INFO_BAR_SELF_UPDATE = 'off'
delete process.env.COMMAND_CODE_API_KEY
delete process.env.CMD_API_KEY

// 无真实网络：启动刷新/版本检查全部本地假响应
globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')) }
}

function makeStub(connection) {
  const captured = { route: null }
  const ctx = {
    get(name) {
      return name === 'agentDefaultModel'
        ? { currentSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-v4-flash' }) }
        : undefined
    },
    credentials: { resolve: async () => null },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { return () => {} },
    timeout() { return () => {} },
    on() { return () => {} },
    inject(services, callback) {
      callback({
        effect(fn) { const dispose = fn(); return () => dispose && dispose() },
        connection,
        webServer: { register(route) { captured.route = route; return () => {} } },
      })
      return () => {}
    },
  }
  return { captured, ctx }
}

async function invoke(route, method, headers) {
  const listeners = {}
  const req = {
    url: '/_dsh/dsh-bottom-info-bar/' + method,
    method: 'POST',
    headers: headers || { 'sec-fetch-site': 'same-origin' },
    on(n, cb) { (listeners[n] ||= []).push(cb); return req },
    destroy() {},
  }
  let status = null
  let payload = null
  const pending = route.handler(req, {
    writeHead(s) { status = s },
    end(text) { try { payload = JSON.parse(text) } catch { payload = String(text) } },
    headersSent: false,
    destroy() {},
  })
  for (const cb of listeners.data || []) cb(Buffer.from('{}'))
  for (const cb of listeners.end || []) cb()
  await pending
  return { status, payload }
}

// ---------- 场景 1：DSH 0.2.3 新宿主——connection 没有 requestRejection ----------
{
  const mod = await import('../src/host.js?conn313=new-host')
  const stub = makeStub({ admit: () => undefined, rpc: async () => null, createPeer: () => null })
  const dispose = mod.default.apply(stub.ctx)
  await new Promise((resolve) => setTimeout(resolve, 30))
  check('新宿主：路由已注册', !!stub.captured.route)
  const fc = await invoke(stub.captured.route, 'getFieldConfig')
  check('新宿主：getFieldConfig → 200（Issue #313 原失败点）', fc.status === 200, JSON.stringify(fc))
  check('新宿主：getFieldConfig 不回 internal error', !(fc.payload && fc.payload.error === 'internal error'), JSON.stringify(fc.payload))
  const cfg = await invoke(stub.captured.route, 'getConfig')
  check('新宿主：getConfig → 200', cfg.status === 200 && cfg.payload && typeof cfg.payload.infoDensity === 'string', JSON.stringify(cfg))
  dispose()
}

// ---------- 场景 2：旧宿主——requestRejection 仍在，准入行为不变 ----------
{
  const mod = await import('../src/host.js?conn313=old-host')
  const stub = makeStub({
    requestRejection(req) { return req.headers['sec-fetch-site'] === 'cross-site' ? 403 : undefined },
  })
  const dispose = mod.default.apply(stub.ctx)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const ok = await invoke(stub.captured.route, 'getFieldConfig')
  check('旧宿主：同源 getFieldConfig → 200', ok.status === 200, JSON.stringify(ok))
  const cross = await invoke(stub.captured.route, 'getFieldConfig', { 'sec-fetch-site': 'cross-site' })
  check('旧宿主：跨站 getFieldConfig → 403（准入行为保持）', cross.status === 403, JSON.stringify(cross))
  dispose()
}

rmSync(tmpData, { recursive: true, force: true })
console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
process.exit(failures === 0 ? 0 : 1)
