const { t } = require('./locale-fixture.cjs');
// 双模式（余额制 / 订阅制）逻辑审计：
// ① 模式检测（只按当前 provider 自动判断）② OpenCode Go 响应解析（含 status 非 ok）
// ③ 快照失败回退（失败保留旧快照 + error 标记）④ client 订阅制渲染分支的静态检查
// 用法：node tests/test-dual-mode.js
const fs = require('fs');

const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');
const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');
// v1.6 整改：从 constants.js 读取单一生源的 SUBSCRIPTION_PROVIDERS
const constantsSrc = fs.readFileSync(__dirname + '/../plugin/src/constants.js', 'utf8');
const constantsMatch = constantsSrc.match(/export const SUBSCRIPTION_PROVIDERS = (\[[\s\S]*?\]);?/);
if (!constantsMatch) throw new Error('无法从 constants.js 中提取 SUBSCRIPTION_PROVIDERS');
const SUBSCRIPTION_PROVIDERS = eval('(' + constantsMatch[1] + ')');

// 提取纯函数（与 test-spend-accounting.js 同法：括号计数提取 + eval）
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\n    \\(([\\s\\S]*?)\\n    \\}', 'm');
  const re2 = new RegExp('function ' + name + '\\(([\\s\\S]*?)\\n    \\}', 'm');
  let m = hostSrc.match(re) || hostSrc.match(re2);
  if (!m) throw new Error('未找到 function ' + name);
  const start = hostSrc.indexOf('function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < hostSrc.length) {
    const c = hostSrc[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  const body = hostSrc.slice(start, i + 1);
  return eval('(' + body + ')');
}
// 提取单行 const 字面量（数组/对象/标量，允许行尾 // 注释；host.js 常量行尾无分号）
function extractConst(name) {
  const re = new RegExp('const ' + name + ' = (\\[[^\\n]*?\\]|\\{[^\\n]*?\\}|[^\\n]+?)(?:\\s*//[^\\n]*)?\\n');
  const m = hostSrc.match(re);
  if (!m) throw new Error('未找到 const ' + name);
  return eval('(' + m[1] + ')');
}

// 依赖常量（WINDOW_LABELS 从 hostSrc 提取；SUBSCRIPTION_PROVIDERS 已从 constants.js 读取）
const WINDOW_LABELS = extractConst('WINDOW_LABELS');
const parsePercent = extractFn('parsePercent');
// v1.7：BILLING_PROVIDERS 同样从 constants.js 读取（云账单型 provider 集合）
const constantsSrcFull = constantsSrc;
const billingMatch = constantsSrcFull.match(/export const BILLING_PROVIDERS = (\[[\s\S]*?\]);?/);
if (!billingMatch) throw new Error('无法从 constants.js 中提取 BILLING_PROVIDERS');
const BILLING_PROVIDERS = eval('(' + billingMatch[1] + ')');

// 提取纯函数（eval 出的函数闭包指向本模块作用域，能解析到上面的常量与函数）
const detectBillingMode = extractFn('detectBillingMode');
const subscriptionSourceFor = extractFn('subscriptionSourceFor');
const accountForProvider = extractFn('accountForProvider'); // v1.7：新增账户映射审计
const billingSourceFor = extractFn('billingSourceFor'); // v1.7：账单源映射审计
const openCodeGoWindowKey = extractFn('openCodeGoWindowKey'); // parseOpenCodeGoUsage 的依赖
const normalizeResetAt = extractFn('normalizeResetAt'); // parseOpenCodeGoUsage 的依赖
const parseOpenCodeGoUsage = extractFn('parseOpenCodeGoUsage');
const mergeSubscriptionResult = extractFn('mergeSubscriptionResult');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + JSON.stringify(actual)); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---- 1) 模式检测 ----
check('provider=codex → subscription', detectBillingMode('codex', 'auto').mode, 'subscription');
check('provider=chatgpt → subscription', detectBillingMode('chatgpt', 'auto').mode, 'subscription');
check('provider=opencode-go → subscription', detectBillingMode('opencode-go', 'auto').mode, 'subscription');
check('provider=opencode → subscription', detectBillingMode('opencode', 'auto').mode, 'subscription');
check('provider=openai-codex → subscription', detectBillingMode('openai-codex', 'auto').mode, 'subscription');
check('订阅源映射：openai-codex → codex', subscriptionSourceFor('openai-codex'), 'codex');
check('订阅源映射：chatgpt → codex', subscriptionSourceFor('chatgpt'), 'codex');
check('订阅源映射：deepseek → null', subscriptionSourceFor('deepseek'), null);
check('provider=deepseek → balance', detectBillingMode('deepseek', 'auto').mode, 'balance');
check('provider=openai → balance', detectBillingMode('openai', 'auto').mode, 'balance');
check('provider=openrouter → balance', detectBillingMode('openrouter', 'auto').mode, 'balance');
check('provider=xiaomi（按量）→ balance', detectBillingMode('xiaomi', 'auto').mode, 'balance');
// v1.7 FR-14：云账单型 provider → billing（互斥第三态）
check('provider=together → billing', detectBillingMode('together', 'auto').mode, 'billing');
check('provider=fireworks → billing', detectBillingMode('fireworks', 'auto').mode, 'billing');
check('provider=amazon-bedrock → billing', detectBillingMode('amazon-bedrock', 'auto').mode, 'billing');
check('provider=cloudflare-ai-gateway → billing', detectBillingMode('cloudflare-ai-gateway', 'auto').mode, 'billing');
check('provider=cloudflare-workers-ai → billing', detectBillingMode('cloudflare-workers-ai', 'auto').mode, 'billing');
check('billing 理由含 provider 标识', detectBillingMode('together', 'auto').reason, 'provider:together');
// v1.7：账单源映射
check('together → 账单源 together', billingSourceFor('together'), 'together');
check('fireworks → 账单源 fireworks', billingSourceFor('fireworks'), 'fireworks');
check('amazon-bedrock → 账单源 amazon-bedrock', billingSourceFor('amazon-bedrock'), 'amazon-bedrock');
check('cloudflare-workers-ai → 账单源 cloudflare（共用）', billingSourceFor('cloudflare-workers-ai'), 'cloudflare');
check('cloudflare-ai-gateway → 账单源 cloudflare（共用）', billingSourceFor('cloudflare-ai-gateway'), 'cloudflare');
check('deepseek → 账单源 null', billingSourceFor('deepseek'), null);
// v1.7：小米 Token Plan 三集群按地区分源（互不串数据）
check('xiaomi-token-plan-cn → 订阅源 xiaomi-cn', subscriptionSourceFor('xiaomi-token-plan-cn'), 'xiaomi-cn');
check('xiaomi-token-plan-sgp → 订阅源 xiaomi-sgp', subscriptionSourceFor('xiaomi-token-plan-sgp'), 'xiaomi-sgp');
check('xiaomi-token-plan-ams → 订阅源 xiaomi-ams', subscriptionSourceFor('xiaomi-token-plan-ams'), 'xiaomi-ams');
check('xiaomi（按量）→ 订阅源 null（余额制）', subscriptionSourceFor('xiaomi'), null);
// v1.7：账户映射
check('账户映射：xiaomi → xiaomi', accountForProvider('xiaomi'), 'xiaomi');
check('账户映射：xiaomi-token-plan-sgp → xiaomi-token-plan', accountForProvider('xiaomi-token-plan-sgp'), 'xiaomi-token-plan');
check('账户映射：together → together', accountForProvider('together'), 'together');
check('账户映射：amazon-bedrock → amazon-bedrock', accountForProvider('amazon-bedrock'), 'amazon-bedrock');
check('账户映射：cloudflare-ai-gateway → cloudflare', accountForProvider('cloudflare-ai-gateway'), 'cloudflare');
check('账户映射：未知 → null', accountForProvider('some-unknown'), null);
check('未知 provider → balance（兜底）', detectBillingMode('some-new-provider', 'auto').mode, 'balance');
check('空 provider → balance（兜底）', detectBillingMode('', 'auto').mode, 'balance');
check('自动识别忽略旧的手动覆盖参数：codex 仍为 subscription', detectBillingMode('codex', 'balance').mode, 'subscription');
check('自动识别忽略旧的手动覆盖参数：deepseek 仍为 balance', detectBillingMode('deepseek', 'subscription').mode, 'balance');
check('自动识别理由只含 provider', detectBillingMode('codex', 'balance').reason, 'provider:codex');
check('auto 理由含 provider 标识', detectBillingMode('codex', 'auto').reason, 'provider:codex');
check('订阅 provider 集合配置正确', JSON.stringify(SUBSCRIPTION_PROVIDERS), JSON.stringify(['codex', 'chatgpt', 'opencode-go', 'opencode', 'openai-codex', 'zai', 'zai-coding-cn', 'xiaomi-token-plan-cn', 'xiaomi-token-plan-sgp', 'xiaomi-token-plan-ams']));
check('账单 provider 集合配置正确', JSON.stringify(BILLING_PROVIDERS), JSON.stringify(['together', 'fireworks', 'amazon-bedrock', 'cloudflare-ai-gateway', 'cloudflare-workers-ai']));

