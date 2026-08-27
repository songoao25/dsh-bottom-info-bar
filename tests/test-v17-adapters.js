// v1.7 新增适配器单测（指向正式源码 plugin/src/host.js + plugin/src/client-bundle.js）：
// ① FR-8 本地 JWT 解码（嵌套命名空间实测形态 / 扁平兜底 / padding / 失败静默）
// ② FR-9 小米 MiMo 解析（tokenPlan/usage、tokenPlan/balance、按量 balance；百分比 0-1 与 0-100 双形态）
// ③ FR-10 Together 账单解析
// ④ FR-11 Fireworks（account_id / summary / usage 回退）
// ⑤ FR-12 AWS SigV4 固定签名向量（AWS 官方 IAM ListUsers 例）+ CE/Budgets 解析
// ⑥ FR-13 Cloudflare Billable Usage 解析（免费额度仅接口给出时推导）
// ⑦ FR-14 normalizeAccountStatus 统一收敛
// 用法：node tests/test-v17-adapters.js
const fs = require('fs');
const { createHmac, createHash } = require('node:crypto');

const hostSrc = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');
const clientSrc = fs.readFileSync(__dirname + '/../plugin/src/client-bundle.js', 'utf8');
const constantsSrc = fs.readFileSync(__dirname + '/../plugin/src/constants.js', 'utf8');

function extractConst(name) {
  const re = new RegExp('const ' + name + ' = (\\[[^\\n]*?\\]|\\{[^\\n]*?\\}|[^\\n]+?)(?:\\s*//[^\\n]*)?\\n');
  const m = hostSrc.match(re);
  if (!m) throw new Error('未找到 const ' + name);
  return eval('(' + m[1] + ')');
}
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

// ---- 依赖常量/函数（必须先于被测函数声明，eval 闭包才能解析） ----
const WINDOW_LABELS = extractConst('WINDOW_LABELS');
const subMatch = constantsSrc.match(/export const SUBSCRIPTION_PROVIDERS = (\[[\s\S]*?\]);?/);
const billMatch = constantsSrc.match(/export const BILLING_PROVIDERS = (\[[\s\S]*?\]);?/);
const SUBSCRIPTION_PROVIDERS = eval('(' + subMatch[1] + ')');
const BILLING_PROVIDERS = eval('(' + billMatch[1] + ')');

const decodeJwtPayload = extractFn('decodeJwtPayload');
const chatgptClaimSource = extractFn('chatgptClaimSource');
const parseCodexJwt = extractFn('parseCodexJwt');
const xiaomiRegionBaseUrl = extractFn('xiaomiRegionBaseUrl');
const xiaomiPercentToUsed = extractFn('xiaomiPercentToUsed');
const parseXiaomiTokenPlanUsage = extractFn('parseXiaomiTokenPlanUsage');
const parseXiaomiTokenPlanBalance = extractFn('parseXiaomiTokenPlanBalance');
const parseXiaomiPaygBalance = extractFn('parseXiaomiPaygBalance');
const nextMonthStartMs = extractFn('nextMonthStartMs');
const parseTogetherUsage = extractFn('parseTogetherUsage');
const parseFireworksAccountId = extractFn('parseFireworksAccountId');
const parseFireworksSummary = extractFn('parseFireworksSummary');
const parseFireworksUsage = extractFn('parseFireworksUsage');
const sha256Hex = extractFn('sha256Hex');
const hmacSha256 = extractFn('hmacSha256');
const awsAmzDate = extractFn('awsAmzDate');
const awsShortDate = extractFn('awsShortDate');
const awsUriEncode = extractFn('awsUriEncode');
const awsSigV4Headers = extractFn('awsSigV4Headers');
const parseBedrockCost = extractFn('parseBedrockCost');
const parseBedrockBudget = extractFn('parseBedrockBudget');
const parseCloudflareBilling = extractFn('parseCloudflareBilling');
const nextUtcMidnightMs = extractFn('nextUtcMidnightMs');
const normalizeAccountStatus = extractFn('normalizeAccountStatus');
const detectBillingMode = extractFn('detectBillingMode');
const subscriptionSourceFor = extractFn('subscriptionSourceFor');
const accountForProvider = extractFn('accountForProvider');
const billingSourceFor = extractFn('billingSourceFor');

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

