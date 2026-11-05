// Bottom Info Bar — 记账引擎（host 主线程与账本 worker 共用的唯一计价来源）
//
// 为什么单独成模块（issue #260）：账本（node:sqlite）跑在 worker 线程里，主线程不再执行
// 任何同步 sqlite 调用；worker 内的旧数据迁移与未计价回填必须和主线程用同一套价目表、
// 峰谷日历、币种与账户映射，否则两边算出的金额会漂移。这里保持纯函数 + 一张可增量更新的
// PRICING 表：host 用 createAccounting() 得到自己的实例，worker 也各建一份，远程价目由
// host 通过 setRemotePricingEntries 同步给 worker。
import { PROVIDER_DEFAULT_CURRENCY, PROVIDER_IDENTITY } from './constants.js'

const BEIJING_OFFSET_MS = 8 * 3600 * 1000

// ---------- 服务商账户映射（v1.6 分账核心）：DSH provider id → 账户键；未知返回 null ----------
// 账号映射只查 PROVIDER_IDENTITY（定义见 constants.js）：新增服务商加表行即可。
export function accountForProvider(pid) {
  if (!pid) return null
  const meta = Object.hasOwn(PROVIDER_IDENTITY, pid) ? PROVIDER_IDENTITY[pid] : null
  return meta ? meta.account : null
}

// 桶/索引的键都来自落盘记录（账户、币种、会话 ID）。JSON.parse 产生的 __proto__ 自有属性无害，
// 但 obj[key]= 赋值会触发原型污染——统一过一道键名护栏。
export function safeMapKey(value) {
  const str = String(value)
  return str === '__proto__' || str === 'constructor' || str === 'prototype' ? '_' + str : str
}

// ---------- 北京时间峰谷判定（纯函数，host 与 worker 共用）----------
// DeepSeek 自 2026-08-23 00:00（北京时间）起，周六、周日全天按空闲价计费。
// 以生效时刻为界，保留此前周末请求原有的峰谷结算规则，供未冻结的旧记录回算使用。
const WEEKEND_OFFPEAK_EFFECTIVE_AT = Date.UTC(2026, 7, 22, 16, 0, 0);
// Official holiday leave ranges (including adjacent leave days, not make-up workdays).
// https://www.gov.cn/zhengce/content/202511/content_7047090.htm
// Update this calendar after each year's State Council notice; unknown years
// retain the weekday/weekend rule rather than guessing lunar holiday dates.
const CHINESE_PUBLIC_HOLIDAYS = {
  2026: [['01-01', '01-03'], ['02-15', '02-23'], ['04-04', '04-06'],
    ['05-01', '05-05'], ['06-19', '06-21'], ['09-25', '09-27'], ['10-01', '10-07']],
};
function isChinesePublicHoliday(nowMs) {
  const d = new Date(nowMs + BEIJING_OFFSET_MS);
  const ranges = CHINESE_PUBLIC_HOLIDAYS[d.getUTCFullYear()] || [];
  const key = String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  return ranges.some(function (range) { return key >= range[0] && key <= range[1]; });
}
function beijingMinutes(nowMs) {
  const d = new Date(nowMs + BEIJING_OFFSET_MS);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}
export function currentPeriod(nowMs) {
  const d = new Date(nowMs + BEIJING_OFFSET_MS);
  const weekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
  if (nowMs >= WEEKEND_OFFPEAK_EFFECTIVE_AT && (weekend || isChinesePublicHoliday(nowMs))) return 'offpeak';
  const m = beijingMinutes(nowMs);
  return (m >= 9 * 60 && m < 12 * 60) || (m >= 14 * 60 && m < 18 * 60) ? 'peak' : 'offpeak';
}