check('窗口标签表配置正确', JSON.stringify(WINDOW_LABELS), JSON.stringify({ five_hour: '5 小时', seven_day: '周', monthly: '月' }));

// ---- 2) OpenCode Go 响应解析 ----
const ogFull = { usage: {
  rolling: { status: 'ok', percent: 9, resetsAt: '2026-08-14T07:20:04.810Z' },
  weekly: { status: 'ok', percent: 12, resetsAt: '2026-08-17T00:00:00.810Z' },
  monthly: { status: 'ok', percent: 6, resetsAt: '2026-09-09T00:41:03.810Z' },
} };
const ogParsed = parseOpenCodeGoUsage(ogFull);
check('OpenCode Go 完整三窗口：数量 = 3', ogParsed.windows.length, 3);
check('OpenCode Go rolling → five_hour', ogParsed.windows[0].key, 'five_hour');
check('OpenCode Go weekly → seven_day', ogParsed.windows[1].key, 'seven_day');
check('OpenCode Go monthly → monthly', ogParsed.windows[2].key, 'monthly');
check('OpenCode Go 百分比取整', ogParsed.windows[0].usedPercent, 9);
check('OpenCode Go resetsAt ISO → 毫秒', ogParsed.windows[0].resetsAt, Date.parse('2026-08-14T07:20:04.810Z'));
check('OpenCode Go 固定套餐名', ogParsed.plan, 'OpenCode Go');

