// Bottom Info Bar — 显示模型渲染级验证（唯一一套逻辑：字段属于谁 + 它自己的开关）
// 用法：node tests/test-display-model.cjs
//
// 为什么需要这个文件：源码正则能防住"又写了 if (full)"，却防不住"说了两种模式都有、实际渲染时没出来"。
// 用户 2026-09-25 报的正是后者（自定义文字开关开着，简洁模式下看不到）。所以这里把 lib/client.js
// 真的跑起来：同一份快照分别在简洁与完整两种密度下渲染，再逐个字段比对主行里到底出现了什么。
//
// 核心断言只有一句：两种密度下主行的字段集合必须完全相同 —— 模式只决定原生统计行显示与否。
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.dirname(__dirname);
const clientSrc = fs.readFileSync(path.join(ROOT, 'src', 'client-bundle.js'), 'utf8');
const fixture = require('./locale-fixture.cjs');

let pass = 0;
let fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

const NOW = 1758800000000;
const MINUTE = 60000;
const DAY = 24 * 60 * MINUTE;

// 字段开关全部打开 —— 正是用户报问题时的形态（他把所有开关都开着，仍然看不到自定义文字）。
function allFieldsOn(overrides) {
  const ids = [...clientSrc.matchAll(/\{ id: '([A-Za-z0-9]+)'/g)].map((m) => m[1]);
  const fields = {};
  for (const id of ids) fields[id] = true;
  return Object.assign(fields, overrides || {});
}

function jsonOk(payload) {
  return Promise.resolve({
    ok: true,
    status: 200,
    text: function () { return Promise.resolve(JSON.stringify(payload)); },
  });
}

function flush() {
  return new Promise(function (resolve) { setImmediate(resolve); });
}

// ---------- 装置 ----------
// 与 tests/test-quota-display-mode.cjs 同一套 React 桩：hooks 按调用序号落在 slots 上，
// 因此 index 归零重渲染即可模拟"状态更新后重渲染"。
async function createBarHarness(options) {
  const opts = options || {};
  const density = opts.density === 'compact' ? 'compact' : 'full';
  const hooks = { index: 0, slots: [], effects: [] };
  const React = {
    createElement: function (type, props) {
      return { type: type, props: Object.assign({}, props, { children: Array.prototype.slice.call(arguments, 2) }) };
    },
    useState: function (initial) {
      const i = hooks.index++;
      if (!(i in hooks.slots)) hooks.slots[i] = typeof initial === 'function' ? initial() : initial;
      return [hooks.slots[i], function (value) { hooks.slots[i] = typeof value === 'function' ? value(hooks.slots[i]) : value; }];
    },
    useRef: function (initial) { hooks.index++; return { current: initial }; },
    useEffect: function (fn) { hooks.index++; hooks.effects.push(fn); },
    useLayoutEffect: function (fn) { hooks.index++; hooks.effects.push(fn); },
    useCallback: function (fn) { hooks.index++; return fn; },
    cloneElement: function (node, props) { return Object.assign({}, node, { props: Object.assign({}, node.props, props) }); },
  };

  let dockComponent = null;
  const slots = {
    inject: function (name, cb) { cb(); return function () {}; },
    register: function (slotOptions, component) {
      if (slotOptions && slotOptions.name === 'conversation.composer.dock') dockComponent = component;
      return function () {};
    },
  };

  // 会话模型：信息栏在拿到当前会话的服务商/模型前故意不渲染任何内容，
  // 所以装置必须提供 modelDirectories 这一路，否则测到的永远是空行（会假绿）。
  const provider = opts.provider || 'codex';
  const model = opts.model || 'gpt-5-codex';
  const modelSnapshot = {
    current: { provider: provider, model: model },
    groups: [{ id: provider, name: opts.providerName || provider, models: [{ id: model, name: opts.modelName || model, inputModalities: ['text', 'image'] }] }],
  };
  const services = {
    sessions: { list: { getSnapshot: function () { return { current: 'sess-1' }; } } },
    modelDirectories: { directoryFor: function () { return { store: { getSnapshot: function () { return modelSnapshot; }, subscribe: function () { return function () {}; } } }; } },
  };

  const fetchStub = function (url, init) {
    const method = String(url).split('/').pop();
    let args = null;
    try { args = JSON.parse(init.body); } catch (err) { args = null; }
    const handler = opts.handle ? opts.handle(method, args) : null;
    return handler === null || handler === undefined ? jsonOk({}) : handler;
  };

  const noop = function () {};
  let plugin = null;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'lib', 'client.js'), 'utf8'), {
    console: console,
    AbortController: AbortController,
    fetch: fetchStub,
    document: { addEventListener: noop, removeEventListener: noop, visibilityState: 'visible' },
    window: {
      setTimeout: function () { return 0; }, clearTimeout: noop,
      setInterval: function () { return 0; }, clearInterval: noop,
      addEventListener: noop, removeEventListener: noop,
      __ModuleLoader__: { load: function (mod) { plugin = mod.factory(function () { return React; }); } },
    },
  });
  await plugin.apply({
    slots: slots,
    locale: fixture.createLocale('zh'),
    get: function (name) { return services[name] || null; },
    effect: function (fn, label) { if (typeof label === 'string' && label.indexOf(': dictionaries') !== -1) fn(); },
  });

  const expand = function (tree) {
    if (Array.isArray(tree)) return tree.map(expand);
    if (!tree || typeof tree !== 'object') return tree;
    if (typeof tree.type === 'function') return expand(tree.type(tree.props));
    return Object.assign({}, tree, { props: Object.assign({}, tree.props, { children: expand(tree.props.children) }) });
  };
  const projections = {
    sessionStats: opts.sessionStats,
    tokenUsage: opts.tokenUsage,
    contextPressure: opts.contextPressure,
    contextBreakdown: opts.contextBreakdown,
  };
  const render = function () {
    hooks.index = 0;
    if (!dockComponent) return null;
    return expand(dockComponent({
      density: density,
      onToggleDensity: function () {},
      sessionId: 'sess-1',
      useProjection: function (key) { return projections[key]; },
    }));
  };
  const runEffects = function () {
    const pending = hooks.effects.slice();
    hooks.effects.length = 0;
    pending.forEach(function (fn) { try { fn(); } catch (err) { /* 装置不关心清理函数与可选服务缺席 */ } });
  };
  const nodes = function (tree) {
    if (Array.isArray(tree)) return tree.reduce(function (acc, item) { return acc.concat(nodes(item)); }, []);
    if (!tree || typeof tree !== 'object') return [];
    return [tree].concat(nodes(tree.props.children));
  };
  // 渲染泵：首渲 → 跑副作用（挂订阅 / 发 RPC）→ 让 Promise 落地 → 再渲，直到数据到位。
  const pump = async function () {
    let tree = null;
    for (let i = 0; i < 6; i++) {
      tree = render();
      runEffects();
      await flush();
    }
    return tree;
  };
  return {
    pump: pump,
    densityOf: function (tree) {
      const root = nodes(tree).filter(function (n) { return n.props && n.props.className === 'bi-root'; })[0];
      return root ? root.props['data-density'] : null;
    },
    // 某一行（主行 / 原生行）里实际出现的字段 id，按渲染顺序
    fieldsIn: function (tree, rowId) {
      const host = nodes(tree).filter(function (n) { return n.props && n.props.id === rowId; })[0];
      if (!host) return [];
      return nodes(host).map(function (n) { return n.props && n.props['data-field']; })
        .filter(function (value) { return typeof value === 'string'; });
    },
  };
}

