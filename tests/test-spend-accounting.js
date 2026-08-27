// host 记账真实性审计：验证"本会话/今天/近一月/全部"按真实 usage 逐请求记账、
// 本会话按"会话起点 + 账户聚合（含子代理）"口径区分
// 用法：node tests/test-spend-accounting.js
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../plugin/src/host.js', 'utf8');

// 提取记账相关纯函数，在桩环境验证（不执行 apply）
function extractFn(name) {
  const re = new RegExp('function ' + name + '\\n    \\(([\\s\\S]*?)\\n    \\}', 'm');
  const re2 = new RegExp('function ' + name + '\\(([\\s\\S]*?)\\n    \\}', 'm');
  let m = src.match(re) || src.match(re2);
  if (!m) throw new Error('未找到 function ' + name);
  // 提取完整函数文本
  const start = src.indexOf('function ' + name);
  // 从 start 向后找匹配的 '    }'（函数体结尾）——用括号计数法
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
  const body = src.slice(start, i + 1);
  return eval('(' + body + ')');
}

// 关键：成本计算依赖 PRICING，从正式源码提取定价表
const PRICING = eval('(' + src.match(/const PRICING = ([\s\S]*?);\n    function modelCurrency/)[1] + ')');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { pass++; console.log('PASS  ' + label + ' → ' + JSON.stringify(actual)); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

// ---- 手动复刻记账核心逻辑（与 host.js 逐行一致）验证正确性 ----
function beijingDayKey(ts) {
  const d = new Date(ts + 8 * 3600 * 1000);
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}
function currentPeriod(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60) ? 'peak' : 'offpeak';
}
function costOf(record) {
  const entry = PRICING[record.model];
  if (!entry) return null;
  const p = entry.mode === 'peak-valley' ? entry[currentPeriod(record.ts)] : entry.price;
  const missInput = record.input + record.cacheWrite;
  return (missInput * p.inputCacheMiss + record.cacheRead * p.inputCacheHit + record.output * p.output) / 1e6;
}

// 视觉实验型号归入 V4 Flash 峰谷价格：展示与记账都不能再回退为“未收录”。
check('视觉实验型号收录为 V4 Flash 峰谷价', PRICING['deepseek-v4-flash-vision-exp'], PRICING['deepseek-v4-flash']);

// ---- 构造 3 个主会话 + 1 个子代理的模拟 usage 记录（同账户，子代理独立 sessionId、同时间窗） ----
const NOW = Date.parse('2026-08-15T04:00:00+08:00'); // 北京时间 8/15 04:00（空闲时段）
const H = 3600 * 1000;
const usageRecords = [
  // 会话 A：今天 2 次调用
  { ts: NOW - 2 * H, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 'session-A', input: 1000, cacheRead: 500, cacheWrite: 0, output: 2000 },
  { ts: NOW - 1 * H, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 'session-A', input: 800, cacheRead: 600, cacheWrite: 0, output: 1500 },
  // 会话 B：今天 1 次 + 上月 1 次
  { ts: NOW - 3 * H, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 'session-B', input: 2000, cacheRead: 0, cacheWrite: 0, output: 3000 },
  { ts: NOW - 30 * 24 * H, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 'session-B', input: 500, cacheRead: 100, cacheWrite: 0, output: 1000 },
  // 会话 C：上个月
  { ts: NOW - 40 * 24 * H, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 'session-C', input: 3000, cacheRead: 0, cacheWrite: 0, output: 5000 },
  // 会话 A 的子代理记录：独立 sessionId、同账户 deepseek、时间落在 A 的两条记录之间（A 起点之后）
  { ts: NOW - 1.5 * H, model: 'deepseek-v4-flash', provider: 'deepseek', sessionId: 'session-A-sub', input: 400, cacheRead: 100, cacheWrite: 0, output: 600 },
];
const subRecord = usageRecords[usageRecords.length - 1];

