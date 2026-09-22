# 宿主兼容清单（DSH Host Compatibility）

> 用途：记录本插件依赖的 **DSH 宿主接口**，以及宿主改版时的差异与应对。
> 每次 DSH 升级后，先照这个清单逐项核对，再决定是否要发新版插件。
> 基线：DSH `0.1.6-alpha.2` → `0.1.7-alpha.1`（2026-09-22 实测）。

## 为什么需要这份清单

插件跑在宿主里，宿主的公开接口不是冻结的。已经踩过两次**静默失效**：

1. 接口名被移除 → 插件不报错，只是功能悄悄不生效（用户要过很久才发现）。
2. 宿主把某个组件从「取不到就降级」变成「取不到就崩」→ 整块 UI 白屏。

两种情况都不会在启动日志里留下 `error`，只看日志查不出来，**必须真开浏览器看界面**。

## 依赖面清单

| 宿主接口 | 用途 | 0.1.6-alpha.2 | 0.1.7-alpha.1 | 本插件的应对 |
|---|---|---|---|---|
| `@deepseek-ai/dsh-client-ui-primitives` 的下拉箭头图标 | 设置页卡片折叠箭头 | `IconChevronDownOutline14` | 改为 `IconChevronDownOutlineRegular` / `…Medium`（尺寸后缀改成描边档位） | `BIB_SET_CHEVRON_ICON` 运行时按 `Regular → Medium → 14` 择名；三边都缺则退回 CSS 画的箭头。**绝不把 `undefined` 交给 `React.createElement`** |
| 同上的 `Tooltip` | 上下文明细圆环的悬浮说明 | 有 | 有 | `typeof … === 'function'` 判定，缺失退回浏览器原生 `title` |
| `settings` 服务 | 读宿主语言（宿主机端文案跟随宿主） | `@deepseek-ai/dsh-settings-file`，有 `get(ns)` | 换成 `@deepseek-ai/dsh-settings` 的 `SettingsForms`，**`get(ns)` 被整块移除**，只剩 `describe()/update()/replace()/mutate()` | `readHostLocalePreference()`：`describe()` 优先（按 `ns === 'locale'` 找 `value.preference`），`get(ns)` 兜底；都读不到按 `zh` |
| `conversation.composer.dock` 插槽 | 信息栏本体（同 id `stats` + `priority:-1000` 顶掉原生栏） | 存在 | 存在（逐字节相同的 `dsh-client-ui-slots`） | — |
| `plugins.bundle.config` 插槽 | 插件页配置区块（**keyed**，键 = 包名） | 存在 | 存在 | key 必须是包名 `dsh-bottom-info-bar`，不能用列表插槽的 `id` 字段 |
| 投影 `sessionStats` / `tokenUsage` / `contextPressure` / `contextBreakdown` | 轮次、耗时、缓存命中、上下文圆环 | 存在 | 存在 | 缺失时整块不渲染，绝不猜数字 |
| `window.__ModuleLoader__` | client 半的加载入口 | 存在 | 存在 | — |
| `settings/document-updated` 事件 | 宿主配置变更后刷新快照 | 存在 | 存在 | — |

## 宿主原生组件（primitives）可用清单与降级策略

自 2026-09-22 起，设置面板不再自绘控件，全部优先走宿主 primitives。
入口是 `bibSetNative(name)`（存在性判定）+ `bibSetButton/Tag/StateDot/Alert/TimeZonePicker` 包装层。

| primitives 成员 | 用途 | 关键参数 | 缺失时的兜底 |
|---|---|---|---|
| `Button` | 所有按钮 | `variant: 'primary'\|'ghost'\|'outline'\|'toolbar'`，`size: 'md'(36px)\|'sm'(28px)`，`icon` | 自绘 `<button>`（同几何：`sm` 28px 胶囊 / r14 / 12px / `0 10px`） |
| `Switch` | 各类开关 | `{ checked, onChange, label, disabled, title, className }`，`aria-checked` 驱动 | 自绘 36×20 轨道 + 16px 圆钮（原生化几何已实测一致） |
| `Menu` | 时区等下拉（**取代原生 `<select>`**） | `{ open, anchor, items, selectedId, onSelect, onClose, portal, align }` | 退回原生 `<select>`（只在完全没有 primitives 时） |
| `Input` | 文本 / 数字输入 | — | 自绘 `<input>` |
| `SegmentedControl` / `Checkbox` / `Pill` | 分段控件 / 勾选 / 标签胶囊 | — | 各自自绘 |
| `Tag` | 「推荐」等状态标签 | `tone: 'outline'\|'solid'\|'neutral'\|'quiet'\|'success'\|'info'\|'warning'\|'danger'` | `<span>` + 自定义类名 |
| `StateDot` | 状态点 | `state: 'done'\|'warning'\|'ongoing'\|'error'\|'idle'` | `<span>` + `.bib-set-statedot--<state>` |
| `Tooltip` / `HoverCard` | 悬浮说明 | — | 浏览器原生 `title` |
| `Modal` / `DisclosureRow` / `SettingsForm` / `ConfigField` / `Toast` / `MenuItemButton` | 未使用 | — | — |

