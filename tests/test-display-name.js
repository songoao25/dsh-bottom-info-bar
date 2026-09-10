const { t } = require('./locale-fixture.cjs');
// 显示名逻辑审计（M5：与模型切换器完全一致）——注入 llm 桩的集成测试：
// ① DSH 目录名优先（llm.listModels 的 model.name / llm.listProviders 的 provider.name）
// ② 无 llm 服务 → 模型名回退原始 id、服务商名回退静态映射
// ③ 目录外未知模型 → 回退原始 model id
// ④ llm/adapters-updated / settings/document-updated → 重建目录名缓存（模型改名后立即反映）
// ⑤ 边界：空模型 → 未知/待识别，不猜默认；未知服务商 → 大写首字母回退
// ⑥ client 静态检查：服务商与模型始终拆分；模型名去除重复的服务商前缀（"DeepSeek · V4 Flash"）
// 用法：node tests/test-display-name.js（由 run-all.mjs 统一驱动，先 build 再测）
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');

// 测试隔离：数据目录与订阅源凭证全部指向临时目录（绝不读真实登录态/发网络请求）
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bib-display-'));
process.env.DSH_BOTTOM_INFO_BAR_DATA_DIR = path.join(tmpRoot, 'data');
process.env.DSH_BOTTOM_INFO_BAR_CODEX_AUTH = path.join(tmpRoot, 'no-auth.json');
process.env.DSH_BOTTOM_INFO_BAR_OPENCODE_AUTH = path.join(tmpRoot, 'no-opencode.json');

const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');
const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + JSON.stringify(actual)); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}
function ok(label, cond, detail) {
  if (cond) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + (detail ? ' — ' + detail : '')); }
}

// ---------- 桩环境（llm 可注入/可缺省；currentSelection 可动态改选） ----------
function extractFn(name) {
  const src = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');
  const start = src.indexOf('function ' + name);
  if (start < 0) throw new Error('未找到 function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < src.length) {
    const c = src[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return eval('(' + src.slice(start, i + 1) + ')');
}

function makeStubCtx(opts) {
  const o = opts || {};
  const selection = {
    provider: o.provider !== undefined ? o.provider : 'deepseek-official',
    model: o.model !== undefined ? o.model : 'deepseek-flash',
  };
  // 目录可变引用：测试可替换 catalogRef.current 模拟目录变更（llm/adapters-updated 后重读）
  const catalogRef = { current: o.catalog || { listModels: async () => [], listProviders: async () => [] } };
  const listeners = {};
  const calls = { listModels: 0, listProviders: 0, resolveModelInfo: 0 };
  let route = null;
  // llm 桩：透传调用次数 + 委托给 catalogRef.current（缺省 → ctx.get('llm') 返回 undefined，模拟无 llm 服务）
  const llm = o.noLlm ? undefined : {
    async listModels(provider) { calls.listModels++; return catalogRef.current.listModels(provider); },
    async listProviders() { calls.listProviders++; return catalogRef.current.listProviders(); },
    async resolveModelInfo(provider, model) {
      calls.resolveModelInfo++;
      return typeof catalogRef.current.resolveModelInfo === 'function'
        ? catalogRef.current.resolveModelInfo(provider, model) : undefined;
    },
  };
  const ctx = {
    get(name) {
      if (name === 'agentDefaultModel') {
        return { currentSelection: () => ({ provider: selection.provider, model: selection.model, reasoningEffort: 'high' }) };
      }
      if (name === 'llm') return llm;
      return undefined;
    },
    credentials: { resolve: async () => undefined },
    shell: { resolve: () => ({}), run: async () => ({ exitCode: 0, stdout: { text: '' } }) },
    interval() { return () => {}; },
    timeout() { return () => {}; },
    on(event, fn) { listeners[event] = fn; return () => {}; },
    inject(services, cb) {
      const webCtx = {
        effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose(); }; },
        webServer: { register(r) { route = r; return () => {}; } },
      };
      cb(webCtx);
      return () => {};
    },
  };
  return { ctx: ctx, calls: calls, listeners: listeners, selection: selection, catalogRef: catalogRef, getRoute: () => route };
}