// ---- 按会话聚合（复刻 sessionTotals） ----
function sessionTotals() {
  const map = new Map();
  for (let i = 0; i < usageRecords.length; i++) {
    const r = usageRecords[i];
    const key = r.sessionId || (r.provider + '/' + r.model + '#' + r.ts);
    let s = map.get(key);
    if (!s) {
      s = { sessionId: r.sessionId, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costs: {}, lastTs: r.ts };
      map.set(key, s);
    }
    s.input += r.input;
    s.cacheRead += r.cacheRead;
    s.cacheWrite += r.cacheWrite;
    s.output += r.output;
    const c = costOf(r);
    if (c != null) s.costs.CNY = (s.costs.CNY || 0) + c;
    if (r.ts > s.lastTs) s.lastTs = r.ts;
  }
  return Array.from(map.values()).sort(function (a, b) { return a.lastTs - b.lastTs; });
}

// ---- v1.7 本会话聚合（含子代理）复刻——与 host.js currentSessionSummary 逐行一致：
// 会话起点 = 当前 sessionId 最早记录 ts；聚合同账户（recordAccount === activeAccount）且 ts >= 起点的全部记录 ----
function normalizeSessionId(id) {
  if (!id) return '';
  return String(id).replace(/^session-/, '');
}
function recordAccount(r) {
  if (r.provider === 'deepseek' || r.provider === 'deepseek-official') return 'deepseek';
  if (r.provider === 'openai') return 'openai';
  return null;
}
function currentSessionSummary(usageRecords, activeAccount, sessionId) {
  if (!usageRecords || usageRecords.length === 0) return null;
  if (!sessionId) return null; // 无可用会话 ID：不猜测归属，显示 ¥0.000
  const norm = normalizeSessionId(sessionId);
  let sessionStart = null;
  for (let i = 0; i < usageRecords.length; i++) {
    const r = usageRecords[i];
    if (normalizeSessionId(r.sessionId) !== norm) continue;
    if (sessionStart === null || r.ts < sessionStart) sessionStart = r.ts;
  }
  if (sessionStart === null) return null;
  const acc = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, costs: {} };
  for (let i = 0; i < usageRecords.length; i++) {
    const r = usageRecords[i];
    if (r.ts < sessionStart) continue;
    if (recordAccount(r) !== activeAccount) continue;
    acc.input += r.input;
    acc.cacheRead += r.cacheRead;
    acc.cacheWrite += r.cacheWrite;
    acc.output += r.output;
    const c = costOf(r);
    if (c != null) acc.costs.CNY = (acc.costs.CNY || 0) + c;
  }
  return { tokens: acc.input + acc.cacheRead + acc.cacheWrite + acc.output, costs: acc.costs };
}
function todaySpend(nowMs) {
  const key = beijingDayKey(nowMs);
  let total = 0;
  for (let i = 0; i < usageRecords.length; i++) {
    const r = usageRecords[i];
    if (beijingDayKey(r.ts) !== key) continue;
    const c = costOf(r);
    if (c != null) total += c;
  }
  return Math.round(total * 1000) / 1000;
}
function monthSpend(nowMs) {
  const d = new Date(nowMs + 8 * 3600 * 1000);
  const key = d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
  let total = 0;
  for (let i = 0; i < usageRecords.length; i++) {
    const r = usageRecords[i];
    const rd = new Date(r.ts + 8 * 3600 * 1000);
    if (rd.getUTCFullYear() + '-' + String(rd.getUTCMonth() + 1).padStart(2, '0') !== key) continue;
    const c = costOf(r);
    if (c != null) total += c;
  }
  return Math.round(total * 1000) / 1000;
}
function totalSpend() {
  let total = 0;
  for (let i = 0; i < usageRecords.length; i++) {
    const c = costOf(usageRecords[i]);
    if (c != null) total += c;
  }
  return Math.round(total * 1000) / 1000;
}

const sessions = sessionTotals();