// ================= ① FR-8：本地 JWT 解码 =================
// 程序化构造 token（保证 base64url 编码正确；任意 claims → 完整 JWT 三段）
function makeToken(payload) {
  const b64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return 'eyJhbGciOiJIUzI1NiJ9.' + b64 + '.e30';
}
// 2026-08-27 本机实测形态：claims 嵌套在 "https://api.openai.com/auth" 下
const fakeToken = makeToken({ 'https://api.openai.com/auth': { chatgpt_plan_type: 'plus', chatgpt_subscription_active_until: '2026-09-16T08:26:46+00:00' } });
check('JWT 解码：嵌套命名空间取到 plan_type=plus', decodeJwtPayload(fakeToken)['https://api.openai.com/auth'].chatgpt_plan_type, 'plus');
const nestedParsed = parseCodexJwt(fakeToken);
check('JWT 解析：planType=plus（嵌套命名空间）', nestedParsed && nestedParsed.planType, 'plus');
check('JWT 解析：expiryMs = 2026-09-16T08:26:46+00:00', nestedParsed && nestedParsed.expiryMs, Date.parse('2026-09-16T08:26:46+00:00'));
// 扁平形态兜底（调研 A1 曾记录的旧形态）
const flatParsed = parseCodexJwt(makeToken({ chatgpt_plan_type: 'pro', chatgpt_subscription_active_until: '2026-10-01T00:00:00Z' }));
check('JWT 解析：扁平 claims 兜底 pro', flatParsed && flatParsed.planType, 'pro');
check('JWT 解析：扁平 claims 兜底到期时间', flatParsed && flatParsed.expiryMs, Date.parse('2026-10-01T00:00:00Z'));
// 边界：URL-safe base64（+ / = 出现在 payload 中会被 makeToken 正确转换，天然覆盖 padding 补齐路径）
check('JWT 解析：仅 planType 无到期 → expiryMs=null', parseCodexJwt(makeToken({ chatgpt_plan_type: 'team' })).expiryMs, null);
check('JWT 解析：仅到期无套餐 → planType=null', parseCodexJwt(makeToken({ chatgpt_subscription_active_until: '2026-09-16T08:26:46+00:00' })).expiryMs, Date.parse('2026-09-16T08:26:46+00:00'));
// 大小写敏感字段名兜底（chatgpt_plan_type 首字母大写等变体 → 不识别，双字段缺失 → null）
check('JWT 解析：claims 字段缺失 → null（静默降级）', parseCodexJwt(makeToken({ foo: 'bar' })), null);
// 失败 → null（静默降级）
check('JWT 解析：坏 token → null', parseCodexJwt('not-a-jwt'), null);
check('JWT 解析：空串 → null', parseCodexJwt(''), null);
check('JWT 解析：非对象 payload → null', parseCodexJwt('eyJhbGciOiJIUzI1NiJ9.W10.e30'), null);
check('JWT 解码：坏 base64 → null', decodeJwtPayload('xx.yy.zz'), null);
check('JWT 解码：undefined → null', decodeJwtPayload(undefined), null);
// padding 补齐显式用例：人工构造缺少 padding 的 payload（base64 长度 4 的倍数差 1 位）
const noPad = 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ chatgpt_plan_type: 'enterprise' }), 'utf8').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.e30';
check('JWT 解码：缺 padding 亦可解析', parseCodexJwt(noPad).planType, 'enterprise');