// 假 req/res + HTTP 调用（与 smoke-static-host.mjs 同构）
function makeReq(routePath, method, body, headers) {
  const listeners = {};
  const req = {
    url: routePath,
    method: method || 'GET',
    headers: headers || {},
    on(ev, cb) { (listeners[ev] = listeners[ev] || []).push(cb); return req; },
    destroy() {},
  };
  return {
    req,
    emit() {
      if (body !== undefined) for (const cb of listeners.data || []) cb(Buffer.from(body));
      for (const cb of listeners.end || []) cb();
    },
  };
}
async function invoke(route, routePath, method, body, headers) {
  const { req, emit } = makeReq(routePath, method, body, headers);
  let status = 0, payload = null;
  const res = {
    writeHead(s) { status = s; },
    end(b) { try { payload = JSON.parse(b); } catch { payload = String(b); } },
  };
  const pending = route.handler(req, res);
  emit();
  await pending;
  return { status, payload };
}
const settle = () => new Promise((r) => setTimeout(r, 40));
function selectionBody(env) {
  return JSON.stringify({ selection: { provider: env.selection.provider, model: env.selection.model } });
}

(async function main() {
  let plugin = null;
  plugin = (await import(pathToFileURL(path.join(__dirname, '..', 'plugin', 'lib', 'index.js')).href)).default;

  // ================= ① DSH 目录名优先（llm 桩提供目录） =================
  {
    const catalog = {
      async listModels(provider) {
        if (provider === 'deepseek-official') return [
          { id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' },
          { id: 'deepseek-chat', name: 'DeepSeek-Chat' },
        ];
        return [];
      },
      async listProviders() {
        return [
          { id: 'deepseek-official', name: 'DeepSeek' },
          { id: 'openrouter', name: 'OpenRouter' },
        ];
      },
    };
    const env = makeStubCtx({ catalog: catalog });
    const disposer = plugin.apply(env.ctx);
    await settle();
    const r = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('DSH 目录名优先：providerDisplay = DeepSeek（listProviders.name）', r.payload && r.payload.providerDisplay, 'DeepSeek');
    check('DSH 目录名优先：modelDisplay = DeepSeek-V41-Flash（listModels.name，与切换器一致）', r.payload && r.payload.modelDisplay, 'DeepSeek-V41-Flash');
    check('目录未声明能力时保持未知，不把新模型误标为文本模型', r.payload && r.payload.acceptsImageInput, null);
    check('DSH 目录名优先：目录接口确实被调用', env.calls.listModels >= 1 && env.calls.listProviders >= 1, true);
    disposer();
  }

  // ================= ①c 新模型无需插件硬编码：完整能力返回即可自动识别 =================
  {
    const catalog = {
      // 模拟新版 DSH 的模型切换器概要：名称有，但能力字段在 host 的完整查询中返回。
      async listModels() { return [{ id: 'deepseek-flash-next', name: 'DeepSeek-Flash-Next' }]; },
      async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
      async resolveModelInfo(provider, model) {
        if (provider === 'deepseek-official' && model === 'deepseek-flash-next') {
          return { name: 'DeepSeek-Flash-Next', inputModalities: ['text', 'image'] };
        }
        return undefined;
      },
    };
    const env = makeStubCtx({ catalog: catalog, model: 'deepseek-flash-next' });
    const disposer = plugin.apply(env.ctx);
    await settle();
    const r = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('未硬编码的新模型：完整目录 name 自动显示', r.payload && r.payload.modelDisplay, 'DeepSeek-Flash-Next');
    check('未硬编码的新模型：DSH inputModalities 自动显示视觉能力', r.payload && r.payload.acceptsImageInput, true);
    check('未硬编码的新模型：能力查询只依赖 DSH resolver', env.calls.resolveModelInfo >= 1, true);
    disposer();
  }

  // ================= ①d 目录外模型的退避探测：新发布后无需重启/发版 =================
  {
    const catalogRef = {
      current: {
        async listModels() { return [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' }]; },
        async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
        async resolveModelInfo() { return undefined; },
      },
    };
    const env = makeStubCtx({ catalog: catalogRef.current, model: 'deepseek-flash' });
    env.catalogRef.current = catalogRef.current;
    const disposer = plugin.apply(env.ctx);
    await settle();
    env.selection.model = 'deepseek-flash-new';
    env.catalogRef.current = {
      async listModels() { return [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' }, { id: 'deepseek-flash-new', name: 'DeepSeek-Flash-New' }]; },
      async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
      async resolveModelInfo() { return undefined; },
    };
    const realDateNow = Date.now;
    Date.now = () => realDateNow() + 31 * 1000;
    const r = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    Date.now = realDateNow;
    check('目录外新模型：退避窗口到期后自动重新拉取目录名', r.payload && r.payload.modelDisplay, 'DeepSeek-Flash-New');
    check('目录外新模型：无能力 metadata 时保持未知', r.payload && r.payload.acceptsImageInput, null);
    disposer();
  }

  // ================= ①b 模型视觉能力只取 DSH 明确 metadata，不猜模型名 =================
  {
    const catalog = {
      async listModels() { return [{ id: 'vision-by-metadata', name: '任意显示名' }, { id: 'named-vision-only', name: 'Vision 但无能力声明' }]; },
      async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
      async resolveModelInfo(provider, model) {
        if (model === 'vision-by-metadata') return { inputModalities: ['text', 'image'] };
        return { inputModalities: ['text'] };
      },
    };
    const env = makeStubCtx({ catalog: catalog, model: 'vision-by-metadata' });
    const disposer = plugin.apply(env.ctx);
    await settle();
    const imageModel = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('明确 inputModalities 包含 image → 返回视觉能力', imageModel.payload && imageModel.payload.acceptsImageInput, true);
    env.selection.model = 'named-vision-only';
    const textOnlyModel = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('模型名含 Vision 但 metadata 无 image → 不返回视觉能力', textOnlyModel.payload && textOnlyModel.payload.acceptsImageInput, false);
    check('视觉能力通过 resolveModelInfo 查询', env.calls.resolveModelInfo >= 2, true);
    disposer();
  }

  // ================= ② 无 llm 服务 → 回退（模型=原始 id；服务商=静态映射） =================
  {
    const env = makeStubCtx({ noLlm: true });
    const disposer = plugin.apply(env.ctx);
    await settle();
    const r = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('无 llm：modelDisplay 回退原始 model id', r.payload && r.payload.modelDisplay, 'deepseek-flash');
    check('无 llm：providerDisplay 回退静态映射（deepseek-official → DeepSeek）', r.payload && r.payload.providerDisplay, 'DeepSeek');
    check('无 llm：目录接口零调用', env.calls.listModels === 0 && env.calls.listProviders === 0, true);
    disposer();
  }

  // ================= ③ 目录外未知模型 → 回退原始 id =================
  {
    const catalog = {
      async listModels() { return [{ id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' }]; },
      async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
    };
    const env = makeStubCtx({ catalog: catalog, model: 'my-custom-model' });
    const disposer = plugin.apply(env.ctx);
    await settle();
    const r = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('目录外未知模型 → 回退原始 model id', r.payload && r.payload.modelDisplay, 'my-custom-model');
    disposer();
  }

  // ================= ④ llm/adapters-updated → 重建目录名缓存 =================
  {
    const env = makeStubCtx({
      catalog: {
        async listModels(provider) { return [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash' }]; },
        async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
      },
    });
    const disposer = plugin.apply(env.ctx);
    await settle();
    const before = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('adapters-updated 前：modelDisplay = DeepSeek-V41-Flash', before.payload && before.payload.modelDisplay, 'DeepSeek-V41-Flash');
    // 模拟模型改名：目录变更（如切换器改显示名）→ 触发 llm/adapters-updated
    env.catalogRef.current = {
      async listModels(provider) { return [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash-Pro' }]; },
      async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
    };
    const updateFn = env.listeners['llm/adapters-updated'];
    check('adapters-updated 监听已注册', typeof updateFn, 'function');
    if (typeof updateFn === 'function') updateFn();
    await settle();
    const after = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('adapters-updated 后：modelDisplay 立即反映新目录名', after.payload && after.payload.modelDisplay, 'DeepSeek-V41-Flash-Pro');
    env.catalogRef.current = {
      async listModels(provider) { return [{ id: 'deepseek-flash', name: 'DeepSeek-V41-Flash-Settings' }]; },
      async listProviders() { return [{ id: 'deepseek-official', name: 'DeepSeek' }]; },
    };
    const settingsUpdateFn = env.listeners['settings/document-updated'];
    check('settings/document-updated 监听已注册', typeof settingsUpdateFn, 'function');
    if (typeof settingsUpdateFn === 'function') settingsUpdateFn();
    await settle();
    const afterSettings = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('settings/document-updated 后：modelDisplay 立即反映新目录名', afterSettings.payload && afterSettings.payload.modelDisplay, 'DeepSeek-V41-Flash-Settings');
    disposer();
  }

  // ================= ⑤ 边界：空模型（modelSelection 兜底默认模型）/ 未知服务商 =================
  {
    const env = makeStubCtx({
      catalog: { async listModels() { return []; }, async listProviders() { return []; } },
      model: '', // 空模型 → 未解析，不猜默认模型
    });
    const disposer = plugin.apply(env.ctx);
    await settle();
    const r1 = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('空模型 → 不猜默认模型，返回待识别状态', r1.payload && r1.payload.model === '' && r1.payload.fallback === true && r1.payload.modelDisplay, '未知模型');
    env.selection.model = 'x';
    env.selection.provider = 'zzz';
    const r2 = await invoke(env.getRoute(), '/_dsh/dsh-bottom-info-bar/getPricing', 'POST', selectionBody(env));
    check('未知服务商（无缓存无映射）→ 大写首字母回退', r2.payload && r2.payload.providerDisplay, 'Zzz');
    disposer();
  }

  ok('模型选择不保留默认模型或跨会话缓存', !hostSrc.includes('const DEFAULT_MODEL') && !clientSrc.includes('sessionModelCache'));

  // ================= ⑤b 纯函数边界（模块级，直接提取） =================
  const modelDisplayFromCache = extractFn('modelDisplayFromCache');
  const providerDisplayFromCache = extractFn('providerDisplayFromCache');
  check('纯函数：空模型 → 未知模型', modelDisplayFromCache('', 'p', {}), '未知模型');
  check('纯函数：空 provider → 未知服务商', providerDisplayFromCache('', {}, {}), '未知服务商');
  check('纯函数：缓存命中优先于原始 id', modelDisplayFromCache('m1', 'p', { p: { m1: 'Nice-Name' } }), 'Nice-Name');
  check('纯函数：缓存缺失回退原始 id', modelDisplayFromCache('m2', 'p', { p: { m1: 'Nice-Name' } }), 'm2');
  check('纯函数：provider 缓存优先于静态映射', providerDisplayFromCache('deepseek', { deepseek: 'DS' }, { deepseek: 'DeepSeek' }), 'DS');
  check('纯函数：provider 静态映射回退', providerDisplayFromCache('deepseek', {}, { deepseek: 'DeepSeek' }), 'DeepSeek');

  // ================= ⑥ client 静态检查（M5 展示） =================
  check('client 模型名直接用 host 返回的 modelDisplay（无自建美化依赖）',
    clientSrc.includes("const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay"), true);
  check('client 服务商与模型始终分离，模型名只去除重复服务商前缀',
    clientSrc.includes('const modelName = modelLabelWithoutProvider(modelLabel, provLabel);')
      && !clientSrc.includes('const redundant = provLabel.length'), true);
  check('client 订阅制模型名同样用 DSH 目录名（modelDisplay）',
    clientSrc.includes("const modelLabel = (pr && pr.modelDisplay) ? pr.modelDisplay"), true);
  check('client 仅在服务商名后存在分隔符时去重，避免误截断真实模型名',
    clientSrc.includes("if (!/^[\\s·._/-]+/.test(suffix)) return modelLabel;"), true);
  check('client 只在 host 明确返回视觉能力时，复刻“模型名 视觉”靛蓝椭圆并将服务商置于椭圆外',
    clientSrc.includes("pr.acceptsImageInput !== true") && clientSrc.includes("className: 'bi-vision-kind' }, t('ui.vision')")
      && clientSrc.includes("modelLabelWithoutProvider(modelLabel, provLabel)") && clientSrc.includes("t('ui.supportsImageInput')"), true);

  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('测试执行异常：', e);
  process.exit(2);
});
