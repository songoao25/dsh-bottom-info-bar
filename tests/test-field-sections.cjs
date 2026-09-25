// v1.19.6 设置页小节（section）守卫：让「插件信息」里 20 个字段按计费形态分出块来
//
// 背景：20 个插件字段分属三种**互斥**的计费形态，全平铺在一个列表里时用户分不清
//       「余额 / 本月用量 / 预算」什么时候会有数。小节只做阅读分组，用一句话说明
//       「什么时候属于这一块」。
//
// 三件事互不越界（这是本文件存在的全部理由）：
//   group    → 字段住在信息栏哪一行（native 原生行 / plugin 主行 / notice 主行右端）
//   section  → 字段列在设置页哪一小节（**只影响阅读顺序**）
//   开关     → 字段显不显示（唯一裁判）
// 因此本文件同时钉死「不会丢行」与「不会拿 section 当显隐条件」两条：
//   - 渲染级真跑 bibSetFieldBlocks：输出必须是输入的一个**完整划分**（20 进 → 20 出，无重复无遗漏），
//     认不出的 section 落到兜底块而不是消失；
//   - 源码级断言宿主与小节零耦合（host.js 里根本不出现 section）。
//
// 用法：node tests/test-field-sections.cjs
const fs = require('fs');
const { t, dictionaries } = require('./locale-fixture.cjs');
const {
  FIELD_REGISTRY, FIELD_SECTIONS, FIELD_GROUP_ORDER, FIELD_GROUP_LABELS,
} = require('../src/constants.js');

const clientSrc = fs.readFileSync(__dirname + '/../src/client-bundle.js', 'utf8');
const buildSrc = fs.readFileSync(__dirname + '/../scripts/build.mjs', 'utf8');
const hostSrc = fs.readFileSync(__dirname + '/../src/host.js', 'utf8');
const libSrc = fs.readFileSync(__dirname + '/../lib/client.js', 'utf8');