// status 非 ok 的处理：非 ok 窗口跳过，ok 窗口保留
const ogPartial = { usage: {
  rolling: { status: 'error', percent: 9, resetsAt: null },
  weekly: { status: 'ok', percent: 12, resetsAt: 1785000000000 },
  monthly: { status: 'limit', percent: 6, resetsAt: null },
} };
const ogParsedPartial = parseOpenCodeGoUsage(ogPartial);
check('status 非 ok 窗口跳过（rolling/monthly 剔除）', ogParsedPartial.windows.length, 1);
check('仅保留 ok 窗口（weekly）', ogParsedPartial.windows[0].key, 'seven_day');
check('毫秒级数值 resetsAt 原样保留', ogParsedPartial.windows[0].resetsAt, 1785000000000);

// 数值型 resetsAt：秒级 ×1000
const ogSec = { usage: { weekly: { status: 'ok', percent: 50, resetsAt: 1785000000 } } };
check('秒级数值 resetsAt → ×1000', parseOpenCodeGoUsage(ogSec).windows[0].resetsAt, 1785000000000);
check('负数 resetsAt → null（不接受已过期的伪重置时间）', normalizeResetAt(-1), null);

// 结构异常 → null
check('OpenCode Go 空对象 → null', parseOpenCodeGoUsage({}), null);
check('OpenCode Go 无 usage → null', parseOpenCodeGoUsage({ foo: 1 }), null);
check('OpenCode Go null → null', parseOpenCodeGoUsage(null), null);

