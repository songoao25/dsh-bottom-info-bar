// Bottom Info Bar（底部信息栏插件）— client 设置页扩展（与 client-bundle.js 同一 bundle 作用域拼接）
// v1.9.0 PR2：注册 DSH 设置面板 settings.section 插座，新增「信息底栏」设置页。
// 设计规范：苹果 HIG（设置型界面改动即时生效）+ 融入 DSH 设置面板既有视觉（--dsw-alias-* 令牌、
// 卡片圆角 12px、行标题 14px/说明 12px），全程键盘可达（roving tabindex 方向键）、
// role=switch/radio + aria-checked、:focus-visible 焦点环、prefers-reduced-motion 降级。
// 约定：本文件与 client-bundle.js 拼接进同一个 __ModuleLoader__ factory 作用域，
// 顶层标识符一律 bibSet* / InfoBarSettings* 前缀，绝不与主包重名（React/rpc/FIELD_REGISTRY 等直接复用主包声明）。
'use strict';

const BIB_SET_EVENT = 'dsh-bib-config-changed';
const BIB_SET_PRESET_LABELS = { red: '红', green: '绿', blue: '蓝', purple: '紫', orange: '橙', neutral: '中性' };
// 原生取色器（input[type=color]）在未自定义时显示的代表色（浅色主题值；实际信息栏渲染仍按主题变量）
const BIB_SET_PRESET_WELL_HEX = { red: '#D92D20', green: '#087F5B', blue: '#0044CC', purple: '#6941C6', orange: '#B54708', neutral: '#333333' };
const BIB_SET_HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

function bibSetDispatchChanged() {
  // 设置页保存成功后广播：信息栏监听并立即重拉配置（宿主内存缓存，即回）
  try { document.dispatchEvent(new CustomEvent(BIB_SET_EVENT)); } catch (err) { /* 事件总线不可用时静默：30s 周期校准兜底 */ }
}

function bibSetOperationMessage(err) {
  return String((err && err.message) || err || '请稍后再试');
}