// ================= ② FR-9：小米 MiMo 解析 =================
check('小米 baseUrl：cn', xiaomiRegionBaseUrl('cn'), 'https://token-plan-cn.xiaomimimo.com');
check('小米 baseUrl：sgp', xiaomiRegionBaseUrl('sgp'), 'https://token-plan-sgp.xiaomimimo.com');
check('小米 baseUrl：ams', xiaomiRegionBaseUrl('ams'), 'https://token-plan-ams.xiaomimimo.com');
// 百分比双形态
check('百分比 0.1661（0-1 形态）→ 17%', xiaomiPercentToUsed(0.1661), 17);
check('百分比 16.61（0-100 形态）→ 17%', xiaomiPercentToUsed(16.61), 17);
check('百分比字符串 "0.5" → 50%', xiaomiPercentToUsed('0.5'), 50);
check('百分比非法 → null', xiaomiPercentToUsed('abc'), null);
// tokenPlan/usage 响应（A4 调研形态）
const xmUsage = {
  code: 0,
  data: { monthUsage: { percent: 0.1661, items: [{ name: 'month_total_token', used: 265741632, limit: 1600000000, percent: 0.1661 }] }, plan_name: 'Pro' },
};
const xmUsageParsed = parseXiaomiTokenPlanUsage(xmUsage);
check('小米 usage：月度窗口 1 个', xmUsageParsed.windows.length, 1);
check('小米 usage：key=monthly / 已用 17%', xmUsageParsed.windows[0].key === 'monthly' && xmUsageParsed.windows[0].usedPercent, 17);
check('小米 usage：套餐名 Pro', xmUsageParsed.plan, 'Pro');
check('小米 usage：resetsAt = 本地下月 1 日零点', xmUsageParsed.windows[0].resetsAt, new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1, 0, 0, 0, 0).getTime());
// 无 monthUsage 时从 items 提取
const xmUsage2 = { data: { items: [{ name: 'month_total_token', used: 500, limit: 1000, percent: null }] } };
check('小米 usage：无 percent 由 used/limit 推算 50%', parseXiaomiTokenPlanUsage(xmUsage2).windows[0].usedPercent, 50);
// tokenPlan balance 形态（token_balance/token_limit）
const xmBalance = { data: { token_balance: 800000, token_limit: 1000000, plan_name: 'Pro' } };
const xmBalanceParsed = parseXiaomiTokenPlanBalance(xmBalance);
check('小米 tokenPlan balance：已用 20%（剩余 80%）', xmBalanceParsed.windows[0].usedPercent, 20);
check('小米 tokenPlan balance：套餐名 Pro', xmBalanceParsed.plan, 'Pro');
// 按量 balance（字符串金额 + data 包装）
const xmPayg = { data: { balance: '12.5000', charge_balance: '10.0000', granted_balance: '2.5000', plan: 'PAYG' } };
const xmPaygParsed = parseXiaomiPaygBalance(xmPayg);
check('小米按量：total 12.5 CNY', xmPaygParsed.total, 12.5);
check('小米按量：topUp 10 / granted 2.5', xmPaygParsed.toppedUp + xmPaygParsed.granted, 12.5);
check('小米按量：币种 CNY', xmPaygParsed.currency, 'CNY');
// 非法 → null
check('小米 usage：结构异常 → null', parseXiaomiTokenPlanUsage({}), null);
check('小米按量：无 balance → null', parseXiaomiPaygBalance({ data: {} }), null);

// ================= ③ FR-10：Together 账单 =================
const tgBody = {
  object: 'list', billing_period: '2026-08', currency: 'USD',
  data: [
    { window_start: '2026-08-26T00:00:00Z', usage: [{ model: 'm1', cost: 0.1234 }, { model: 'm2', cost: 1.8766 }] },
    { window_start: '2026-08-25T00:00:00Z', usage: [{ model: 'm3', cost: 2.5 }] },
  ],
};
check('Together：本月已用金额 = 4.5', parseTogetherUsage(tgBody), 4.5);
check('Together：无 usage 数组 → null', parseTogetherUsage({ object: 'list', data: [] }), null);
check('Together：空对象 → null', parseTogetherUsage({}), null);
check('Together：null → null', parseTogetherUsage(null), null);

// ================= ④ FR-11：Fireworks =================
const fwAccounts = { accounts: [{ id: 'fw_org_abc123', name: 'my-org' }] };
check('Fireworks：account_id 从 accounts[] 取', parseFireworksAccountId(fwAccounts), 'fw_org_abc123');
check('Fireworks：account_id 从裸数组取', parseFireworksAccountId([{ id: 'fw_org_x' }]), 'fw_org_x');
check('Fireworks：account_id 回退 name', parseFireworksAccountId({ accounts: [{ name: 'slug-name' }] }), 'slug-name');
check('Fireworks：account_id 缺失 → null', parseFireworksAccountId({ accounts: [] }), null);
const fwSummary = { lineItems: [{ series: 'SERVERLESS', totalCost: 12.34 }, { series: 'BATCH', totalCost: 0.66 }], usageBuckets: [{ date: '2026-08-26', cost: 99 }] };
check('Fireworks summary：lineItems totalCost 求和 = 13', parseFireworksSummary(fwSummary), 13);
check('Fireworks summary：无 lineItems 回退 usageBuckets', parseFireworksSummary({ usageBuckets: [{ cost: 2.5 }, { cost: 3.5 }] }), 6);
check('Fireworks summary：空 → null', parseFireworksSummary({}), null);
check('Fireworks usage：buckets 求和', parseFireworksUsage({ usageBuckets: [{ totalTokens: 100 }, { totalTokens: 200 }] }), 300);
check('Fireworks usage：空 → null', parseFireworksUsage({}), null);