// ---------- 三种计费形态各自的宿主应答 ----------
const FIELD_CONFIG = function (fields) {
  return {
    fields: fields,
    colors: {},
    timeFormat: { year: true, month: true, day: true, hour: true, minute: true, second: false },
    timeZones: { main: 'Asia/Shanghai', world: 'UTC' },
    customText: 'SONGOAO25',
    quotaDisplayMode: 'remaining',
    configVersion: 1,
  };
};
const USAGE = { currentSession: { costs: { CNY: 0.123 } }, todaySpend: 1.5, monthSpend: 20.5, totalSpend: 300.5, persistence: { state: 'ok' } };
const UPDATE_INFO = { current: '1.19.3', latest: '1.19.3', updateStatus: { lastError: null } };

// 每个场景 = 一个 provider 形态 + 该形态下最容易被"模式"误伤的字段清单（expect）。
const SCENARIOS = [
  {
    name: '订阅制（Codex 形态）',
    provider: 'codex', model: 'gpt-5-codex', modelName: 'GPT 5 Codex',
    // 这四条曾经都是"只有完整模式才显示"：到期日 / 两个额度窗口 / 重置倒计时
    expect: ['customText', 'mainTime', 'worldTime', 'subServiceGroup', 'expiry', 'subWindow5h', 'subWindowWeek', 'resetCountdown', 'contextUsage'],
    reply: function (method) {
      if (method === 'getPricing') return jsonOk({ provider: 'codex', model: 'gpt-5-codex', modelDisplay: 'GPT 5 Codex', mode: 'flat', period: 'offpeak', prices: {}, nextSwitch: null });
      if (method === 'getBillingMode') return jsonOk({ provider: 'codex', model: 'gpt-5-codex', mode: 'subscription' });
      if (method === 'getSubscriptionSnapshot') {
        return jsonOk({
          windows: [{ key: 'five_hour', usedPercent: 20, resetsAt: NOW + 3 * 60 * MINUTE }, { key: 'seven_day', usedPercent: 70, resetsAt: NOW + 5 * DAY }],
          planType: 'plus', expiryAt: NOW + 30 * DAY, plan: 'Plus', source: 'codex', error: null,
        });
      }
      return null;
    },
  },
  {
    name: '余额制峰谷（DeepSeek 形态）',
    provider: 'deepseek', model: 'deepseek-chat', modelName: 'DeepSeek Chat',
    // 这四条曾经都是"只有完整模式才显示"：余额 / 高峰时段 / 距高峰倒计时 / 本会话花费
    expect: ['customText', 'mainTime', 'anchorGroup', 'balance', 'period', 'countdown', 'sessionCost', 'contextUsage'],
    reply: function (method) {
      if (method === 'getPricing') return jsonOk({ provider: 'deepseek', model: 'deepseek-chat', modelDisplay: 'DeepSeek Chat', mode: 'peak-valley', period: 'peak', prices: { inputCacheMiss: 2, inputCacheHit: 0.5, output: 8 }, nextSwitch: { at: NOW + 90 * MINUTE, atLabel: '23:30' } });
      if (method === 'getBillingMode') return jsonOk({ provider: 'deepseek', model: 'deepseek-chat', mode: 'balance' });
      if (method === 'getBalanceSnapshot') return jsonOk({ currency: 'CNY', data: { total: 12.34 } });
      return null;
    },
  },
  {
    name: '账单制（Fireworks 形态）',
    provider: 'fireworks', model: 'llama-v3', modelName: 'Llama 3',
    // 这两条曾经都是"只有完整模式才显示"：预算比例 / 免费额度
    expect: ['billingServiceGroup', 'billingSpend', 'budget', 'freeQuota', 'contextUsage'],
    reply: function (method) {
      if (method === 'getPricing') return jsonOk({ provider: 'fireworks', model: 'llama-v3', modelDisplay: 'Llama 3', mode: 'flat', period: 'offpeak', prices: {}, nextSwitch: null });
      if (method === 'getBillingMode') return jsonOk({ provider: 'fireworks', model: 'llama-v3', mode: 'billing' });
      if (method === 'getBillingStatus') return jsonOk({ type: 'fireworks', data: { currentPeriodSpend: 8.5, currency: 'USD', budgetPercent: 42, freeRemaining: 1000, resetsAt: NOW + DAY } });
      return null;
    },
  },
];

