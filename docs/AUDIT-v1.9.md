# 安全审计报告 — 「底部信息栏」v1.9.0（feat/v1.9.0-perf）

- **审计对象**：`git diff main...HEAD` 全量改动（8 个提交；PR1 性能修复 + PR2 设置页），16 个文件，+3105/−245 行
- **审计人**：独立安全审计子代理（未参与本分支开发，职责分离）
- **审计方式**：只读。全量 diff 人工审读 + 关键文件全文精读（host.js / client-bundle.js / client-settings.js / constants.js / build.mjs）+ 全库注入点扫描 + `~/.dsh/dsh-bottom-info-bar/` 磁盘元数据只读对比 + 新增验收测试实际执行（45/45 PASS，测试自带临时目录护栏，未触碰真实数据）
- **日期**：2026-08-28（分支最新提交 ce80f8c）

---

## 一、总体结论：✅ 可发布

**未发现高危、中危问题。** 4 个低危/历史遗留项与若干观察项均不阻断发布，附修复建议供后续版本采纳（低危 L1 建议顺手修，成本一行代码级）。

分发铁律核验：**零密钥 ✅ / 零个人路径 ✅ / 零新增第三方依赖 ✅ / 作者署名不变 ✅（plugin/package.json 零变化）**。

---

## 二、检查项逐条结论

### 1. 密钥与隐私 ✅