// ================= ⑤ FR-12：AWS SigV4 固定向量 =================
// AWS 官方 Signature V4 测试用例（IAM ListUsers）：
// https://docs.aws.amazon.com/general/latest/gr/sigv4-signed-request-examples.html
const sigv4 = awsSigV4Headers({
  method: 'GET',
  host: 'iam.amazonaws.com',
  path: '/',
  query: 'Action=ListUsers&Version=2010-05-08',
  service: 'iam',
  region: 'us-east-1',
  body: '',
  accessKeyId: 'AKIDEXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
  headers: { 'content-type': 'application/x-www-form-urlencoded; charset=utf-8' },
  now: new Date('2015-08-30T12:36:00Z'),
});
check('SigV4：X-Amz-Date 格式', sigv4['X-Amz-Date'], '20150830T123600Z');
check('SigV4：签名 = AWS 官方向量 5d672d79…', sigv4.Authorization.indexOf('Signature=5d672d79c15b13162d9279b0855cfba6789a8edb4c82c400e06b5924a6f2b5d7') >= 0, true);
check('SigV4：Credential 作用域正确', sigv4.Authorization.indexOf('Credential=AKIDEXAMPLE/20150830/us-east-1/iam/aws4_request') >= 0, true);
check('SigV4：SignedHeaders 内容', sigv4.Authorization.indexOf('SignedHeaders=content-type;host;x-amz-date') >= 0, true);
// 辅助函数
check('SigV4：sha256 空串 = e3b0c442…', sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
ok('SigV4：HMAC 输出为 Buffer', hmacSha256('key', 'data') instanceof Buffer);
check('SigV4：awsAmzDate', awsAmzDate(new Date('2015-08-30T12:36:00Z')), '20150830T123600Z');
check('SigV4：awsShortDate', awsShortDate('20150830T123600Z'), '20150830');
check('SigV4：uriEncode 严格编码', awsUriEncode("a b!'()"), 'a%20b%21%27%28%29');
// session token 附加头
const sigv4St = awsSigV4Headers({
  method: 'GET', host: 'sts.amazonaws.com', path: '/', query: 'Action=GetCallerIdentity&Version=2011-06-15',
  service: 'sts', region: 'us-east-1', body: '',
  accessKeyId: 'AKID', secretAccessKey: 'SECRET', sessionToken: 'TOKEN',
  headers: {}, now: new Date('2015-08-30T12:36:00Z'),
});
check('SigV4：sessionToken 附加 X-Amz-Security-Token', sigv4St['X-Amz-Security-Token'], 'TOKEN');
check('SigV4：sessionToken 计入签名头', sigv4St.Authorization.indexOf('SignedHeaders=host;x-amz-date;x-amz-security-token') >= 0, true);
// Cost Explorer 响应解析
const ceJson = { ResultsByTime: [{ TimePeriod: { Start: '2026-08-01', End: '2026-08-28' }, Total: { UnblendedCost: { Amount: '12.3400', Unit: 'USD' } } }] };
check('CE：本月花费 12.34', parseBedrockCost(ceJson), 12.34);
check('CE：无结果 → null', parseBedrockCost({ ResultsByTime: [] }), null);
check('CE：空对象 → null', parseBedrockCost({}), null);
// Budgets 响应解析
const budgetsJson = { Budgets: [{ BudgetLimit: { Amount: '100.00', Unit: 'USD' }, CalculatedSpend: { ActualSpend: { Amount: '45.00', Unit: 'USD' }, ForecastedSpend: { Amount: '60' } } }] };
check('Budget：预算使用 45%', parseBedrockBudget(budgetsJson), 45);
check('Budget：无预算 → null', parseBedrockBudget({ Budgets: [] }), null);
check('Budget：金额非法 → null', parseBedrockBudget({ Budgets: [{ BudgetLimit: { Amount: '0' } }] }), null);

// ================= ⑥ FR-13：Cloudflare =================
const cfBody = {
  success: true,
  result: [
    { product: 'workers-ai', usage: 123456.7, cost: 0.9876, currency: 'USD' },
    { product: 'ai-gateway', usage: 5000, cost: 0.0124, currency: 'USD' },
  ],
};
const cfParsed = parseCloudflareBilling(cfBody);
check('Cloudflare：本月花费 = 1.0', cfParsed.spend, 1.0);
check('Cloudflare：本月用量 = 128456.7', cfParsed.usage, 128456.7);
check('Cloudflare：无免费额度字段 → freeRemaining=null（不编造）', cfParsed.freeRemaining, null);
// 接口显式给出 limit 才推导免费额度（同时存在 usage 使解析结果非空）
const cfFree = { success: true, result: [{ product: 'workers-ai', usage: 1234, used: 150, limit: 1000 }] };
const cfFreeParsed = parseCloudflareBilling(cfFree);
check('Cloudflare：接口给 limit → 免费剩余 850', cfFreeParsed.freeRemaining, 850);
check('Cloudflare：免费重置 = 下一个 UTC 零点', cfFreeParsed.resetsAt, nextUtcMidnightMs());
check('Cloudflare：无 cost 时 spend=null（只显示用量）', cfFreeParsed.spend, null);
check('Cloudflare：success=false → null', parseCloudflareBilling({ success: false, result: [] }), null);
check('Cloudflare：空 result → null', parseCloudflareBilling({ success: true, result: [] }), null);
check('Cloudflare：无数值字段 → null', parseCloudflareBilling({ success: true, result: [{ product: 'x' }] }), null);

// ================= ⑦ FR-14：normalizeAccountStatus =================
const norm = normalizeAccountStatus('billing', { kind: 'billing', spend: 12.34, budgetPercent: 45, currency: 'USD', note: '测试' });
check('normalize：currentPeriodSpend=12.34', norm.currentPeriodSpend, 12.34);
check('normalize：budgetPercent=45', norm.budgetPercent, 45);
check('normalize：currency=USD', norm.currency, 'USD');
check('normalize：note=测试', norm.note, '测试');
check('normalize：非法数值被忽略', normalizeAccountStatus('billing', { kind: 'billing', spend: NaN }).currentPeriodSpend, undefined);
check('normalize：非法 kind → null', normalizeAccountStatus('balance', { total: 1 }), null);
// 三态互斥判定
check('三态：together → billing', detectBillingMode('together', 'auto').mode, 'billing');
check('三态：xiaomi-token-plan-cn → subscription', detectBillingMode('xiaomi-token-plan-cn', 'auto').mode, 'subscription');
check('三态：xiaomi → balance', detectBillingMode('xiaomi', 'auto').mode, 'balance');
check('三态：deepseek → balance', detectBillingMode('deepseek', 'auto').mode, 'balance');

// ================= ⑧ client 静态检查（v1.7 渲染面） =================
const billFn = extractClientFnBody('pushBillingGroups');
check('client：账单型分支（三态互斥）', clientSrc.includes('} else if (isBilling) {') && clientSrc.includes('pushBillingGroups(groups, trailingErrorGroups)'), true);
check('client：账单型显示本月 $X', clientSrc.includes("metric('本月', symbol + fmt(d.currentPeriodSpend, 2))"), true);
check('client：账单型显示预算 Y%', clientSrc.includes("metric('预算', fmt(d.budgetPercent, 0) + '%')"), true);
check('client：账单型不显示余额类字段', !billFn.includes('余额 ') && !billFn.includes('本对话 '), true);
check('client：JWT 到期卡片（到期 YYYY-MM-DD）', clientSrc.includes("metric('到期', formatDate(sub.expiryAt))"), true);
check('client：JWT 套餐档位短名', clientSrc.includes('subscriptionPlanShort('), true);
check('client：BILLING_PROVIDERS 兜底注入', clientSrc.includes('BILLING_PROVIDERS.indexOf(activeSessionModel.provider)'), true);
check('client：账单服务名映射', clientSrc.includes("return 'AWS Bedrock'") && clientSrc.includes("return 'Cloudflare'") && clientSrc.includes("return 'Together'"), true);
check('client：订阅服务名含小米 MiMo', clientSrc.includes("return '小米 MiMo'"), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);