// ---------- 设置页样式（融入 DSH 设置面板：卡片/行布局/控件全部走 --dsw-alias-* 令牌） ----------
function bibSetInstallStyles() {
  const id = 'dsh-bottom-info-bar-settings';
  const existing = document.querySelector('style[data-plugin-css="' + id + '"]');
  if (existing !== null) return function () {};
  const style = document.createElement('style');
  style.dataset.plugin = 'dsh-bottom-info-bar';
  style.dataset.pluginCss = id;
  style.textContent = `
      .bib-set-root { --bib-set-brand: var(--dsw-alias-brand-primary, #4d6bfe); }
      .bib-settings { max-width: 720px; box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; color: var(--dsw-alias-label-primary); }
      .bib-set-intro { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
      .bib-set-status { margin: 0; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
      .bib-set-card { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3); border-radius: 12px; }
      .bib-set-card-header { display: flex; flex-direction: column; gap: 4px; padding: 14px 16px; }
      .bib-set-card-title { font-size: 15px; font-weight: 600; line-height: 1.4; color: var(--dsw-alias-label-primary); }
      .bib-set-card-desc { font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
      .bib-set-body { border-top: 1px solid var(--dsw-alias-border-l2); margin: 0 16px; padding: 0 0 6px; }
      .bib-set-group-title { margin: 12px 0 2px; font-size: 12px; font-weight: 500; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      .bib-set-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 0; border-bottom: 1px solid var(--dsw-alias-border-l2); }
      .bib-set-row:last-child { border-bottom: none; }
      .bib-set-rowText { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 200px; }
      .bib-set-rowTitle { display: flex; align-items: center; gap: 6px; font-size: 14px; line-height: 22px; color: var(--dsw-alias-label-primary); }
      .bib-set-keep { flex: none; padding: 0 6px; border-radius: 999px; background: var(--dsw-alias-fill-tsp-secondary, rgba(128,128,128,0.12)); color: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; line-height: 16px; }
      .bib-set-rowDesc { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      /* 开关：iOS 原生质感（40×24 轨道 + 18px 圆钮），语义 = role:switch + aria-checked */
      .bib-set-switch { appearance: none; background: 0 0; border: 0; padding: 0; margin: 0; cursor: pointer; display: inline-flex; flex: none; border-radius: 12px; }
      .bib-set-switch:disabled { cursor: default; opacity: 0.5; }
      .bib-set-switch:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-switch-track { position: relative; display: inline-block; box-sizing: border-box; width: 40px; height: 24px; border-radius: 12px; background: var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); transition: background-color 160ms var(--ds-ease-in-out, ease); }
      .bib-set-switch-track[data-on="true"] { background: var(--bib-set-brand); }
      .bib-set-switch-thumb { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: var(--dsw-alias-bg-layer-1, #fff); box-shadow: 0 1px 2px rgba(0,0,0,0.2); transition: transform 160ms var(--ds-ease-in-out, ease); }
      .bib-set-switch-track[data-on="true"] .bib-set-switch-thumb { transform: translateX(16px); }
      /* 色板圆点：role:radio + roving tabindex（方向键/Home/End 可达），选中态外圈描边 */
      .bib-set-controls { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; flex: 0 0 auto; }
      .bib-set-dots { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .bib-set-dot { appearance: none; width: 20px; height: 20px; padding: 0; margin: 0; border-radius: 50%; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); background: transparent; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
      .bib-set-dot:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-dot[aria-checked="true"] { box-shadow: 0 0 0 2px var(--dsw-alias-bg-layer-3, #fff), 0 0 0 4px var(--bib-set-brand); }
      .bib-set-dot-core { display: block; width: 14px; height: 14px; border-radius: 50%; }
      .bib-set-dot-default .bib-set-dot-core { background: transparent; border: 1.5px dashed var(--dsw-alias-label-quaternary, rgba(128,128,128,0.5)); }
      /* 原生取色器色井：保留系统行为，仅样式化为圆角色井 */
      .bib-set-well { display: inline-flex; flex: none; }
      .bib-set-well input[type="color"] { appearance: none; -webkit-appearance: none; box-sizing: border-box; width: 30px; height: 26px; padding: 2px; border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); border-radius: 8px; background: var(--dsw-alias-bg-layer-2, transparent); cursor: pointer; }
      .bib-set-well input[type="color"]::-webkit-color-swatch-wrapper { padding: 2px; }
      .bib-set-well input[type="color"]::-webkit-color-swatch { border: none; border-radius: 5px; }
      .bib-set-well input[type="color"]::-moz-color-swatch { border: none; border-radius: 5px; }
      .bib-set-well input[type="color"]:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      /* hex 输入：等宽字体、即时校验（非法描红 + aria-invalid），Enter/失焦提交，非法回退 */
      .bib-set-hex { box-sizing: border-box; width: 88px; padding: 4px 8px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2, transparent); border: 1px solid var(--dsw-alias-border-l2, rgba(128,128,128,0.4)); border-radius: 8px; }
      .bib-set-hex:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 1px; }
      .bib-set-hex[data-invalid="true"] { border-color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); }
      .bib-set-footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; padding: 2px 0 10px; }
      .bib-set-btn { appearance: none; font: inherit; cursor: pointer; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); background: 0 0; border-radius: 8px; padding: 5px 14px; font-size: 13px; line-height: 1.5; }
      .bib-set-btn:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(128,128,128,0.08)); }
      .bib-set-btn:focus-visible { outline: 2px solid var(--bib-set-brand); outline-offset: 2px; }
      .bib-set-btn:disabled { opacity: 0.5; cursor: default; }
      .bib-set-alert { margin: 0; color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error, #d92d20)); font-size: 12px; line-height: 18px; flex: 1 1 auto; min-width: 0; }
      .bib-set-notice { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; flex: 1 1 auto; min-width: 0; }
      @media (prefers-reduced-motion: reduce) { .bib-set-switch-track, .bib-set-switch-thumb { transition: none; } }
    `;
  document.head.appendChild(style);
  return function () { style.remove(); };
}

// ---------- 控件 ----------
function bibSetSwitch(props) {
  const checked = !!props.checked;
  return React.createElement('button', {
    type: 'button',
    className: 'bib-set-switch',
    role: 'switch',
    'aria-checked': checked,
    'aria-label': props.label,
    disabled: props.disabled === true,
    title: props.title,
    onClick: function () { if (props.onToggle) props.onToggle(!checked); },
  },
  React.createElement('span', { className: 'bib-set-switch-track', 'data-on': checked ? 'true' : 'false', 'aria-hidden': 'true' },
    React.createElement('span', { className: 'bib-set-switch-thumb' })));
}