let pass = 0, fail = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (ok) { pass++; console.log('PASS  ' + label); }
  else { fail++; console.log('FAIL  ' + label + ' → 期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual)); }
}

const pluginFields = FIELD_REGISTRY.filter((f) => f.group === 'plugin');
const sectionIds = FIELD_SECTIONS.map((s) => s.id);
const idsInSection = (id) => pluginFields.filter((f) => f.section === id).map((f) => f.id);
// 设置页里插件组的实际行序 = 按小节顺序重排后的注册表（这也是用户看到「一块一块」的由来）。
// 与注册表原始声明序不同：注册表为了让代码可读，把通用项排在中间；设置页要把通用项收到最后。
const settingsOrder = FIELD_SECTIONS.reduce((acc, s) => acc.concat(idsInSection(s.id)), []);

// ---------- ① 结构：五块、顺序固定、字段各归其位 ----------
check('小节恰 5 块且顺序固定（服务商与模型 → 余额制 → 订阅制 → 账单制 → 通用）',
  JSON.stringify(sectionIds) === JSON.stringify(['identity', 'balance', 'subscription', 'billing', 'common']), true);
check('每块都带 id/label/desc，id 唯一且非空',
  FIELD_SECTIONS.every((s) => typeof s.id === 'string' && s.id.length > 0
    && typeof s.label === 'string' && s.label.length > 0
    && typeof s.desc === 'string' && s.desc.length > 0)
  && new Set(sectionIds).size === FIELD_SECTIONS.length, true);
// 漏标一个字段的后果很隐蔽：那一行会掉进兜底块，排到最后，看起来像「多了个没有标题的行」。
check('每个插件字段必须且只能落在一个已知小节里（漏标 / 错标即失败）',
  pluginFields.length === 20
  && pluginFields.every((f) => sectionIds.includes(f.section)), true);
check('原生组与提醒组不设小节（它们本来就只有一块，多一层标题只是噪音）',
  FIELD_REGISTRY.filter((f) => f.group !== 'plugin').every((f) => f.section === undefined), true);
check('没有空小节（声明了却一个字段都没有 = 用户看到孤零零的标题）',
  FIELD_SECTIONS.every((s) => idsInSection(s.id).length > 0), true);
// 信息栏默认展示的内容顺序必须与设置页小块的内存顺序一致：都能一眼看出「谁和谁是一伙的」。
check('归属正确：身份锚点各就各位（通用锚点 / 订阅锚点 / 账单锚点）',
  FIELD_REGISTRY.find((f) => f.id === 'anchorGroup').section === 'identity'
  && FIELD_REGISTRY.find((f) => f.id === 'subServiceGroup').section === 'identity'
  && FIELD_REGISTRY.find((f) => f.id === 'billingServiceGroup').section === 'identity', true);
check('归属正确：余额 4 项 / 订阅 6 项 / 账单 3 项 / 通用 4 项',
  idsInSection('balance').join(',') === 'sessionCost,balance,period,countdown'
  && idsInSection('subscription').join(',') === 'expiry,subWindow5h,subWindowWeek,subWindowMonth,resetCountdown,subBalance'
  && idsInSection('billing').join(',') === 'billingSpend,budget,freeQuota'
  && idsInSection('common').join(',') === 'customText,mainTime,worldTime,contextUsage', true);
// 最容易搞错的两个跨形态字段：订阅的「可用余额或剩余额度」不是余额制的「余额」；
// 余额制的「本次会话花费」虽然订阅 · 充值余额形态也会用，但它属于余额口径。
check('归属正确：subBalance 归订阅、balance 归余额（两个名字像、形态不同）',
  FIELD_REGISTRY.find((f) => f.id === 'subBalance').section === 'subscription'
  && FIELD_REGISTRY.find((f) => f.id === 'balance').section === 'balance', true);

// ---------- ② 文案：中英成对、真的翻译过、标题不重复 ----------
{
  const missingSec = [];
  const sameSec = [];
  for (const section of FIELD_SECTIONS) {
    for (const key of [section.label, section.desc]) {
      for (const lang of ['zh', 'en']) {
        if (typeof dictionaries[lang][key] !== 'string' || dictionaries[lang][key].trim() === '') missingSec.push(lang + ':' + key);
      }
      if (dictionaries.zh[key] === dictionaries.en[key]) sameSec.push(key);
    }
  }
  check('每块的中英标题与说明都在字典里（漏键会把键名当文案显示给用户）', missingSec.join(',') === '', true);
  check('每块的中英文案真的翻译过（不是同一串字）', sameSec.join(',') === '', true);
  const labels = FIELD_SECTIONS.map((s) => t(s.label));
  check('五个小节标题互不重复，也不与三个分组标题撞名',
    new Set(labels).size === labels.length
    && labels.every((label) => !Object.values(FIELD_GROUP_LABELS).map((k) => t(k)).includes(label)), true);
  // 说明句必须回答「什么时候属于这一块」，否则分成块也没解决用户的疑问。
  check('每块说明都点出「只有这些项有数据」或「与计费方式无关」的口径',
    FIELD_SECTIONS.filter((s) => s.id !== 'identity')
      .every((s) => /只有/.test(t(s.desc)) || /无关/.test(t(s.desc))), true);
}

// ---------- ③ 接线：构建注入 / 渲染入口 / 样式 ----------
check('客户端源码保留构建注入锚点', clientSrc.includes('const FIELD_SECTIONS = /*__FIELD_SECTIONS__*/[];'), true);
check('构建脚本从 constants.js 提取并注入 FIELD_SECTIONS',
  buildSrc.includes("extractLiteral('FIELD_SECTIONS')")
  && buildSrc.includes('.replace(/\\/\\*__FIELD_SECTIONS__\\*\\/\\[\\]/g, fieldSectionsJson)'), true);
check('「插件信息」组经统一入口渲染小节（分组 → 小节 → 行，只有一条路径）',
  /function bibSetFieldGroups\(props\) \{[\s\S]*?bibSetFieldBlocks\(visibleFields, props\)/.test(clientSrc)
  && clientSrc.split('function bibSetFieldBlocks(visibleFields, props)').length === 2, true);
check('小节样式齐备（块 / 分隔线 / 标题 / 说明，且复用既有排版令牌）',
  clientSrc.includes('.bib-set-subsection { display: flex; flex-direction: column; gap: 0; min-width: 0; }')
  && clientSrc.includes('.bib-set-subsection + .bib-set-subsection { border-top: var(--bib-rule); }')
  && clientSrc.includes('.bib-set-subsection-head { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 12px 0 0; }')
  && clientSrc.includes('.bib-set-subsection-label { display: block; min-width: 0; font-size: 13px; font-weight: 600; line-height: 20px; color: var(--dsw-alias-label-primary); }')
  && clientSrc.includes('.bib-set-subsection-desc { display: block; min-width: 0; font-size: var(--bib-field-hint-size); font-weight: 400; line-height: var(--bib-field-hint-line); color: var(--dsw-alias-label-tertiary); }'), true);
// 小节是纯阅读分组：宿主（校验字段白名单 / 记账 / 渲染信息栏）不该知道小节的任何事。
check('宿主与小节零耦合（host.js 里根本不出现 section）', hostSrc.includes('section'), false);
check('信息栏渲染层不拿 section 当显隐条件（开关是唯一裁判）',
  !/fieldVisible\([^)]*section/.test(clientSrc) && !/section\s*&&\s*fieldVisible/.test(clientSrc), true);

// ---------- ④ 渲染级：真跑 bibSetFieldBlocks（桩 React + 真注册表 + 真字典） ----------
function extractFunctionFrom(source, name) {
  const start = source.indexOf('function ' + name);
  if (start < 0) throw new Error('未找到 function ' + name);
  let depth = 0, i = start, inStr = null;
  while (i < source.length) {
    const c = source[i];
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === inStr) inStr = null;
    } else if (c === '"' || c === "'" || c === '`') {
      inStr = c;
    } else if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
    i++;
  }
  return source.slice(start, i + 1);
}
function textOf(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node.children) return node.children.map(textOf).join('');
  return '';
}
function rowIdsOf(blocks) {
  const out = [];
  // 注意：createElement 的子节点里嵌着数组（rowsOf 返回数组），递归必须同时下钻数组与元素。
  const walk = function (nodes) {
    if (Array.isArray(nodes)) { nodes.forEach(walk); return; }
    if (!nodes || typeof nodes !== 'object') return;
    if (nodes.type === 'row') out.push(nodes.props['data-id']);
    if (nodes.children) walk(nodes.children);
  };
  walk(blocks);
  return out;
}
const bibSetFieldBlocks = (function () {
  const createElement = function (type, props) {
    return { type: type, props: props || {}, children: Array.prototype.slice.call(arguments, 2) };
  };
  const stubRow = function (field) { return { type: 'row', props: { 'data-id': field.id } }; };
  const factory = new Function(
    'React', 't', 'FIELD_SECTIONS', 'bibSetFieldRow',
    'return (' + extractFunctionFrom(clientSrc, 'bibSetFieldBlocks') + ');');
  return factory({ createElement: createElement }, t, FIELD_SECTIONS, stubRow);
})();