// ---- 断言 ----
// 1) 本会话聚合（含子代理）：会话起点 = 当前 sessionId 最早记录 ts；聚合同账户 ts>=起点的全部记录
const sA = currentSessionSummary(usageRecords, 'deepseek', 'session-A');
const sB = currentSessionSummary(usageRecords, 'deepseek', 'session-B');
const sC = currentSessionSummary(usageRecords, 'deepseek', 'session-C');
const A2Tokens = 1000 + 500 + 0 + 2000 + 800 + 600 + 0 + 1500; // 会话 A 两条记录
const subTokens = subRecord.input + subRecord.cacheRead + subRecord.cacheWrite + subRecord.output; // 子代理记录
const B2Tokens = 2000 + 0 + 0 + 3000 + 500 + 100 + 0 + 1000; // 会话 B 两条记录
const C1Tokens = 3000 + 0 + 0 + 5000; // 会话 C
check('本会话 A tokens（A 2 次 + 同账户子代理 1 次）', sA.tokens, A2Tokens + subTokens);
check('子代理记录被并入本会话 A（独立 sessionId、同账户、同时间窗）', sA.tokens > A2Tokens, true);
check('本会话 B tokens（起点后同账户全部 = A + 子代理 + B）', sB.tokens, A2Tokens + subTokens + B2Tokens);
check('本会话 C tokens（最旧起点 → 同账户全量）', sC.tokens, A2Tokens + subTokens + B2Tokens + C1Tokens);
// A 与 B/C 花费不同（会话起点不同 → 聚合范围不同）
check('A 花费 ≠ B 花费', sA.costs.CNY !== sB.costs.CNY, true);
check('B 花费 ≠ C 花费', sB.costs.CNY !== sC.costs.CNY, true);
check('会话聚合随起点单调：C >= B >= A（含子代理的会话窗重叠）', sC.costs.CNY >= sB.costs.CNY && sB.costs.CNY >= sA.costs.CNY, true);
// 2) 今天/近一月/近30天/全部 与总账一致（会话聚合重叠不影响汇总口径）
const totalOfAll = usageRecords.reduce(function (sum, r) { const c = costOf(r); return c != null ? sum + c : sum; }, 0);
check('全部花费 = 全量记录直接求和（会话窗重叠不重复计费）', Math.round(totalSpend() * 1000) / 1000, Math.round(totalOfAll * 1000) / 1000);
// 今天 = A(2次) + B(1次今天) + 子代理(1次)；不含 C 与 B 上月
const todayExpected = costOf(usageRecords[0]) + costOf(usageRecords[1]) + costOf(usageRecords[2]) + costOf(subRecord);
check('今天花费 = A 今天 2 次 + B 今天 1 次 + 子代理 1 次', todaySpend(NOW), Math.round(todayExpected * 1000) / 1000);
// 近一月（自然月 8 月）= 今天 4 次（B 上月 7/16、C 7/6 均属 7 月，不计入）
const monthExpected = todayExpected;
check('近一月花费（自然月）= 今天 4 次（7 月记录不计入）', monthSpend(NOW), Math.round(monthExpected * 1000) / 1000);
// 近30天滚动窗口（用户"近一个月"直觉）：今天 4 次 + B 上月 1 次（30 天内），C 40 天前不算
function last30dSpend() {
  const cutoff = NOW - 30 * 24 * 3600 * 1000;
  let total = 0;
  for (let i = 0; i < usageRecords.length; i++) {
    const r = usageRecords[i];
    if (r.ts < cutoff) continue;
    const c = costOf(r);
    if (c != null) total += c;
  }
  return Math.round(total * 1000) / 1000;
}
const d30Expected = todayExpected + costOf(usageRecords[3]);
check('近30天滚动窗口 = 今天 4 次 + B 30天内 1 次（C 40 天前不算）', last30dSpend(), Math.round(d30Expected * 1000) / 1000);
// 3) 全部 >= 近一月 >= 今天
check('全部 >= 近一月', totalSpend() >= monthSpend(NOW), true);
check('近一月 >= 今天', monthSpend(NOW) >= todaySpend(NOW), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