// ---------- 内置价目表：唯一来源；远程目录只做增量合并 ----------
// 只有官方已生效的价目才进 PRICING；预测性路由不得改变计费。
export const BUILTIN_PRICING = {
  // Ark official pricing, verified 2026-10-29: https://www.volcengine.com/docs/ark/model-pricing
  // Request completion time determines the Beijing workday period; storage charges excluded.
  'volcengine-ark:deepseek-v4-1-flash-economy-261017': {
    currency: 'CNY', mode: 'peak-valley',
    peak: { inputCacheHit: 0.032, inputCacheMiss: 1.6, output: 6.4 },
    offpeak: { inputCacheHit: 0.016, inputCacheMiss: 0.8, output: 3.2 },
  },
  'volcengine-ark:deepseek-v4-1-flash-261017': {
    currency: 'CNY', mode: 'peak-valley',
    peak: { inputCacheHit: 0.04, inputCacheMiss: 2, output: 8 },
    offpeak: { inputCacheHit: 0.02, inputCacheMiss: 1, output: 4 },
  },
  // DeepSeek 官方模型 & 价格页：deepseek-flash = DeepSeek-V4.1-Flash。
  // CNY/百万 tokens；工作日北京时间 09:00–12:00、14:00–18:00 为高峰，其余为空闲。
  'deepseek-flash': {
    currency: 'CNY', mode: 'peak-valley',
    peak:   { inputCacheHit: 0.04, inputCacheMiss: 2.0, output: 8.0 },
    offpeak:{ inputCacheHit: 0.02, inputCacheMiss: 1.0, output: 4.0 },
  },
  'deepseek-v4-flash': {
    currency: 'CNY', mode: 'peak-valley',
    peak:   { inputCacheHit: 0.04, inputCacheMiss: 2.0, output: 8.0 },
    offpeak:{ inputCacheHit: 0.02, inputCacheMiss: 1.0, output: 4.0 },
  },
  // 官方说明：此旧模型名仍暂时接受，但已下线，请求由 V4.1 Flash 提供服务并按 Flash 价格计费。
  'deepseek-v4-flash-vision-exp': {
    currency: 'CNY', mode: 'peak-valley',
    peak:   { inputCacheHit: 0.04, inputCacheMiss: 2.0, output: 8.0 },
    offpeak:{ inputCacheHit: 0.02, inputCacheMiss: 1.0, output: 4.0 },
  },
  'deepseek-v4-pro': {
    currency: 'CNY', mode: 'peak-valley',
    peak:   { inputCacheHit: 0.30, inputCacheMiss: 9.0, output: 27.0 },
    offpeak:{ inputCacheHit: 0.15, inputCacheMiss: 4.5, output: 13.5 },
  },
  'deepseek-chat': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.5, inputCacheMiss: 2.0, output: 8.0 } },
  'gpt-4o':        { currency: 'USD', mode: 'flat', price: { inputCacheHit: 1.25, inputCacheMiss: 2.5, output: 10.0 } },
  'gpt-4o-mini':   { currency: 'USD', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.15, output: 0.6 } },
  // ---------- 智谱 BigModel 官方按量价（CNY/百万 tokens；来源 open.bigmodel.cn/pricing，
  // 采集记录与全档分段备注见 docs/research/bigmodel-pricing-202608.md）----------
  // 分段模型主条目取基础档（输入≤32K 等），长上下文档暂不计入——影响与限制见体系审计报告。
  'glm-5.3':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2,    inputCacheMiss: 8,   output: 28 } },
  // flash 存在"5折限时两周"双价：内置表取刊例价 0.8/0.23/2.8（保守）；
  // 远程目录按用户当前实扣配促销价（活动窗口约至 2026-09 初，详见 catalog/pricing.json notes）
  'glm-5.3-flash': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.23, inputCacheMiss: 0.8, output: 2.8 } },
  'glm-5.2':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2,    inputCacheMiss: 8,   output: 28 } },
  'glm-5.1':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.3,  inputCacheMiss: 6,   output: 24 } },
  'glm-5-turbo':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.2,  inputCacheMiss: 5,   output: 22 } },
  'glm-5v-turbo':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.2,  inputCacheMiss: 5,   output: 22 } },
  'glm-4.7':       { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.4,  inputCacheMiss: 2,   output: 8 } },
  'glm-4.5-air':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.16, inputCacheMiss: 0.8, output: 2 } },
  // ---------- 小米 MiMo 按量官方价（mimo.mi.com/docs/zh-CN/price/pay-as-you-go，2026-08-06 调价后 CNY；
  // 本机 pi-ai 目录里的 cost 字段是 USD 数字——严禁混用，详见体系审计报告）----------
  'mimo-v2-flash':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.02,  inputCacheMiss: 1,   output: 2 } },
  'mimo-v2-omni':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.02,  inputCacheMiss: 1,   output: 2 } },
  'mimo-v2-pro':    { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.025, inputCacheMiss: 3,   output: 6 } },
  'mimo-v2.5':      { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.02,  inputCacheMiss: 1,   output: 2 } },
  'mimo-v2.5-pro':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.025, inputCacheMiss: 3,   output: 6 } },
  // mimo-v2.5-pro-ultraspeed：官方仅美元口径、人民币数未独立确认 → 按"不臆测"暂不收录
  // ---------- 阶跃 StepFun 在售文本模型（platform.stepfun.com 定价详情；step-1/2/3 系已于 2026-07 下线）----------
  'step-3.7-flash': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.27,  inputCacheMiss: 1.35, output: 8.1 } },
  'step-3.5-flash': { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.14,  inputCacheMiss: 0.7,  output: 2.1 } },
  // ---------- Kimi 国内站（provider=moonshotai-cn → api.moonshot.cn 计费 ¥）----------
  // 同型号在 api.moonshot.ai 国际站按 $ 另计：官方 USD 数字待采集后以 'moonshotai:kimi-*'
  // 作用域键收录；裸 kimi-* 键刻意留空，防止币种串档。
  'moonshotai-cn:kimi-k3':                 { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2,    inputCacheMiss: 20,   output: 100 } },
  'moonshotai-cn:kimi-k2.5':               { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.7,  inputCacheMiss: 4,    output: 21 } },
  'moonshotai-cn:kimi-k2.6':               { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.1,  inputCacheMiss: 6.5,  output: 27 } },
  'moonshotai-cn:kimi-k2.7-code':          { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 1.3,  inputCacheMiss: 6.5,  output: 27 } },
  'moonshotai-cn:kimi-k2.7-code-highspeed':{ currency: 'CNY', mode: 'flat', price: { inputCacheHit: 2.6,  inputCacheMiss: 13,   output: 54 } },
  'moonshotai-cn:kimi-k2-0711-preview':    { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.6,  output: 2.5 } },
  'moonshotai-cn:kimi-k2-0905-preview':    { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.6,  output: 2.5 } },
  'moonshotai-cn:kimi-k2-thinking':        { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 0.6,  output: 2.5 } },
  'moonshotai-cn:kimi-k2-thinking-turbo':  { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.15, inputCacheMiss: 1.15, output: 8 } },
  'moonshotai-cn:kimi-k2-turbo-preview':   { currency: 'CNY', mode: 'flat', price: { inputCacheHit: 0.6,  inputCacheMiss: 2.4,  output: 10 } },
};

