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

## DSH 升级后的核对步骤

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

## 给下次升级的一句话

**接口名不是契约，报错才是。** 凡是「取宿主某个成员」的地方，都要假定它明天会改名或消失：
要么用 `typeof x === 'function'` 判定后降级，要么用候选名列表择一，**永远不要让 `undefined`
流到 React 或函数调用位置**。