// ---- 5) 快照失败回退（mergeSubscriptionResult：失败保留旧 data/fetchedAt，仅换 error） ----
const prevSnap = {
  data: { provider: 'codex', plan: 'ChatGPT Plus', windows: [{ key: 'seven_day', label: '周', usedPercent: 43, resetsAt: 1787200342000 }] },
  fetchedAt: 12345,
  error: null,
};
const failedSnap = mergeSubscriptionResult(prevSnap, { error: { kind: 'http', message: '请求失败（HTTP 500）' } });
check('失败后旧 data 保留', failedSnap.data, prevSnap.data);
check('失败后旧 fetchedAt 保留', failedSnap.fetchedAt, 12345);
check('失败后 error 标记更新', failedSnap.error, { kind: 'http', message: '请求失败（HTTP 500）' });
const okSnap = mergeSubscriptionResult(prevSnap, { data: { provider: 'codex', plan: 'ChatGPT Pro', windows: [] } });
check('成功后 data 替换', okSnap.data.plan, 'ChatGPT Pro');
check('成功后 error 清除', okSnap.error, null);
check('成功后 fetchedAt 更新为当前时间', typeof okSnap.fetchedAt === 'number' && okSnap.fetchedAt > 0, true);
const noPrevFailed = mergeSubscriptionResult(undefined, { error: { kind: 'no-key', message: '未配置' } });
check('无旧快照时失败 → data=null fetchedAt=null', noPrevFailed.data === null && noPrevFailed.fetchedAt === null, true);