{
  const blocks = bibSetFieldBlocks(pluginFields, {});
  check('渲染级：20 个插件字段 → 5 个小节块（无兜底块）',
    blocks.length === 5
    && blocks.map((b) => b.props.key).join(',') === 's-identity,s-balance,s-subscription,s-billing,s-common', true);
  check('渲染级：输出是输入的完整划分（20 进 20 出，无重复无遗漏，行序 = 小节顺序）',
    rowIdsOf(blocks).join(',') === settingsOrder.join(',')
    && new Set(rowIdsOf(blocks)).size === pluginFields.length, true);
  check('渲染级：每块第一层是标题（标题原文 + 说明原文），行在标题之后',
    blocks.every((b, i) => b.type === 'div' && b.children.length === 2
      && textOf(b.children[0]).indexOf(t(FIELD_SECTIONS[i].label)) === 0
      && textOf(b.children[0]).indexOf(t(FIELD_SECTIONS[i].desc)) > 0
      && b.children[1].length === idsInSection(FIELD_SECTIONS[i].id).length), true);
  check('渲染级：小节块只挂阅读分组类名，不额外注入任何属性',
    blocks.every((b) => b.props.className === 'bib-set-subsection'
      && Object.keys(b.props).sort().join(',') === 'className,key'), true);
  // 认不出的 section 由守卫测试在 CI 拦下；但渲染层不能因此丢掉整行（用户会以为字段没了）。
  const withUnknown = pluginFields.map((f) => (f.id === 'balance' ? Object.assign({}, f, { section: 'nope' }) : f));
  const orphaned = bibSetFieldBlocks(withUnknown, {});
  const orphanExpected = settingsOrder.filter((id) => id !== 'balance').concat('balance');
  check('渲染级：认不出的 section 落到兜底块（照样渲染，绝不静默丢行）',
    orphaned.length === 6
    && orphaned[5].props.key === 's-orphan'
    && rowIdsOf(orphaned).join(',') === orphanExpected.join(','), true);
  check('渲染级：没声明 section 的组原样返回（原生 / 提醒组一个字节都不用改）',
    bibSetFieldBlocks(FIELD_REGISTRY.filter((f) => f.group === 'native'), {}).every((n) => n.type === 'row'), true);
  check('渲染级：搜索过滤后只出现命中的小节，且不出现空块',
    bibSetFieldBlocks(pluginFields.filter((f) => f.section === 'billing'), {}).length === 1
    && bibSetFieldBlocks([], {}).length === 0, true);
}

// ---------- ⑤ 入库产物一致（lib/ 是构建产物，必须已重建） ----------
check('lib/client.js 已重建：含注入后的小节常量与小节渲染入口（CI 另有一致性检查）',
  libSrc.includes('dsh-bottom-info-bar')
  && libSrc.includes('bib-set-subsection')
  && libSrc.indexOf('/*__FIELD_SECTIONS__*/[]') === -1
  && libSrc.includes('section.identity.label'), true);

console.log('\n结果：' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail > 0 ? 1 : 0);
