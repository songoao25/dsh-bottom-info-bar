// v1.15.0：订阅窗口百分比方向（已用 / 剩余）—— 顶层设置 sanitize / patch 校验 / reset 三条路径
// 用法：node tests/test-quota-display-mode.js
const { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

const root = join(__dirname, '..')
const tmp = mkdtempSync(join(tmpdir(), 'bib-quota-mode-'))
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = tmp
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = join(tmp, 'no-codex.json')
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = join(tmp, 'no-opencode.json')
process.env.DSH_BOTTOM_INFO_BAR_COMMAND_CODE_AUTH = join(tmp, 'no-cc.json')
delete process.env.COMMAND_CODE_API_KEY
delete process.env.CMD_API_KEY

let failures = 0
function check(name, cond, detail) {
  if (cond) console.log('PASS  ' + name)
  else { failures += 1; console.log('FAIL  ' + name + (detail !== undefined ? '\n      ' + detail : '')) }
}

async function main() {
  // 隔离远程价目拉取（避免网络 + 警告污染测试输出，与 smoke-static-host 同型）
  globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) })

  const plugin = require(join(root, 'plugin', 'lib', 'index.js')).default

  function makeStub() {
    const captured = { route: null }
    const ctx = {
      get() { return undefined },
      credentials: { resolve: async () => undefined },
      shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
      interval() { return () => {} },
      timeout() { return () => {} },
      on() { return () => {} },
      inject(services, cb) {
        cb({ effect(fn) { const d = fn(); return () => { if (typeof d === 'function') d() } }, webServer: { register(route) { captured.route = route; return () => {} } } })
        return () => {}
      },
    }
    return { captured, ctx }
  }
  function makeReq(path, method, body) {
    const listeners = {}
    const req = { url: path, method: method || 'GET', headers: { 'sec-fetch-site': 'same-origin' }, on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req }, destroy() {} }
    return { req, emit() { if (body !== undefined) for (const cb of listeners.data || []) cb(Buffer.from(body)); for (const cb of listeners.end || []) cb() } }
  }
  async function invoke(route, path, method, body) {
    const { req, emit } = makeReq(path, method, body)
    let status = 0, payload = null
    const res = { writeHead(s) { status = s }, end(b) { try { payload = JSON.parse(b) } catch { payload = String(b) } } }
    // route.handler 是 async，必须在 await 前先 emit（让 handler 拿到请求体），否则死锁
    const pending = route.handler(req, res)
    emit()
    await pending
    return { status, payload }
  }

  const stub = makeStub()
  const disposer = plugin.apply(stub.ctx)
  await new Promise((resolve) => setTimeout(resolve, 30))
  // host 启动时拉取远程价目会触发大量 console.warn 噪音；恢复真实 fetch 之后再静默
  delete globalThis.fetch

  // ================= 默认值 =================
  {
    const r = await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/getFieldConfig', 'GET')
    check('getFieldConfig 默认 quotaDisplayMode=used', r.payload.quotaDisplayMode === 'used', JSON.stringify(r.payload.quotaDisplayMode))
    check('getFieldConfig 默认 subWindowWeek=false（v1.15.0 新默认）', r.payload.fields.subWindowWeek === false, JSON.stringify(r.payload.fields.subWindowWeek))
  }

  // ================= setFieldConfig 接受 quotaDisplayMode patch =================
  {
    const r = await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/setFieldConfig', 'POST', JSON.stringify({ quotaDisplayMode: 'remaining' }))
    check('setFieldConfig quotaDisplayMode=remaining 接受', r.status === 200 && r.payload.quotaDisplayMode === 'remaining', JSON.stringify(r.payload))
  }

  // ================= 落盘验证 =================
  {
    const settingsPath = join(tmp, 'settings.json')
    check('settings.json 已落盘', existsSync(settingsPath), settingsPath)
    if (existsSync(settingsPath)) {
      const content = JSON.parse(readFileSync(settingsPath, 'utf8'))
      check('落盘 quotaDisplayMode=remaining', content.quotaDisplayMode === 'remaining', JSON.stringify(content.quotaDisplayMode))
    }
  }

  // ================= 非法值被拒 =================
  {
    const r = await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/setFieldConfig', 'POST', JSON.stringify({ quotaDisplayMode: 'bogus' }))
    check('setFieldMode=bogus 拒绝（400）', r.status === 400, 'status=' + r.status)
  }

  // ================= 切回 used =================
  {
    const r = await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/setFieldConfig', 'POST', JSON.stringify({ quotaDisplayMode: 'used' }))
    check('setFieldConfig quotaDisplayMode=used 接受', r.status === 200 && r.payload.quotaDisplayMode === 'used', JSON.stringify(r.payload))
  }

  // ================= 与 fields 同 patch =================
  {
    const r = await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/setFieldConfig', 'POST', JSON.stringify({ quotaDisplayMode: 'remaining', fields: { subWindow5h: false } }))
    check('setFieldConfig quotaDisplayMode 与 fields 同 patch', r.status === 200 && r.payload.quotaDisplayMode === 'remaining' && r.payload.fields.subWindow5h === false, JSON.stringify(r.payload))
  }

  // ================= resetFieldConfig 还原 quotaDisplayMode =================
  {
    const r = await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/resetFieldConfig', 'POST', JSON.stringify({}))
    check('resetFieldConfig quotaDisplayMode 回 used', r.status === 200 && r.payload.quotaDisplayMode === 'used', JSON.stringify(r.payload.quotaDisplayMode))
    check('resetFieldConfig subWindowWeek 回 false', r.payload.fields.subWindowWeek === false, JSON.stringify(r.payload.fields.subWindowWeek))
  }

  // ================= 旧 settings.json 加载回填默认 =================
  {
    const settingsPath = join(tmp, 'settings.json')
    writeFileSync(settingsPath, JSON.stringify({ version: 1, fields: { subWindow5h: true } }, null, 2))
    const r = await invoke(stub.captured.route, '/_dsh/dsh-bottom-info-bar/getFieldConfig', 'GET')
    check('旧 settings.json 加载：缺失字段回填 quotaDisplayMode=used', r.payload.quotaDisplayMode === 'used', JSON.stringify(r.payload.quotaDisplayMode))
    check('旧 settings.json 加载：缺失字段回填 subWindowWeek=false', r.payload.fields.subWindowWeek === false, JSON.stringify(r.payload.fields.subWindowWeek))
    check('旧 settings.json 加载：已有字段保留（subWindow5h=true）', r.payload.fields.subWindow5h === true, JSON.stringify(r.payload.fields.subWindow5h))
  }

  disposer()
  rmSync(tmp, { recursive: true, force: true })

  console.log(failures === 0 ? '\n结果：全部 PASS' : '\n结果：' + failures + ' 项 FAIL')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(function (err) { console.error(err); process.exit(1) })