// 色板圆点组：默认 + 预设色名；role=radiogroup/radio + roving tabindex（方向键/Home/End）
function bibSetPalette(props) {
  const options = ['default'].concat(PRESET_COLORS);
  const refs = React.useRef({});
  const isSelected = function (option) {
    return option === 'default' ? props.value === null : props.value === option;
  };
  const select = function (option) {
    if (props.onSelect) props.onSelect(option === 'default' ? null : option);
  };
  const move = function (from, step) {
    const next = (from + step + options.length) % options.length;
    const node = refs.current[next];
    if (node && typeof node.focus === 'function') node.focus();
    select(options[next]);
  };
  const onKey = function (event, index) {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); move(index, 1); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') { event.preventDefault(); move(index, -1); }
    else if (event.key === 'Home') { event.preventDefault(); move(index, -index); }
    else if (event.key === 'End') { event.preventDefault(); move(index, options.length - 1 - index); }
  };
  const children = options.map(function (option, index) {
    const selected = isSelected(option);
    const isDefault = option === 'default';
    const coreStyle = {};
    if (!isDefault) coreStyle.background = 'var(--bi-palette-' + option + ')';
    const ariaLabel = isDefault ? '恢复默认颜色' : (BIB_SET_PRESET_LABELS[option] || option);
    return React.createElement('button', {
      key: option,
      type: 'button',
      ref: function (node) { refs.current[index] = node; },
      className: 'bib-set-dot' + (isDefault ? ' bib-set-dot-default' : ''),
      role: 'radio',
      'aria-checked': selected,
      'aria-label': ariaLabel,
      title: ariaLabel,
      tabIndex: selected ? 0 : -1,
      onClick: function () { select(option); },
      onKeyDown: function (event) { onKey(event, index); },
    }, React.createElement('span', { className: 'bib-set-dot-core', style: coreStyle, 'aria-hidden': 'true' }));
  });
  return React.createElement('span', { className: 'bib-set-dots', role: 'radiogroup', 'aria-label': props.label }, children);
}