| 结论 | 证据 |
|---|---|
| ✅ 全 diff 无真实密钥 | 对 api_key/sk-/Bearer/token/secret/password 全模式扫描：仅命中 ① 测试桩假值 `'sk-test'`（tests/test-field-settings.mjs:22、tests/test-usage-compaction.mjs 环境变量名引用，非真实凭据）；② `API_KEY` 字面量（host.js:677，为「未配置 XXX_API_KEY」用户提示语）；③ 文档中的功能描述文字 |
| ✅ 零个人路径 | 全 diff 扫描 `/Users/`、`/home/`、`C:\`、机器用户名：零命中 |
| ✅ settings.json 内容模型非敏感 | 仅含 `version/infoDensity/fields/colors/configVersion`（host.js:829、1183-1193），全部为 UI 偏好，无凭据、无路径、无账单数据 |

### 2. 依赖与供应链 ✅

| 结论 | 证据 |
|---|---|
| ✅ 零依赖变化 | `git diff main...HEAD -- plugin/package.json install.sh uninstall.sh .github/` 输出为空——依赖清单、安装脚本、CI 配置一概未动 |
| ✅ 零新增外部网络请求 | 全 diff 扫描 `fetch(`、`https://`、`XMLHttpRequest` 新增行：零命中。PR1/PR2 纯本地计算与落盘 |
| ✅ build.mjs 注入内容来源可信 | 锚点替换内容仅来自仓库自有 `src/constants.js`（build.mjs:20-48，括号配对提取 `extractArray`，缺失/未闭合直接抛错中止构建），无用户输入、无网络参与构建。构建期无被恶意内容影响的面 |

### 3. RPC 加固 ✅

| 结论 | 证据 |
|---|---|
| ✅ 4 个新 RPC + setInfoDensity 全部列入 MUTATING 同源校验 | host.js:3453 `MUTATING = { …, setFieldConfig, resetFieldConfig, resetFieldColors, … }`（setInfoDensity 主干既有）；同源校验逻辑 host.js:3460-3473（sec-fetch-site + origin/host 比对），网关于 host.js:3524。**实测**：tests/test-field-settings.mjs 对 4 个写方法逐一断言跨站 403，45/45 PASS |
| ✅ 字段 id 白名单 | host.js:3400、3411：`FIELD_ID_SET`（源自 FIELD_REGISTRY，constants.js:19-55）之外的键直接 400；`__proto__/constructor/prototype` 不在注册表内，天然被拒 |
| ✅ 颜色校验严格 | host.js:838-846 + host.js:33 `HEX_COLOR_PATTERN = /^#[0-9a-f]{6}$/`（锚定全匹配）：只接受预设色名白名单（constants.js:72）或 #RRGGBB（归一化大写）；客户端同样预校验（client-settings.js:14、283），但服务端校验独立完整，不依赖客户端 |
| ✅ 锚点保护 | host.js:3401：锚点字段拒绝置 false（`ANCHOR_FIELD_IDS`，host.js:814）；设置页同步禁用开关（client-settings.js:331） |
| ✅ 无"半新半旧"部分应用 | host.js:3392「先整包校验再应用」：整个 patch 归一化校验通过后才逐键写入（3395-3434），任一非法即整体 400，内存零改动 |
| ✅ 错误响应不泄露内部路径/堆栈 | host.js:3537-3540：500 一律返回通用 `internal error`（无堆栈无路径）；400 仅回业务校验文案。未知方法名回显（host.js:3521）为主干既有代码，JSON 序列化转义 + `application/json`，无注入面 |
| ✅ 请求体大小上限仍生效 | host.js:3530 `readBody(req, 64 * 1024)` 对全部 POST/PUT 生效（含新 RPC），超限 413 并 `req.destroy()`（3481-3487） |
| ✅ configVersion 无敏感信息 | 纯单调计数器（host.js:1182），客户端仅用于新旧判别；重启归零、无容量增长 |

### 4. XSS / 注入 ✅

| 结论 | 证据 |
|---|---|
| ✅ 无 HTML 注入点 | 全 `plugin/src/` 扫描 `innerHTML/outerHTML/insertAdjacentHTML/dangerouslySetInnerHTML/document.write/eval/new Function`：**零命中**。设置页与信息栏全部经 `React.createElement` 文本子节点渲染（React 自动转义）；FIELD_REGISTRY 标签为构建期常量，无用户输入参与 |
| ✅ `--bi-field-*` 值只可能来自校验过的色值 | 链路闭合：getConfig → 宿主已归一化（预设名或 #RRGGBB 大写，host.js:838-846）→ 客户端 `fieldStyle()` 经 React style 对象赋 CSS 自定义属性（client-bundle.js:146-157）。CSSOM `setProperty` 原子赋值，值不经过 CSS 解析器分词——即使出现恶意串也无法逃逸出单条声明 |
| ✅ 恶意 hex 无法逃逸 style 上下文 | 服务端正则锚定（`^#[0-9a-f]{6}$`）+ 深色变体计算 `readableDarkVariant` 仅 `parseInt` 后按位混合再输出受限 hex（client-bundle.js:136-143），非法输入只会得到无效颜色被 CSS 忽略，不可能构造出第二条声明 |
| ✅ 动态 CSS 仅含常量 | `buildFieldColorCss()` 只拼接 FIELD_REGISTRY 的常量 id/colorKind（client-bundle.js:161-201）；静态样式表为纯模板字符串无插值（client-bundle.js:216+、client-settings.js:33-85） |
| ✅ hex 输入链路完整 | client-settings.js:277-288：提交前 `^#[0-9a-fA-F]{6}$` 校验，非法描红不提交；`maxLength: 7`（387 行）；取色器值本就恒为 #rrggbb（374-377） |
| ✅ CustomEvent 伪造无害（观察项 O1 收档） | `dsh-bib-config-changed` 监听器只调用 `refreshFieldConfig()`（client-bundle.js:363-368）——一次 `getFieldConfig` 只读拉取，且模块级 in-flight 去重（116-123 行）使事件风暴最多并发 1 个请求；无写路径、无 DOM sink。页面内脚本本就能直接发该请求，伪造事件不增加任何能力 |

### 5. 文件安全 ✅（1 项低危，见 L1）

| 结论 | 证据 |
|---|---|
| ✅ settings.json 落盘权限 0600 | host.js:894 `openSync(tmp, 'w', 0o600)` + rename 保留 tmp inode 权限；DATA_DIR 创建即 0700（890 行）。注：本机 `~/.dsh/dsh-bottom-info-bar/` 实测尚无 settings.json（新版未重启生效），权限结论基于代码路径推断；对比 usage-records.json 实测确为 0600（同型 writeAndSync 路径，host.js:2673） |
| ✅ 固定文件名，无路径穿越 | `SETTINGS_FILE = join(DATA_DIR, 'settings.json')` 纯常量（host.js:31）；所有 RPC 不接受任何路径参数 |
| ✅ 原子写竞态/符号链接现实风险不可达 | tmp 名含 `pid + randomUUID()`（host.js:891）不可预测；DATA_DIR 仅属主可写（0700，本机实测 755 亦无他人写位），能在此预植符号链接/抢跑 tmp 名的攻击者已是本机同用户，无增益。`rename` 替换目录项不跟随目标符号链接，settings.json 即使被预置软链也只会被整体替换、不伤链接目标 |
| ✅ 损坏回退不被构造为 DoS | 损坏 → JSON.parse 异常 → 整体回退默认并显式 warn（host.js:873-886），单条非法仅丢弃该条（849-871）。超大文件启动同步加载无大小上限属理论面（见观察项 O3：需本地 0700 目录写权限，现实不可达） |
| ⚠️→L1 历史遗留权限 | 本机实测：`usage-records.journal.jsonl` 为 **0644（其他本地用户可读）**、DATA_DIR 为 **755**。经 git 历史核验：journal 机制与 0600 写入模式主干既有，此为旧版本代码创建文件的遗留状态（mode 参数不追溯已存在文件），**非本分支引入**；但 PR1 将 journal 升格为账本权威源，建议顺手自愈，见 L1 |

### 6. 资源 / DoS ✅

| 结论 | 证据 |
|---|---|
| ✅ setFieldConfig 有 64KB payload 上限 | host.js:3530 统一网关限制，30 字段注册表实际载荷 KB 级 |
| ✅ configVersion 无限递增无后果 | JS number（2^53 内精确，现实不可及）；不落盘不累积、重启归零；客户端仅比对，无存储/渲染增长 |
| ✅ reset 无信息泄露 | resetFieldConfig/resetFieldColors 返回与 getFieldConfig 同构的 settingsPayload（host.js:3437-3450），无额外内部信息；唯一注脚见观察项 O4（落盘失败 warning 含本机 fs 错误消息，仅本地用户自见） |

### 7. OWASP Top 10 逐项

| 项 | 结论 | 理由 |
|---|---|---|
| A01 失效访问控制 | ✅ 已覆盖 | 全部写方法（含 4 个新 RPC）列入 MUTATING 同源网关（host.js:3453、3524）并实测 403；只读路由无 CORS 响应头，跨域页面可发请求但不可读响应。残余：DNS rebinding 理论面为平台层职责（观察项 O2，非本分支引入） |
| A02 加密失败 | ✅ 不适用 | 无密钥存储/自定义加密需求；凭据经宿主 credentials 服务解析、Bearer 仅发服务商官方 API（host.js:1258-1260，主干既有，注释明确 API Key 不进命令行）；randomUUID 用于临时文件名，非安全用途 |
| A03 注入 | ✅ 已覆盖 | 见检查项 4：无 HTML sink、CSSOM 原子赋值、字段白名单、严格 hex 正则；账本聚合键统一过 `safeMapKey` 原型污染护栏（host.js:722-727，`__proto__/constructor/prototype` 改写），且全部聚合写点（2202-3086 一带）一致使用 |
| A04 不安全设计 | ✅ 已覆盖 | 写路径整包校验后原子应用；落盘失败不阻断内存生效且如实回传 `persisted:false`（host.js:1190-1191、client-settings.js:220 明示用户）；账本「崩溃安全」方向性设计有专测（test-usage-compaction.mjs ⑤） |
| A05 安全配置错误 | ⚠️ 低危 L1 | 新文件权限正确；历史遗留 0644/755 见 L1 |
| A06 自带缺陷组件 | ✅ 不适用 | 零依赖变化、零新网络面，供应链面无扩大 |
| A07 身份认证与授权失败 | ✅ 不适用 | 本机单用户工具，无账号体系；同源校验即访问边界（写操作），与主干设计一致 |
| A08 软件与数据完整性失效 | ✅ 已覆盖 | 全部落盘走 tmp+fsync+rename 原子替换（host.js:889-907、2670-2685）；损坏/中断/旧版残留有分级回退与专测；构建注入源为仓库自有常量（观察项 O6 备注 `$` 序列语义为功能健壮性小事，非安全漏洞） |
| A09 日志与监控失效 | ✅ 已覆盖 | 500 通用错误不泄内部（host.js:3539）；warn 仅进本地控制台（O4 备注：个别消息含本机路径，仅本地自见） |
| A10 SSRF | ✅ 不适用 | 零新增网络请求；现有出网仅主干既有的服务商余额 API 与价目目录 |

---

## 三、发现清单（按风险分级）

### 高危：无
### 中危：无

### 低危（不阻断发布，建议随本版或下版修复）

**L1 · 历史遗留的账本文件/目录权限过宽（0644 / 755）**
- **现状**：本机 `~/.dsh/dsh-bottom-info-bar/` 实测：`usage-records.journal.jsonl` `-rw-r--r--`（其他本地用户可读——含服务商/模型/tokens/会话维度用量元数据）、目录 `drwxr-xr-x`；同目录 `usage-records.json`/`pricing-cache.json` 均为 0600。
- **定性**：经 git 历史核验为旧版代码所创建文件的遗留状态（openSync 的 mode 参数只作用于新建），**非本分支 diff 引入**；但 PR1 后 journal 成为账本权威源，暴露面价值上升，且新版 settings.json 将以正确 0600 落盘、对比之下更显突兀。
- **建议**：在启动加载路径加一次性自愈——对 DATA_DIR 及已知账本文件 `chmodSync` 到 0700/0600（幂等、数行代码）；或至少在 README 安全小节注明 `chmod 600 ~/.dsh/dsh-bottom-info-bar/*` 的一次性手动修复。

### 观察项（现实不可达或不属安全范畴，记录备查）

**O1 · CustomEvent `dsh-bib-config-changed` 可被页面内脚本伪造** — 影响仅为触发一次带 in-flight 去重的只读 `getFieldConfig`（client-bundle.js:116-123、363-368），无写路径无数据出口；页面内脚本本就能直发该请求，伪造无增益。**无害，无需修改。**

**O2 · DNS rebinding 理论绕过 sameOrigin** — `sameOrigin` 以 `Origin host === 请求 Host 头` 比对（host.js:3460-3473），rebinding 场景二者可同为攻击域名。但前提是攻击者域名可解析到用户本机端口且 DSH webServer 对外可达——属宿主网络边界职责，主干既有设计，本分支未改变暴露面。可向 DSH 平台侧建议绑定 127.0.0.1 校验。

**O3 · 超大 settings.json 启动同步加载无大小上限** — `readFileSync + JSON.parse`（host.js:876）无字节上限，理论可致启动内存/耗时尖峰；损坏文件已正确回退默认。构造该文件需对 0700 数据目录有本地写权限=已是本机用户，现实不可达。可选加固：读取前 `statSync` 拒绝超过（如）1MB 的文件。

**O4 · 个别错误消息含本机绝对路径** — 落盘失败 warning（host.js:1200）与 journal 失败消息为 Node fs 错误原文，可含绝对路径；仅经 RPC 回传给本机用户自己的浏览器设置页展示（client-settings.js:220），不跨信任边界、不入库不分发。可选打磨：warn 时剥离路径只留错误码。

**O5 · 锚点保护只在 RPC 层强制** — `sanitizeSettings` 加载磁盘文件时不强制锚点字段为 true（host.js:856-861 接受白名单内任意布尔），手改 settings.json 可隐藏身份锚点（client-bundle.js:760 按 `fieldVisible` 过滤）。纯本地、纯外观影响，无安全后果；如在意产品不变量可在加载侧同样拒绝。

**O6 · build.mjs `String.replace` 的 `$` 序列语义** — 注入用字符串替换（build.mjs:44-47），替换文本中 `$&/$'` 等序列会被特殊解释；当前常量全为中文/英文 id 不含 `$`，且来源为仓库自有受信文件。属功能健壮性备注：改用函数形式 `.replace(re, () => literal)` 可根除此类隐患。

**O7 · writeFileAtomic 未 fsync 目录** — rename 后缺目录 fsync，极端断电下设置可能回滚到旧值；账本路径同样如此但其 journal 先行追加保证金额不丢。数据新鲜度问题，非安全。

**O8 · settings 临时文件残留无清理** — 写入中断残留的 `settings.json.tmp.<pid>.<uuid>` 无启动清扫（对比账本 tmp 文件参与恢复机制，host.js:743-748）。纯磁盘垃圾，可选在启动时清扫。

---

## 四、发布附带提醒（非安全项）

- `docs/V1.9-PR2-DEV-REPORT.md` 目前为**未跟踪文件**（不在本次 diff 内，已顺手扫描：无密钥无个人路径）——合入前记得 `git add`，避免开发报告遗漏在版本库外。

## 五、测试佐证

- 新增 `tests/test-field-settings.mjs` 实际执行：**45 PASS / 0 FAIL**，含 4 个新写 RPC 的跨站 403、白名单拒绝、锚点拒绝关闭、density 落盘往返、双重置独立性、configVersion 语义、损坏回退。
- 新测试遵守仓库铁律：env 先于 import + 临时目录硬护栏（test-field-settings.mjs:16-25「安全护栏」断言）、fetch 全桩无真实网络。