// 每个调用方各持一份可变的价目副本：host 主线程用一份算金额，worker 用另一份做迁移/回填；
// 远程目录合并后由 host 把增量同步给 worker（见 ledger-client.setPricing）。
export function createAccounting() {
  const PRICING = Object.assign(Object.create(null), BUILTIN_PRICING)

  // ---------- 价目查询 ----------
  function modelCurrency(provider, model) {
    // 服务商作用域键优先：同名模型跨计费域时（Kimi 国内外），币种必须跟作用域走
    if (typeof provider !== 'string' || provider.trim().length === 0
        || typeof model !== 'string' || model.trim().length === 0) return null;
    const entry = pricingEntryFor(provider, model);
    if (entry && entry.currency) return entry.currency;
    if (Object.hasOwn(PROVIDER_DEFAULT_CURRENCY, provider)) return PROVIDER_DEFAULT_CURRENCY[provider];
    if (model && /^(gpt|o1|o3|claude|gemini|grok)/.test(model)) return 'USD';
    return 'CNY';
  }

  function pricingEntryFor(provider, model) {
    const scopedKey = provider + ':' + model;
    const scoped = Object.hasOwn(PRICING, scopedKey) ? PRICING[scopedKey] : null;
    return scoped && typeof scoped === 'object'
      ? scoped
      : (Object.hasOwn(PRICING, model) ? PRICING[model] : null);
  }

  // ---------- 花费计算 ----------
  function costOf(record, forceOffpeak) {
    // v2 ledger records carry the charge as observed.  Use it for normal
    // reporting; only the "all-offpeak" forecast intentionally recalculates.
    if (!forceOffpeak && Number.isFinite(record.cost) && record.cost >= 0) return record.cost;
    const entry = pricingEntryFor(record.provider, record.model);
    if (!entry) return null;
    let p;
    if (entry.mode === 'peak-valley') {
      p = forceOffpeak ? entry.offpeak : entry[currentPeriod(record.ts)];
    } else {
      p = entry.price;
    }
    const missInput = record.input + record.cacheWrite;
    const cost = (missInput * p.inputCacheMiss + record.cacheRead * p.inputCacheHit + record.output * p.output) / 1e6;
    // 结果非有限（任一字段 NaN/Infinity/缺失）→ null；调用方统一 `c != null` 判空即排除，NaN 不会累加进任何汇总
    return Number.isFinite(cost) ? cost : null;
  }

  // 远程目录增量合并：返回本次新增/更新的键数。只改本实例的 PRICING 副本。
  function setRemotePricingEntries(entries) {
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) return 0;
    let n = 0;
    for (const key of Object.keys(entries)) {
      PRICING[key] = entries[key];
      n++;
    }
    return n;
  }

  return {
    PRICING: PRICING,
    pricingEntryFor: pricingEntryFor,
    modelCurrency: modelCurrency,
    costOf: costOf,
    setRemotePricingEntries: setRemotePricingEntries,
  };
}