// ---------- 页面组件 ----------
function InfoBarSettingsSection(props) {
  void props; // 与官方 section 组件同签名（外壳会传入 renderSlot/close 等，本页不使用）
  const [snapshot, setSnapshot] = React.useState(null); // { fields, colors, configVersion }
  const [status, setStatus] = React.useState('loading');
  const [loadError, setLoadError] = React.useState(null);
  const [opError, setOpError] = React.useState(null);
  const [notice, setNotice] = React.useState(null);
  const [saving, setSaving] = React.useState(false);
  const [hexDrafts, setHexDrafts] = React.useState({});
  const opSeqRef = React.useRef(0); // 版本号守卫：慢响应绝不覆盖更新的操作
  const savingCountRef = React.useRef(0);

  React.useEffect(function () {
    let active = true;
    rpc('getFieldConfig').then(function (cfg) {
      if (!active) return;
      if (cfg && typeof cfg === 'object' && cfg.fields) {
        setSnapshot({ fields: cfg.fields, colors: cfg.colors || {}, configVersion: cfg.configVersion || 0 });
        setStatus('ready');
      } else {
        setLoadError('配置暂时无法读取'); setStatus('error');
      }
    }).catch(function (err) {
      if (!active) return;
      setLoadError(bibSetOperationMessage(err)); setStatus('error');
    });
    return function () { active = false; };
  }, []);

  const beginOp = React.useCallback(function () {
    savingCountRef.current += 1;
    setSaving(true);
  }, []);
  const endOp = React.useCallback(function () {
    savingCountRef.current = Math.max(0, savingCountRef.current - 1);
    if (savingCountRef.current === 0) setSaving(false);
  }, []);

  if (status === 'loading') {
    return React.createElement('div', { className: 'bib-set-root bib-settings' },
      React.createElement('p', { className: 'bib-set-status' }, '正在载入信息底栏设置…'));
  }
  if (status === 'error') {
    return React.createElement('div', { className: 'bib-set-root bib-settings' },
      React.createElement('p', { className: 'bib-set-alert', role: 'alert' }, '信息底栏设置暂时无法读取：' + (loadError || '请稍后再试')));
  }

  const fieldsById = {};
  for (let i = 0; i < FIELD_REGISTRY.length; i++) fieldsById[FIELD_REGISTRY[i].id] = FIELD_REGISTRY[i];
  function fieldOn(id) { return snapshot.fields[id] !== false; }
  function colorOf(id) {
    const value = snapshot.colors[id];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
  function labelOf(id) { const f = fieldsById[id]; return f ? f.label : id; }
  function makePair(key, value) { const pair = {}; pair[key] = value; return pair; }

  // 服务端快照回写（configVersion 一并更新；persisted=false 时如实提示落盘失败）
  function applyServerResult(res) {
    if (!res || typeof res !== 'object') return;
    setSnapshot(function (prev) {
      return {
        fields: res.fields || (prev && prev.fields) || {},
        colors: res.colors || (prev && prev.colors) || {},
        configVersion: typeof res.configVersion === 'number' ? res.configVersion : ((prev && prev.configVersion) || 0),
      };
    });
    if (res.persisted === false) setNotice('改动已生效，但写入本地配置文件失败：' + (res.warning || '未知原因'));
  }

  // 乐观更新 + 失败回退（参照 density toggle）+ 版本号守卫
  function commit(patch, applyOptimistic, revertOptimistic, errorPrefix) {
    setOpError(null);
    setNotice(null);
    const seq = ++opSeqRef.current;
    applyOptimistic();
    beginOp();
    rpc('setFieldConfig', patch).then(function (res) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      applyServerResult(res);
      bibSetDispatchChanged();
    }).catch(function (err) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      revertOptimistic();
      setOpError(errorPrefix + '保存失败：' + bibSetOperationMessage(err));
    });
  }

  function setFieldFlag(id, next) {
    const previous = fieldOn(id);
    if (previous === next) return;
    commit({ fields: makePair(id, next) },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { fields: Object.assign({}, s.fields, makePair(id, next)) }); }); },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { fields: Object.assign({}, s.fields, makePair(id, previous)) }); }); },
      '「' + labelOf(id) + '」');
  }

  function setColor(id, next) {
    const previous = colorOf(id);
    if (previous === next) {
      setHexDrafts(function (drafts) { return Object.assign({}, drafts, makePair(id, undefined)); });
      return;
    }
    commit({ colors: makePair(id, next) },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { colors: Object.assign({}, s.colors, makePair(id, next)) }); }); },
      function () { setSnapshot(function (s) { return Object.assign({}, s, { colors: Object.assign({}, s.colors, makePair(id, previous)) }); }); },
      '「' + labelOf(id) + '」颜色');
  }

  // hex 输入：输入中仅标记非法（描红 + aria-invalid）；Enter/失焦时合法才提交，非法回退当前值
  function hexDraftOf(id) {
    const draft = hexDrafts[id];
    return typeof draft === 'string' ? draft : null;
  }
  function committedHexText(id) {
    const value = colorOf(id);
    if (value === null) return '';
    return PRESET_COLOR_SET.has(value) ? value.toUpperCase() : value;
  }
  function onHexChange(id, raw) {
    setHexDrafts(function (drafts) { return Object.assign({}, drafts, makePair(id, raw)); });
  }
  function commitHex(id) {
    const draft = hexDraftOf(id);
    if (draft === null) return;
    const value = draft.trim();
    setHexDrafts(function (drafts) { return Object.assign({}, drafts, makePair(id, undefined)); });
    if (value.length === 0) return;
    if (!BIB_SET_HEX_PATTERN.test(value)) {
      setOpError('「' + labelOf(id) + '」颜色格式无效：请输入 #RRGGBB（例如 #0044CC）');
      return;
    }
    setColor(id, value.toUpperCase());
  }

  function runReset(kind) {
    setOpError(null);
    setNotice(null);
    const seq = ++opSeqRef.current;
    beginOp();
    rpc(kind === 'colors' ? 'resetFieldColors' : 'resetFieldConfig').then(function (res) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      applyServerResult(res);
      bibSetDispatchChanged();
      setNotice(kind === 'colors' ? '已恢复默认颜色' : '已恢复默认标签');
    }).catch(function (err) {
      if (seq !== opSeqRef.current) { endOp(); return; }
      endOp();
      setOpError('重置失败：' + bibSetOperationMessage(err));
    });
  }

  // ---- 渲染 ----
  const groupsChildren = [];
  for (let g = 0; g < FIELD_GROUP_ORDER.length; g++) {
    const group = FIELD_GROUP_ORDER[g];
    const groupFields = FIELD_REGISTRY.filter(function (f) { return f.group === group; });
    if (groupFields.length === 0) continue;
    const rows = [];
    for (let i = 0; i < groupFields.length; i++) {
      const field = groupFields[i];
      const isAnchor = field.anchor === true;
      const descParts = [];
      if (isAnchor) descParts.push('身份锚点，始终显示。');
      if (field.note) descParts.push(field.note);
      if (field.suggestKeep) descParts.push('关闭后相应提示不再出现，建议保留。');
      rows.push(React.createElement('div', { key: field.id, className: 'bib-set-row' },
        React.createElement('div', { className: 'bib-set-rowText' },
          React.createElement('div', { className: 'bib-set-rowTitle' },
            field.label,
            field.suggestKeep ? React.createElement('span', { className: 'bib-set-keep' }, '建议保留') : null),
          React.createElement('div', { className: 'bib-set-rowDesc' }, descParts.join(''))),
        bibSetSwitch({
          label: '显示' + field.label,
          checked: fieldOn(field.id),
          disabled: isAnchor, // 身份锚点：默认恒开（宿主同样拒绝关闭）
          title: isAnchor ? '身份锚点始终显示' : (fieldOn(field.id) ? '点击隐藏' : '点击显示'),
          onToggle: function (next) { setFieldFlag(field.id, next); },
        })));
    }
    groupsChildren.push(React.createElement('div', { key: 'g-' + group },
      React.createElement('div', { className: 'bib-set-group-title' }, FIELD_GROUP_LABELS[group] || group),
      rows));
  }

  const colorChildren = [];
  for (let g = 0; g < FIELD_GROUP_ORDER.length; g++) {
    const group = FIELD_GROUP_ORDER[g];
    const groupFields = FIELD_REGISTRY.filter(function (f) { return f.group === group; });
    if (groupFields.length === 0) continue;
    const rows = [];
    for (let i = 0; i < groupFields.length; i++) {
      const field = groupFields[i];
      const value = colorOf(field.id);
      const isPreset = value !== null && PRESET_COLOR_SET.has(value);
      const isHex = value !== null && !isPreset;
      const draft = hexDraftOf(field.id);
      const hexValue = draft !== null ? draft : committedHexText(field.id);
      const hexInvalid = draft !== null && draft.trim().length > 0 && !BIB_SET_HEX_PATTERN.test(draft.trim());
      const wellValue = isHex ? value : (isPreset ? (BIB_SET_PRESET_WELL_HEX[value] || '#333333') : '#333333');
      const valueText = value === null ? '默认'
        : (isPreset ? (BIB_SET_PRESET_LABELS[value] || value) : value.toUpperCase());
      rows.push(React.createElement('div', { key: field.id, className: 'bib-set-row' },
        React.createElement('div', { className: 'bib-set-rowText' },
          React.createElement('div', { className: 'bib-set-rowTitle' }, field.label),
          React.createElement('div', { className: 'bib-set-rowDesc' }, '当前：' + valueText + (field.anchor === true ? '（身份锚点）' : ''))),
        React.createElement('div', { className: 'bib-set-controls' },
          bibSetPalette({
            label: field.label + '的预设颜色',
            value: value,
            onSelect: function (next) { setColor(field.id, next); },
          }),
          React.createElement('label', { className: 'bib-set-well' },
            React.createElement('input', {
              type: 'color',
              'aria-label': field.label + '的自定义颜色',
              title: '自定义颜色（打开系统取色器）',
              value: wellValue,
              onChange: function (event) {
                const picked = event && event.target ? event.target.value : null;
                if (picked && BIB_SET_HEX_PATTERN.test(picked)) setColor(field.id, picked.toUpperCase());
              },
            })),
          React.createElement('input', {
            type: 'text',
            className: 'bib-set-hex',
            'aria-label': field.label + '的十六进制颜色',
            'aria-invalid': hexInvalid ? 'true' : 'false',
            'data-invalid': hexInvalid ? 'true' : 'false',
            placeholder: '#RRGGBB',
            spellCheck: false,
            maxLength: 7,
            value: hexValue,
            onChange: function (event) { onHexChange(field.id, event && event.target ? event.target.value : ''); },
            onBlur: function () { commitHex(field.id); },
            onKeyDown: function (event) { if (event.key === 'Enter') { event.preventDefault(); commitHex(field.id); } },
          }))));
    }
    colorChildren.push(React.createElement('div', { key: 'c-' + group },
      React.createElement('div', { className: 'bib-set-group-title' }, FIELD_GROUP_LABELS[group] || group),
      rows));
  }

  const feedback = [];
  if (opError) feedback.push(React.createElement('p', { key: 'err', className: 'bib-set-alert', role: 'alert' }, opError));
  else if (notice) feedback.push(React.createElement('p', { key: 'notice', className: 'bib-set-notice', role: 'status' }, notice));
  else if (saving) feedback.push(React.createElement('p', { key: 'saving', className: 'bib-set-notice', 'aria-live': 'polite' }, '正在保存…'));

  return React.createElement('div', { className: 'bib-set-root bib-settings' },
    React.createElement('p', { className: 'bib-set-intro' },
      '选择信息底栏显示哪些信息、为每个信息挑一个颜色。改动即时生效并自动保存，重启后仍然保留；隐藏信息不会删除任何记账数据。'),
    React.createElement('section', { className: 'bib-set-card', 'aria-labelledby': 'bib-set-fields-title' },
      React.createElement('div', { className: 'bib-set-card-header' },
        React.createElement('h2', { id: 'bib-set-fields-title', className: 'bib-set-card-title' }, '显示字段'),
        React.createElement('div', { className: 'bib-set-card-desc' },
          '关闭的字段立刻从信息栏隐藏且不占位；「刷新失败」「账单未保存」等提示建议保留，方便发现数据异常。')),
      React.createElement('div', { className: 'bib-set-body' }, groupsChildren)),
    React.createElement('section', { className: 'bib-set-card', 'aria-labelledby': 'bib-set-colors-title' },
      React.createElement('div', { className: 'bib-set-card-header' },
        React.createElement('h2', { id: 'bib-set-colors-title', className: 'bib-set-card-title' }, '字段颜色'),
        React.createElement('div', { className: 'bib-set-card-desc' },
          '挑选预设色或用取色器、十六进制自定义；颜色会自动适配浅色与深色主题，保持可读。未改动前与现在的外观完全一致。')),
      React.createElement('div', { className: 'bib-set-body' }, colorChildren)),
    React.createElement('div', { className: 'bib-set-footer' },
      feedback,
      React.createElement('button', {
        type: 'button', className: 'bib-set-btn', disabled: saving,
        onClick: function () { runReset('fields'); },
      }, '重置标签'),
      React.createElement('button', {
        type: 'button', className: 'bib-set-btn', disabled: saving,
        onClick: function () { runReset('colors'); },
      }, '重置颜色')));
}