function handleFor(scenario, fields, density) {
  return function (method) {
    if (method === 'getConfig') return jsonOk({ infoDensity: density, displayMode: 'auto', alertThreshold: 20 });
    if (method === 'getFieldConfig') return jsonOk(FIELD_CONFIG(fields));
    if (method === 'getUsageSummary') return jsonOk(USAGE);
    if (method === 'getUpdateInfo') return jsonOk(scenario.updateInfo || UPDATE_INFO);
    return scenario.reply(method) || jsonOk(null);
  };
}

// 原生统计行投影：turnsSteps / llmTime / toolTime / cacheHit / tokensIO 都该在原生行里
const STATS = { turns: 3, steps: 7, llmMs: 1200, toolMs: 400, ttftMs: 300, ttftSteps: 3, decodeMs: 2000, decodeTokens: 500 };
const TOKENS = { inputTokens: 10000, outputTokens: 2000, cacheReadTokens: 6000 };
// 上下文投影：两个字段（contextWindow / projectedTokens）就够圆环出数
const PRESSURE = { projectedTokens: 45000, contextWindow: 200000 };
const ROW_MAIN = 'dsh-bottom-info-bar-primary';
const ROW_NATIVE = 'dsh-bottom-info-bar-native';

const renderOnce = async function (scenario, fields, density) {
  const harness = await createBarHarness({
    density: density,
    provider: scenario.provider, model: scenario.model, modelName: scenario.modelName,
    handle: handleFor(scenario, fields, density),
    sessionStats: STATS, tokenUsage: TOKENS, contextPressure: PRESSURE,
  });
  const tree = await harness.pump();
  return { harness: harness, tree: tree };
};