// ---- 6) client 订阅制渲染分支静态检查 ----
// 提取 client 订阅制渲染函数体，验证 row2 只含三类信息（模型/额度/距重置），不含余额制专属信息
function extractClientFnBody(name) {
  const start = clientSrc.indexOf('function ' + name);
  if (start < 0) throw new Error('未找到 client function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < clientSrc.length) {
    const c = clientSrc[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return clientSrc.slice(start, i + 1);
}
const subFn = extractClientFnBody('pushSubscriptionGroups');

check('client 按会话优先的 billingMode 分支互斥渲染', clientSrc.includes("const isSub = !!(visibleBillingMode && visibleBillingMode.mode === 'subscription')"), true);
check('client 余额制渲染函数独立保留', clientSrc.includes('function pushBalanceGroups(groups, trailingErrorGroups)'), true);
check('client 订阅制渲染函数存在', clientSrc.includes('function pushSubscriptionGroups(groups, trailingErrorGroups)'), true);
check('client 三窗口显示剩余百分比（统一标签/数据间距 + 加粗数据令牌；v1.9 PR2 每窗口独立 data-field）', clientSrc.includes("winNodes.push(fieldSpan(WINDOW_FIELD_IDS[w.key] || 'subWindow5h', 'w' + i,"), true);
check('client compact 密度精简为最紧窗口', clientSrc.includes('const visible = full ? windows : (displayWindow ? [displayWindow] : []);'), true);
check('client 无订阅快照时不显示加载中（RPC 后台补齐）', subFn.includes("'订阅额度加载中…'"), false);
check('client 窗口渲染由 hasData 门控（空窗口跳过不占位）', subFn.includes('if (hasData) {'), true);
check('client 订阅失败原因统一通过简短悬停说明', clientSrc.includes('subscriptionFailureHint') && clientSrc.includes("t('ui.isTemporarilyUnavailableCheckYour'"), true);
check('client 预警阈值常量 = 20（剩余 ≤20% 即告警，与 host 余额 ALERT_THRESHOLD=20 一致）', clientSrc.includes('const LOW_QUOTA_PERCENT = 20'), true);
check('client 预警触发条件：剩余 ≤20% 时将对应额度数字标红', clientSrc.includes("remaining <= LOW_QUOTA_PERCENT ? 'bi-quota-low' : ''"), true);
check('client 距重置倒计时使用同一窗口，并通过统一 metric 间距呈现', clientSrc.includes("metric(t('ui.resetsIn'), fmtResetCountdown(displayWindow.resetsAt - now))"), true);
check('client fmtResetCountdown 天级格式（1d 21h）', clientSrc.includes("d + 'd ' + h + 'h'"), true);
check('client hover 明细含重置时刻（formatDateTime）', clientSrc.includes("t('ui.resetsResetsIn', { value: formatDateTime(w.resetsAt), value2: fmtResetCountdown(w.resetsAt - now) })"), true);
check('client hover 距重置用天级格式（避免与剩余%混淆）', clientSrc.includes("value2: fmtResetCountdown(w.resetsAt - now)"), true);
check('client 订阅制模型组显示订阅服务名（subscriptionProviderGroup；v1.9 PR2 经 subServiceGroup 门控+着色）', clientSrc.includes("const subAnchor = subscriptionProviderGroup();")
  && clientSrc.includes("groups.push(React.cloneElement(subAnchor, { 'data-field': 'subServiceGroup', style: fieldStyle('subServiceGroup') }));"), true);
check('client 订阅服务名映射含 OpenCode Go / Codex / ChatGPT', clientSrc.includes("return 'OpenCode Go'") && clientSrc.includes("return 'Codex'") && clientSrc.includes("return 'ChatGPT'"), true);
check('client 订阅失败提示按实际订阅服务命名，不把 Codex 误称为 ChatGPT', clientSrc.includes('const serviceName = subscriptionServiceName(source);'), true);
check('client openai-codex → ChatGPT（Codex/ChatGPT 已合并）', clientSrc.includes("if (provider === 'chatgpt' || provider === 'openai-codex') return 'ChatGPT';"), true);
check('client codex → Codex 保持（映射不变）', clientSrc.includes("if (provider === 'codex') return 'Codex';"), true);
check('client 剩余 = 100 - 已用（钳制 ≥0）', clientSrc.includes('return Math.max(0, 100 - w.usedPercent);'), true);
check('client 紧凑标签 five_hour → 5h', clientSrc.includes("if (key === 'five_hour') return '5h';"), true);
check('client hover 明确写 剩余 xx%（已用 xx%）', clientSrc.includes("t('ui.windowRemainingUsed', { label: quotaWindowLabel(w), value: remainingPercent(w), usedPercent: w.usedPercent })"), true);
check('client 告急时仅将对应额度数字标为鲜红色', clientSrc.includes("const numberClass = remaining <= LOW_QUOTA_PERCENT ? 'bi-quota-low' : '';"), true);
check('client 订阅源标题用会话优先的订阅服务名映射（openai-codex 显示 ChatGPT）', clientSrc.includes("t('ui.subscriptionSource.titleLines', { value: subscriptionServiceName(visibleBillingMode && visibleBillingMode.provider) })"), true);
check('client 订阅制显示充值余额（sub.balance）', subFn.includes('sub.balance'), true);
check('client 订阅·充值余额形态追加本会话花费块（共用 pushSessionCost）', subFn.includes('pushSessionCost(groups, trailingErrorGroups, false)'), true);
check('client 订阅制不显示距高峰倒计时', subFn.includes('距高峰'), false);
check('client 订阅制不显示本会话 token 用量（subtok 已移除）', subFn.includes('subtok'), false);
check('client 刷新失败只显示简短标签并提供悬停说明', clientSrc.includes("t('ui.refreshFailed')") && clientSrc.includes('subscriptionFailureHint'), true);

// ---- 6.5) v1.7 三态互斥 + JWT 订阅卡 + 账单型静态检查 ----
const billFn = extractClientFnBody('pushBillingGroups');
check('client 账单型渲染分支存在（pushBillingGroups）', clientSrc.includes('function pushBillingGroups(groups, trailingErrorGroups)'), true);
check('client 三态互斥：row2 依次判定 billing → subscription → balance', clientSrc.includes('} else if (isBilling) {') && clientSrc.includes('} else if (isSub) {') && clientSrc.includes('} else {') && clientSrc.includes('pushBalanceGroups(groups, trailingErrorGroups)'), true);
check('client 账单型不显示余额/本会话花费/峰谷时段', !billFn.includes('余额 ') && !billFn.includes('本会话 ') && !billFn.includes("t('ui.peakPrice')"), true);
check('client 账单型显示本月真实花费（本月 $X）', clientSrc.includes("metric(t('ui.thisMonth'), symbol + fmt(d.currentPeriodSpend, 2))"), true);
check('client 账单型显示预算%（本月 $X · 预算 Y%）', clientSrc.includes("metric(t('ui.budget'), fmt(d.budgetPercent, 0) + '%')"), true);
check('client 账单型免费额度仅在接口给出免费字段时显示（绝不编造）', clientSrc.includes('d.freeRemaining != null && d.resetsAt'), true);
check('client 账单型无金额时按真实用量展示', clientSrc.includes("metric(t('ui.thisMonthSUsage'), fmt(d.usage, 2)"), true);
check('client 账单服务名映射：Together/Fireworks/AWS Bedrock/Cloudflare', clientSrc.includes("return 'Together'") && clientSrc.includes("return 'Fireworks'") && clientSrc.includes("return 'AWS Bedrock'") && clientSrc.includes("return 'Cloudflare'"), true);
check('client 订阅服务名含小米 MiMo', clientSrc.includes("return t('ui.xiaomiMiMo')"), true);
check('client JWT 订阅卡：套餐档位短名映射（plus→Plus 等）', clientSrc.includes("const map = { plus: 'Plus', pro: 'Pro', team: 'Team', enterprise: 'Enterprise' };"), true);
check('client JWT 订阅卡：到期日期渲染（到期 YYYY-MM-DD）', clientSrc.includes("metric(t('ui.expires'), formatDate(sub.expiryAt))"), true);
check('client JWT 订阅卡：模型位显示套餐档位（ChatGPT · Plus）', clientSrc.includes('const planShort = subSnapshot && subSnapshot.planType ? subscriptionPlanShort(subSnapshot.planType) : null;'), true);
check('client 账单型失败保留旧快照提示（bill.error || errors.billing）', billFn.includes('bill.error || errors.billing'), true);
check('client load 含 getBillingStatus 端点', clientSrc.includes("rpc('getBillingStatus'"), true);
check('client mergeLoadResults 含 billing 键', clientSrc.includes("keys = ['balance', 'pricing', 'usage', 'billingMode', 'sub', 'billing']"), true);

// ---- 7) host RPC 完整性静态检查 ----
check('host 含 getBillingMode RPC', hostSrc.includes('getBillingMode: function'), true);
check('host 含 getSubscriptionSnapshot RPC', hostSrc.includes('getSubscriptionSnapshot: function'), true);
check('host 不再保留 billingMode 手动配置', !hostSrc.includes('billingMode: config.billingMode') && !hostSrc.includes("billingMode: 'auto'"), true);
check('host 双模式纯函数可提取（模块级）', typeof parseOpenCodeGoUsage === 'function' && typeof detectBillingMode === 'function' && typeof mergeSubscriptionResult === 'function', true);

// ---- 8) 会话级实时模型同步 ----
// host 端 getBillingMode 纯本地：会话选择由客户端已订阅的模型目录提供，不需要轮询。
const bmRoute = hostSrc.slice(hostSrc.indexOf('getBillingMode: function'), hostSrc.indexOf('getSubscriptionSnapshot: function'));
check('host getBillingMode 纯本地（路由体无 fetch 调用）', !bmRoute.includes('fetch('), true);
check('host getBillingMode 返回 model 字段（同 provider 换模型也可检测）', hostSrc.includes('model: sel.model'), true);
check('client 订阅会话级 modelDirectories（不读全局默认模型）', clientSrc.includes("ctx.get('modelDirectories')") && clientSrc.includes('directories.directoryFor(sessionId)'), true);
check('client 订阅模型目录 store，切换立即发布', clientSrc.includes('directory.store.subscribe(publish)'), true);
check('client 模型切换会强制刷新当前服务商数据', clientSrc.includes('const selectionChanged = selectionKey !== lastSelectionKeyRef.current;')
  && clientSrc.includes('const force = selectionChanged || Date.now() - BOOT_AT < FORCE_REFRESH_WINDOW_MS;'), true);
check('client 不含 2 秒高频 getBillingMode 轮询', !/setInterval\(function \(\) \{\s*rpc\('getBillingMode'\)[\s\S]*?\}, 2000\)/.test(clientSrc), true);
check('client 用版本号阻止旧会话响应覆盖新会话', clientSrc.includes('requestVersion !== loadVersionRef.current'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