// 注册入口：在信息栏 apply 完成后调用（见文件尾部的 module.exports 包装）。
async function applyInfoBarSettingsSection(ctx) {
  let slots = ctx.slots || (ctx.get ? ctx.get('slots') : undefined);
  for (let i = 0; slots === undefined && i < 60; i++) {
    await new Promise(function (resolve) { window.setTimeout(resolve, 300); });
    slots = ctx.slots || (ctx.get ? ctx.get('slots') : undefined);
  }
  if (slots === undefined) {
    console.warn('[dsh-bottom-info-bar] slots 服务 18s 内未就绪，信息底栏设置页未注册');
    return;
  }
  ctx.effect(function () {
    return bibSetInstallStyles();
  }, 'dsh-bottom-info-bar: settings styles');
  ctx.slots.inject('settings.section', function () {
    return ctx.slots.register(
      { name: 'settings.section', id: 'bottom-info-bar', order: 100, label: '信息底栏' },
      InfoBarSettingsSection);
  });
}

// ---- 设置页扩展：包装模块导出，在信息栏 apply 完成后注册 settings.section ----
;(function () {
  const baseExports = module.exports;
  module.exports = {
    inject: baseExports.inject,
    apply: async function (ctx) {
      await baseExports.apply(ctx);
      await applyInfoBarSettingsSection(ctx);
    },
  };
})();