**硬约束（不可放宽）**：白名单 `require` 只有 `react`，但 `require('@deepseek-ai/dsh-client-ui-primitives')`
实测可用；取到的成员必须先过 `typeof m === 'function' || (m && typeof m === 'object')`，
**任何一个成员缺失时都要有等价兜底，绝不把 `undefined` 交给 `React.createElement`**
（否则 React #130，整个 `plugins.bundle.config` 白屏——已经踩过一次）。

## 插件配置区的原生排版基线（2026-09-22 第三次修正后定稿）

**DSH 里「设置弹窗」和「插件详情页」是两套基线，不能混用。** 插件的配置区渲染在**插件详情页**里
（`[data-plugin-config]` 位于 `dsh-client-ui-plugin-manager` 页面内），所以基线取自
`dsh-client-ui-plugin-manager/lib/client.js` 的 `X_2TxG_*`，**不是**
`dsh-client-ui-settings-general` 的 `Pt1bsG_row`。

**最重要的一条**：宿主 `PackageDetail` 的渲染树是
`detailSections` → [`section.detailSection[data-plugin-config]`（我们的配置槽）→ **`RowsSection`**（宿主原生行区块）→ `plugins.detail.section` 槽]。
也就是说**宿主自己的原生行区块就紧挨在我们下面**，它用的正是 `.X_2TxG_rows` + `.X_2TxG_row`。
我们的行必须照它，才能和它上下对齐。**不要照 `.X_2TxG_card / cardHead / cardDesc`**——那一组是插件**列表页**的卡，
不是详情页的配置区（这一点连续搞错两次，见文末坑表）。

| 选择器 | 关键声明 | 本插件对应 | 归属 |
|---|---|---|---|
| `.X_2TxG_page` | `padding: 28px clamp(24px,4vw,48px) 48px; gap: 32px` | 页面外壳（宿主提供） | 详情页 |
| `.X_2TxG_page > *` | **`width: 100%; max-width: 960px`** | 内容宽度上限 | 详情页 |
| `.X_2TxG_detailSections` | `flex-direction: column; gap: 32px; margin-top: 32px` | `.bib-settings { gap: var(--bib-sec-gap) }` | 详情页 |
| `.X_2TxG_detailSection` | `flex-direction: column; gap: 12px` | `.bib-set-card { gap: var(--bib-sec-inner) }` | 详情页 |
| `.X_2TxG_sectionHead` | `align-items: baseline; gap: 10px` | `.bib-set-card-header-main` | 详情页 |
| `.X_2TxG_sectionTitle` | `font-size: 14px; font-weight: 500; line-height: 20px` | `--bib-title-*`（页标题 / 区块标题） | 详情页 |
| `.X_2TxG_sectionCount` | `color: label-secondary; font-size: 12px; line-height: 18px` | `--bib-count-*` | 详情页 |
| `.X_2TxG_pageIntro` | `font-size: 13px; line-height: 20px; label-secondary` | `--bib-intro-*` | 详情页 |
| `.X_2TxG_groupTitle` | `font-size: 14px; font-weight: 500; line-height: 22px` | `.bib-set-group-title` | 详情页 |
| `.X_2TxG_rows` | `flex-direction: column; gap: 0; padding: 0` | `.bib-set-field-list { gap: 0 }` | **宿主原生行区块** |
| `.X_2TxG_row` | **`padding: 12px 2px; border-bottom: .5px solid var(--dsw-alias-border-l2)`** + `:last-child { border-bottom: 0 }` | `--bib-row-pad-block/inline` + `--bib-rule` | **宿主原生行区块** |
| `.X_2TxG_rowLine` | `align-items: center; gap: 16px; min-width: 0` | `--bib-row-gap` | 原生行区块 |
| `.X_2TxG_rowId` | `font-size: 13.5px; font-weight: 500; line-height: 20px` | `--bib-row-label-*` | 原生行区块 |
| `.X_2TxG_rowModule` | `font-size: 11.5px; line-height: 16px`（等宽字体） | `--bib-row-hint-*`（行副标题） | 原生行区块 |
| `.X_2TxG_rowIcon` | `width/height: 40px; border: .5px solid border-l3; border-radius: 10px` | 本插件行无图标列 | 原生行区块 |
| `.X_2TxG_failure` | 错误色、`align-items: center; gap: 10px` | `.bib-set-alert--error` | 详情页 |
| `.X_2TxG_reason` | `color: state-error-primary; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 12px; line-height: 18px` | 错误正文 | 详情页 |
| `.X_2TxG_banner` | `background: color-mix(in srgb, state-warning-primary 12%, transparent); border-radius: 10px; padding: 8px 12px; font-size: 12px; line-height: 18px` | `.bib-set-alert--warning` | 详情页 |
| ~~`.X_2TxG_card`~~ | `border-radius: 12px; margin: 0 -8px` | **不要照抄**（插件列表页的卡） | 列表页 |
| ~~`.X_2TxG_cardHead`~~ | `align-items: center; gap: 14px; padding: 8px` | **不要照抄**（同上） | 列表页 |
| ~~`.X_2TxG_cardDesc`~~ | `font-size: 13px; line-height: 18px` | **不要照抄**（同上） | 列表页 |