(async function () {
try {
  for (const scenario of SCENARIOS) {
    const fields = allFieldsOn();
    const full = await renderOnce(scenario, fields, 'full');
    const compact = await renderOnce(scenario, fields, 'compact');
    const fullMain = full.harness.fieldsIn(full.tree, ROW_MAIN);
    const compactMain = compact.harness.fieldsIn(compact.tree, ROW_MAIN);
    const compactNative = compact.harness.fieldsIn(compact.tree, ROW_NATIVE);
    console.log('      · ' + scenario.name + ' 简洁主行：' + compactMain.join(', '));

    // 装置自检：数据真的到位了、两种密度真的渲染成了不同模式（否则"两边都空"会假绿）
    check('[' + scenario.name + '] 装置自检：数据到位且两种密度不同',
      fullMain.length >= 4 && full.harness.densityOf(full.tree) === 'full' && compact.harness.densityOf(compact.tree) === 'compact', true);

    // ★ 本文件存在的理由
    check('[' + scenario.name + '] 主行字段集合两种密度完全相同（模式不参与字段显隐）', compactMain.join(',') === fullMain.join(','), true);
    // 该形态下"以前只有完整模式才显示"的那批字段，简洁模式必须真的出现
    check('[' + scenario.name + '] 简洁模式下这批字段全部渲染出来：' + scenario.expect.join(' / '),
      scenario.expect.every(function (id) { return compactMain.indexOf(id) !== -1; }), true);
    // 原生字段只进原生行，绝不混进主行
    check('[' + scenario.name + '] 原生统计字段只进原生行',
      ['turnsSteps', 'llmTime', 'toolTime', 'cacheHit', 'tokensIO'].every(function (id) {
        return compactNative.indexOf(id) !== -1 && full.harness.fieldsIn(full.tree, ROW_NATIVE).indexOf(id) !== -1
          && compactMain.indexOf(id) === -1;
      }), true);
  }

  // 提醒字段属于主行，两种密度都在（用「更新失败」这条一次性提醒验证；失败原因走结构化 kind）
  const noticeScenario = {
    name: '提醒（更新失败）',
    provider: 'codex', model: 'gpt-5-codex', modelName: 'GPT 5 Codex',
    updateInfo: { current: '1.19.3', latest: '1.19.4', updateStatus: { lastError: 'integrity-mismatch' } },
    reply: SCENARIOS[0].reply,
  };
  const noticeSeen = [];
  for (const density of ['full', 'compact']) {
    const rendered = await renderOnce(noticeScenario, allFieldsOn(), density);
    noticeSeen.push(rendered.harness.fieldsIn(rendered.tree, ROW_MAIN).indexOf('updateFailure') !== -1);
  }
  check('提醒字段两种密度都出现（更新失败短标记）', noticeSeen.join(',') === 'true,true', true);

  // 反向锁：开关仍是唯一裁判 —— 关掉的字段两种密度都不许出现
  const offFields = allFieldsOn({ customText: false, mainTime: false, worldTime: false, expiry: false, subWindowWeek: false });
  const offFull = await renderOnce(SCENARIOS[0], offFields, 'full');
  const offCompact = await renderOnce(SCENARIOS[0], offFields, 'compact');
  const offFullMain = offFull.harness.fieldsIn(offFull.tree, ROW_MAIN);
  const offCompactMain = offCompact.harness.fieldsIn(offCompact.tree, ROW_MAIN);
  check('关掉的字段两种密度都不出现（开关仍是唯一裁判）',
    [offFullMain, offCompactMain].every(function (fields) {
      return ['customText', 'mainTime', 'worldTime', 'expiry', 'subWindowWeek'].every(function (id) { return fields.indexOf(id) === -1; });
    }), true);
  check('关掉部分字段后，两种密度的主行仍逐字相同', offCompactMain.join(',') === offFullMain.join(','), true);
} catch (error) {
  fail++;
  console.log('FAIL  装置抛错 → ' + (error && error.stack ? error.stack.split('\n').slice(0, 4).join(' | ') : String(error)));
}

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
})();
