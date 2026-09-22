# 决策文档｜信息栏设置页从 0 重构（2026-09-22 用户逐项拍板）

## 1. 为什么重构

连续四轮在「色点外环被裁」「按钮对不齐」上打补丁后，用户明确指出这是**舍本逐末**，要求从 0 重新审计。独立审计结论：

| 症状 | 表面 | 真正的根因 |
| --- | --- | --- |
| 列表极长、看着乱七八糟 | 32 个字段行、每行占 2 行 | 把「调色板」当成行内控件：7 个色点 + 系统取色器 + hex 输入 = 9 个控件硬塞进一行，被迫折行 |
| 一折叠就是全部折叠、一展开就是全部展开 | 折叠很蠢 | 折叠状态只有页面级一个 `fieldsCollapsed`，32 行共用一个折叠 |
| 有的行宽有的行窄 | 视觉上不齐 | 「主/世界时间」「自定义文字」这类**带参数的字段**把 5 个胶囊 + 时区选择框塞进了「显隐开关」这一行 |
| 改颜色的交互不像别的软件 | 交互生造 | 行业常规（macOS / Notion / Figma）是**行内一个色块 → 点开弹层**，没有一款把 7 个色点摊在列表行上 |

连带确认（虽然已随重构作废）：色点选中态的白环实测 **56×60**（理想整圆 60×60），横向少 2px 逻辑像素 —— 形状本身就不是正圆，不是「被裁」，是控件在 flex 行里被压扁。

## 2. 决策记录（用户逐项拍板，原文照录）

### 决策 1 · 改文字颜色的交互

> 问：改文字颜色的交互，采用哪一种？
- **用户选择：行内色块＋弹层（推荐）**
  选项原文：「行内只留一个色块（显示当前色，未设置时显示斜线）。点开宿主 Menu 弹层：6 个预设色 + 「自定义…」呼系统取色器 + 「恢复默认」+ hex 输入。每行 9 个控件降到 2 个，列表长度直接减半。这是 macOS/Notion 的常规做法。」
- 未选：只要系统取色器 / 色块＋hex 且预设进弹层。

**落地要求**：字段行右侧只剩「开关 + 一个色块」；色块点开 primitives `Menu`；菜单项依次为 6 个预设色（带色点）、「自定义…」（触发系统 `<input type="color">`）、「恢复默认」、hex 输入框。行内**不再**渲染 7 个色点、不再渲染独立的取色器色井。

### 决策 2 · 折叠结构

> 问：折叠结构怎么组织？
- **用户选择：两个分组独立折叠（推荐）**
  选项原文：「「原生字段」「插件字段」两组各自独立折叠，用宿主原生 DisclosureRow，组头带计数（如「已启用 12/18」），默认折叠，搜索命中自动展开。」
- 未选：按语义细分 5–6 组 / 保留总折叠只折行内参数区。

**落地要求**：删除页面级 `fieldsCollapsed` 单一状态；两个分组各自持有一个受控 `open` 状态；组头用 primitives `DisclosureRow`（`open` + `onToggle` + `expandable`），标题右侧带「已启用 N/M」计数；默认折叠；搜索有输入时两个分组自动展开。

### 决策 3 · 带参数的字段（主/世界时间、自定义文字）

> 问：「主/世界时间」和「自定义文字」这类带参数的字段怎么放？
- **用户选择：独立成设置区（推荐）**
  选项原文：「从字段行里拆出来，做成独立的「时间与日期」「自定义文字」设置区（用宿主 settings-form 字段），开关关掉时整区隐藏。字段行从此不再塞 5 个胶囊和时区选择框。」
- 未选：嵌在字段行、开关开时才展开。

**落地要求**：新增两个独立设置区（照宿主 `settings-form/fields.module.css` 字段基线：`.field { flex-direction:column; gap:6px; padding:12px 0 }`、`.field + .field { border-top:.5px solid border-l2 }`、`.label { 13/500 }`、`.input { height:34px; r8; padding:0 12px }`、`.hint { 12/1.5 }`）；对应字段开关关闭时整区隐藏。

### 决策 4 · 页脚「重置」的二次确认

> 问：页脚的「重置」要不要加二次确认？
- **用户选择：加二次确认（推荐）**
  选项原文：「用宿主原生 RiskConfirmation，重置前弹确认。现在是一点就把 32 个字段和所有颜色全清掉，破坏性操作没有确认。」
- 未选：保持一键重置。

**落地要求**：重置按钮点击后打开 primitives `RiskConfirmation`（勾选确认前「确认」按钮禁用），不再直接执行。

## 3. 实施要点

- 字段行照宿主 `settings-form` 基线：左「标签 + 说明」，右「开关 + 色块」，**单行**，不再折行。
- 所有度量继续走 `.bib-set-root` 的 `--bib-*` token 层，规则只准引用变量，不准写裸数字。
- 行几何继续照宿主 `.X_2TxG_row`：`padding: 12px 2px` + `0.5px` 下边线、末行无线（配置区下方紧邻的就是宿主自己的 `RowsSection`，两者要上下对齐）。
- 原生组件一律只给「布局类」声明，绝不给「外观类」声明（`.bib-set-switch-host` 只有 `flex: none` + 定位，这是踩过的坑：同特异性 + 后插入会覆盖宿主，导致 OFF 态开关隐形）。
- 宿主原生组件 API（从 `.../dsh-client-ui-primitives/lib/index.js` 实读）：
  - `DisclosureRow({ icon, title, open, expandable, onToggle, running, expandOnRowClick, previewChevron, keepContentWhenOpen, collapsedContent, children, className, rowClassName, leadingClassName, chevronClassName, titleClassName })`
  - `RiskConfirmation({ open, title, description, acknowledgeLabel, cancelLabel, closeLabel, confirmLabel, acknowledged, disabled, onAcknowledgedChange, onCancel, onConfirm })`（内部是 `Modal` + 勾选确认，未勾选时确认按钮禁用）
  - `Menu` / `MenuItemButton`（复用本插件已有的 `bibSetTimeZonePicker` 用法）

## 4. 验收标准

1. 32 个字段行**全部单行**，行内控件 = 开关 + 一个色块（无 7 色点、无色井、无 hex）。
2. 「原生字段」「插件字段」两组可**独立**折叠展开，互不影响；组头有「已启用 N/M」；默认折叠；搜索输入时自动展开。
3. 「时间与日期」「自定义文字」成独立设置区，对应开关关闭时整区隐藏。
4. 点重置 → 弹出确认（未勾选不能确认）。
5. 点色块 → 弹层：6 预设色 / 自定义 / 恢复默认 / hex，且能真的改色并落盘。
6. `node tests/run-all.mjs` 全绿；真机四视口（1440/1080/900/760）无裁切、无横向溢出、行左沿与宿主原生行一致。