### 三条铁律

1. **行的正确几何 = `padding: 12px 2px` + `0.5px` 下边线（末行无线）。**
   `.X_2TxG_card { margin: 0 -8px }` 不要抄：宿主能这么写是因为它的滚动容器横向有 8px 排水沟内边距；
   本插件根容器没有，而且字段清单外面套着 `overflow: hidden` 的折叠容器——照抄会让行比容器宽 16px，
   右侧控件（颜色井 / hex 输入框）被裁掉。**横向内缩只能来自行自己的 `padding-inline`**，
   内容块（`.bib-set-page-head` / `-toolbar` / `-card-header` / `-footer` / `-alerts` / `-group-title`）的左右
   `padding` 必须为 **0**，否则整块比宿主左沿右偏 8px。
2. **宽度上限交给宿主，插件根节点绝不设 px 级 `max-width`。** 宿主 `.X_2TxG_page > *` 已把内容钉在
   `min(100%, 960px)`。写成 `max-width: 760px` 会在 1440 视口里把内容整体压窄 200px、900 视口压窄 12px，
   右侧控件够不到宿主右边界——这是「对不齐」的唯一真凶（第三方审计里唯一一条 P1）。只允许 `max-inline-size: 100%`。
3. **宿主 primitives 组件一律不得复用插件自绘兜底控件的类名。** 插件 `<style>` 后插入，同特异性即胜出，
   会静默覆盖宿主外观。要给它布局就**新开一个只含布局声明的类**（反例见文末坑表「开关隐形」）。

**规则判定的前置动作**：判「原生长什么样」之前，先用 `[data-plugin-config]` 确认渲染位置，
再去读**那个页面**的 CSS 模块 + `getComputedStyle` 交叉验证。凭「设置」两个字猜基线已经错过一次。

## DSH 升级后的核对步骤

0. **改完 client bundle 先重启宿主**，否则下面每一步看到的都是被 `immutable` 缓存钉住的老副本。
1. `dsh --profile web --dump-config`：退出码 0、无 `cannot resolve profile bundle` 之类的报错。
2. 打开 DSH 网页，**看信息栏本体**在真实会话里是否显示（新会话空页面上本来就不显示，别误判）。
3. 打开 **插件页 → dsh-bottom-info-bar**，看「信息栏设置」区块是否正常渲染（不是空白）。
4. 浏览器控制台搜 `slot entry crashed`：出现即说明某个插槽组件抛错，本清单要补一条。
5. 逐个试设置页交互：折叠卡片（箭头）、开关、颜色、导出账单、恢复默认。
6. 跑全量测试：`node tests/run-all.mjs`。

## 已记录的坑

- **2026-09-22（0.1.6 → 0.1.7-alpha.1）**：信息栏本体正常，插件页「信息栏设置」整块空白。
  控制台：`slot entry crashed in 'plugins.bundle.config'` + `React error #130`。
  根因 = 图标导出名被改，插件把 `undefined` 当组件传给 React。
  修复 = 运行时择名 + CSS 兜底；并在 `tests/test-field-config-client.js` 里加了**渲染级**回归
  （createElement 收到非 string/function 就抛错，等价 React #130），锁死这类回归。
- **同批**：`settings.get(ns)` 被移除导致宿主机端文案语言永远回退 `zh`。普通用户中文环境无感，
  英文宿主则文案串语言。修复见上表。
- **2026-09-22（同一天第二次返工，用户二次差评）**：三个问题一起报上来——「被裁切」「古老组件」「报错排版差」。
  1. **基线搞错**：把配置区当「设置弹窗」对齐 `Pt1bsG_row`（`.5px` 细分隔线、`padding: 16px 0`）。
     实际渲染在插件详情页，正确基线是 `X_2TxG_*`。**补了上面那节基线表。**
  2. **自己引入的裁切**：照抄 `.X_2TxG_card { margin: 0 -8px }`，但本插件没有横向排水沟内边距 +
     外层 `overflow: hidden`，行宽出 16px 把右侧颜色井裁掉；另有计数框写死 `width: 104px` + `nowrap`。
     修法见上节。**已加回归测试「列表内容不得横向越界」**（正则只扫 CSS 声明块，避免被注释误伤）。
  3. **自绘控件**：时区用原生 `<select>`（未走宿主组件）。改用 primitives `Menu`（`portal` + 锚点），
     开关 / 按钮 / 标签 / 状态点一并切到 primitives，全部保留缺失兜底。
  4. **报错排版**：从「『错误』单独占一行 + 正文甩到下方」改为宿主 `failure` + `reason` 独立整块形态。
  验收改为读运行时事实：`selects: 0`、`fallbackSwitchTracks: 0`、`buttonClasses` 命中原生类名、
  `settings gap=32px`、`row pad=12px 2px bd=.5px`、**`clip: []`**、控制台零 error/warn。
- **2026-09-22（同一天第三次返工，用户要求「从根因解决 + 独立审计 + 重构 + 看官方指导」）**：
  1. **基线第三次修正**：上面两轮的「行 `padding: 8px` + 无分隔线」依然是错的——那是插件**列表页的卡**
     （`.X_2TxG_card/cardHead/cardDesc`）。配置区该照的是**紧挨我们下方的宿主原生行区块 `RowsSection`**
     （`.X_2TxG_row { padding: 12px 2px; border-bottom: .5px solid border-l2 }`）。判基线的口诀：
     **先看渲染树里的兄弟节点，再找那个节点的 CSS 模块**，不要只看同一个文件里像的那个类名。
  2. **宽度上限（审计唯一 P1）**：插件根节点写了 `max-width: 760px`，而宿主 `.X_2TxG_page > *` 已经是
     `min(100%, 960px)` → 1440 视口下内容被压窄 200px。改为 `max-inline-size: 100%`。
  3. **重构为度量层**：所有度量抽成 `.bib-set-root` 上的 `--bib-*` 变量，规则只引用变量；回归测试改为
     锁「变量定义 + 规则引用」两层事实，不退回裸数字。
  4. ⚠ **开关隐形事故（最贵的一条）**：`bibSetSwitch` 的原生分支给宿主 `Switch` 传了
     `className: 'bib-set-switch bib-set-switch--native'`。`.bib-set-switch` 里的
     `appearance:none; background:0 0; padding:0` 与宿主 `._switch_1vyxu_10{background:border-l3; padding:2px}`
     **特异性同为 (0,1,0)**，插件样式后插入 → 插件赢 → **OFF 态轨道背景变透明，4 行开关肉眼消失**
     （对比度 1.00:1），滑块内缩 `18/2` 变 `16/4`。ON 态没事，因为宿主用 `[aria-checked=true]`（(0,2,0)）。
     修法：原生分支只挂 `.bib-set-switch-host { flex: none; }`，并用
     `.bib-set-row-main > .bib-set-switch-host { grid-column:2; grid-row:1; align-self:start }` 显式钉死位置
     （否则依赖兄弟节点书写顺序的隐式自动放置）。**兜底的 `.bib-set-switch` / `-track` / `-thumb` 保留**，
     原生组件缺失时才会渲染，不是死代码。
  5. **默认色点描边**（用户拍板「加深到看得清」）：1px 内描边由 `--dsw-alias-border-l3`（浅色 12% 黑，
     16px 圆上仅 1.32:1）改为 `--dsw-alias-label-tertiary`（≈3.9:1 浅色 / ≈5:1 深色）。彩色点保持无描边。
  6. **「聊天页底部空白越拉越长」不是本插件**（有反证）：`active` 相态下 `.bi-root` 底边到视口底恒 4px
     （宿主 `.uV2eYG_root{padding-bottom:4px}`）；**把 `.bi-root` 折叠成 0 高反而出现 38px 空白** → 它在填坑。
     成片空白只有宿主相态能给：`[data-phase=hero]` 下 seat 变 `static`（空会话 1080×660 空 191px，**插件根本
     没渲染**）、`[data-phase=settling]` 下 seat 连 `visibility:hidden`。
     **取证坑**：按 `style[data-plugin-css]` 移除样式会误删 130+ 个宿主 CSS Module，必须用
     `style[data-plugin="dsh-bottom-info-bar"]`（全页只有 2 个）。

## 给下次升级的一句话

**接口名不是契约，报错才是。** 凡是「取宿主某个成员」的地方，都要假定它明天会改名或消失：
要么用 `typeof x === 'function'` 判定后降级，要么用候选名列表择一，**永远不要让 `undefined`
流到 React 或函数调用位置**。
