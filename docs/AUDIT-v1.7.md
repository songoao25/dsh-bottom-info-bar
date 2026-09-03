# 安全审计报告：dsh-bottom-info-bar v1.7

> 独立安全审计（强职责分离：审计员未参与开发/QA）
> 审计日期：2026-08-27
> 审计范围：v1.7 新增风险面——凭据处理（~/.codex/auth.json JWT 解析；小米/Together/Fireworks/AWS Bedrock/Cloudflare 凭据读取与请求头传递）、SigV4 签名实现、「本会话」聚合（含子代理）、六项新适配器输入验证、依赖与产物洁净度
> 审计对象：`plugin/src/host.js`（2516 行）、`plugin/src/client-bundle.js`（997 行）、`plugin/src/constants.js`、`plugin/scripts/build.mjs`、`plugin/package.json`、产物 `plugin/lib/index.js` / `plugin/lib/client.js`、工作树 + git 全历史（93 commits）
> 基线：v1.6 审计（docs/AUDIT.md）全部通过；本次审计聚焦 v1.7 diff（`a926514..15d2e76`，host +1073 行 / client +159 行 / constants +6 行 / build +26 行）

---

## 0. 结论（TL;DR）

**达到可发布安全基线（PASS）。** 7 项检查全部通过，无高危/中危问题。发现 1 个低危观察项（未知服务商共桶聚合的精度问题）+ 2 个信息级备注（DNS-rebinding 边界、JWT 无长度上限）。v1.7 零新增第三方依赖，密钥只经 HTTP 头传递且不进命令行/日志/落盘，JWT 仅本地解码且渲染路径无任何 HTML 注入点，产物与源码逐字节一致（仅生成头注释差异）。

---

## 1. 检查项逐项结果

### 1.1 硬编码密钥/令牌扫描 —— ✅ 通过

**证据：**
- 全树扫描（`grep -rnE "sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,}|xox[bap]-"`，覆盖 js/mjs/json/yml/md/sh/patch）→ **零命中**。
- git 全历史扫描（`git log --all -p -S "sk-"`）→ 唯一命中是已删除文档 docs/AUDIT.md 中的「无硬编码密钥（…sk- 仅 2 处文档格式说明）」陈述句，**无真实密钥值**；96 行 `dfae4ef chore: remove private development materials` 一并清除了开发期文档。
- 凭据全部通过 `ctx.credentials.resolve(name)` 运行时解析（host.js:926, 999, 1041-1047, 1131-1137, 1142-1154, 1265-1271），源码中仅出现**环境变量名**（`DEEPSEEK_API_KEY`、`XIAOMI_*_API_KEY`、`TOGETHER_API_KEY`、`FIREWORKS_API_KEY`、`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN`、`CLOUDFLARE_API_KEY` / `CLOUDFLARE_ACCOUNT_ID`）作为凭据标识符。
- 工作树（含 docs/、tests/）同样零命中。

### 1.2 JWT 解析安全（XSS 注入面） —— ✅ 通过

**攻击假设检验**：恶意构造的 `~/.codex/auth.json` 中 `tokens.id_token` 能否注入 XSS？

**证据（解码侧，host.js:290-329）：**
- `decodeJwtPayload`：base64url→base64（补 padding）→`Buffer.from(...,'base64')`→`JSON.parse`，**任何一步失败返回 null**（`parts.length < 2`、异常、非对象 payload 均被挡）；parse 结果仅提取两个**强类型**字段——`chatgpt_plan_type`（须为 string 且非空）与 `chatgpt_subscription_active_until`（须经 `Date.parse` 得有限数，否则 null）。
- 解析失败/字段缺失 → 静默降级返回空额度（host.js:988-991），不报错不渲染。

**证据（渲染侧，client-bundle.js）：**
- 全文件仅 1 处 `textContent` 赋值（L96，注入**静态 CSS**），`innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function` **零出现**。
- 所有动态字符串（套餐名、到期日、标题、服务商/模型名）经 `React.createElement` 文本子节点或 title 属性渲染——**React 自动转义**，无 HTML 注入路径。
- 未知 planType 经 `planDisplayName` 白名单映射（`CODEX_PLAN_NAMES`，host.js:175-182），未收录档位走 `'ChatGPT ' + 首字母大写` 兜底——即便兜底串含 `<script>` 也只会作为纯文本显示。
- `subscriptionPlanShort`（client-bundle.js:563-566）对 planType 再做小写白名单映射，未知返回 null。

**结论**：恶意 auth.json 无法造成脚本执行；JWT 纯本地解码，零网络调用（wham 默认关闭）。**无 XSS、无注入。**

> 备注（信息级，非缺陷）：`decodeJwtPayload` 无长度上限、不校验 JWT 头/签名。攻击面权衡：auth.json 是**用户本机文件**（由配套插件写入，非远程输入），能写该文件的攻击者已具备本地权限、可直接窃取全部密钥，故该攻击面不构成新风险；解码失败路径已全降级。

### 1.3 SigV4 签名（AWS Bedrock） —— ✅ 通过

**证据（host.js:494-567, 1258-1329）：**
- 纯 `node:crypto` 实现（`createHash`/`createHmac`），零第三方依赖；派生链 `kDate→kRegion→kService→kSigning`、canonical request 含 payload hash、`x-amz-date`/`x-amz-security-token` 注入——与 AWS 官方规范一致（注释称已用官方 IAM ListUsers 固定向量验证，tests/test-v17-adapters.js:87 有单测提取）。
- **密钥不出本机**：`secretAccessKey` 仅作 HMAC 输入驻留内存（host.js:541），Authorization 头只含 **accessKeyId + 签名字符串**（host.js:548），秘密本身永不进入任何请求头/响应/日志。
- **不进命令行**：全文件无 `child_process`/`exec`/`spawn`；凭据经 `ctx.credentials.resolve` 读取后直接入内存变量。
- **不打日志**：全文件 4 处 `console.warn`（host.js:1832/1889/1903/1914）均为固定文案 + 异常 message，异常路径（fetch/JSON 解析）不携带响应体或请求头，**无密钥回显**。
- 签名作用域（host/service/region/path/host）全部为调用侧常量（`ce.us-east-1.amazonaws.com` / `sts.amazonaws.com` / `budgets.amazonaws.com`），无外部输入参与。

**结论：签名无侧信道（HMAC 常数时间、Node 原生实现）、密钥零外泄路径。**

### 1.4 「本会话」聚合（recordAccount null 处理） —— ✅ 通过（附 1 个低危观察）

**证据（host.js:892-895, 2010-2056）：**
- `recordAccount(r)` = `accountForProvider(r.provider)`：已知 provider → 精确字符串账户；**未知 → null（无主记录）**。
- `currentSessionSummary`：会话起点 = 当前 sessionId 最早记录 `ts`；聚合约 **`recordAccount(r) === activeAccount`**（严格相等）且 `ts >= sessionStart` 的全部记录。
- **null 处理正确性**：`activeAccount=null` 时严格匹配 `recordAccount(r)===null` 的无主记录——已知账户记录（deepseek 等）**绝不混入**无主视野；反之已知账户视野也绝不吸收无主记录。KNOWN/UNKNOWN 两桶隔离无串扰（单测覆盖：tests/test-spend-accounting.js:175-177 三会话同账户断言）。
- 窗口过滤 `r.ts < sessionStart → skip` 保证聚合不越界前移。

**低危观察（L1）**：当活跃 provider **自身未知**（如 anthropic/google/mistral 等未映射服务商）时，**所有无主记录共用一个 null 桶**——同一会话窗口内不同未知服务商的花费会被合并显示（如 Anthropic 与 Google 相加）。属**数据精度**问题而非权限/泄露问题（窗口受 `ts>=sessionStart` 限制、金额按币种分键）；且与既定用户决策一致（无 DSH 父子会话信号，取「同账户时间窗聚合」，见 MEMORY）。**建议**（后续版本可选）：未知服务商按 `r.provider` 维度拆桶，或客户端置灰「本会话」提示含未知源。

> 另注（信息级）：同一已知账户的**并行主会话**（非子代理）若 ts 落在窗口内也会并入——这是「同账户聚合」语义的固有取舍，已文档化（AGENTS.md / MEMORY.md），非缺陷。

### 1.5 依赖安全 —— ✅ 通过

**证据：**
- `plugin/package.json`：**无 dependencies 字段**（零运行时第三方依赖）；仅 `peerDependencies: react@^18`；build 仅用 `node:fs/promises`/`node:path`；host 仅用 `node:fs`/`node:crypto`/`node:os`/`node:path`。
- v1.7 diff 未新增任何依赖项。
- `.github/workflows/ci.yml`：仅官方 `actions/checkout@v7` + `actions/setup-node@v7`（v1.7 前已升到 v7 runtime，见 3af5c32），无第三方 action。

### 1.6 OWASP 输入验证（新适配器） —— ✅ 通过

**证据：**
- **provider id 白名单**：`accountForProvider`（host.js:90-107，未知→null）、`subscriptionSourceFor`（123-131）、`billingSourceFor`（134-140）、`BILLING_PROVIDERS`/`SUBSCRIPTION_PROVIDERS`（constants.js）、`setActiveProvider` 用 `Object.hasOwn(PROVIDERS, pid)`（host.js:2376）——全部显式白名单，**未知 id 永不触发凭据网络请求**。
- **URL 全部硬编码，外部数据仅经百分号编码**：
  - Fireworks `accountId`（来自 API 响应）→ `encodeURIComponent` 后拼路径（host.js:1231, 1241）✅
  - Cloudflare `accountId`（来自环境变量）→ `encodeURIComponent`（host.js:1339）✅
  - Bedrock `accountId`（STS 响应）→ 仅作 **JSON body 字段**（JSON.stringify，host.js:1326）✅
  - 小米 region → 常量映射（`xiaomiRegionBaseUrl`，332-336），无外部串 ✅
  - 全部 fetch host 为常量（见 1.3），**SSRF/路径注入不可达**。
- **RPC 侧**：POST body 64KB 上限（host.js:2430-2448）；非法 JSON → 400；未知 method → 404；`decodeURIComponent` 异常被外层捕获 → 500 不泄露内部（2492-2495）。
- **触发凭据请求的路由全部同源门禁**：`MUTATING = { setActiveProvider, setDisplayMode, setInfoDensity, getSubscriptionSnapshot, getBillingStatus }`（host.js:2413），`sameOrigin` 检查 `sec-fetch-site`（cross-site 直接拒）+ Origin-vs-Host 精确匹配（2415-2428）。跨站表单/脚本无法触发任何携凭据请求。
- **响应数据最小化**：六个适配器仅提取数字/有限字符串（spend/usage/percent/plan），原始响应体**不回显**客户端；错误信息为固定文案 + HTTP 状态码。

> 备注（信息级）：同源检查依赖浏览器 Origin/sec-fetch-site 头，理论上 DNS-rebinding 可绕过「Origin 与 Host 同域名」匹配；但本插件响应不可跨域读取（无 CORS 头）、请求目标与载荷全部固定、无外泄通道（密钥/响应均不出本机），实际危害上限为「向固定 AWS/CF 只读接口多发几次本地请求」，不构成凭据窃取。属 localhost 工具通用边界，非 v1.7 引入。

### 1.7 产物检查（lib/index.js、lib/client.js） —— ✅ 通过

**证据：**
- **无测试桩/调试标记**：对 `lib/index.js` 重跑 build.mjs 常量注入逻辑做逐字节 diff → 与「重建产物」**零差异**（仅首行生成头注释 `// Generated by scripts/build.mjs...`）。
- 锚点占位 `/*__SUBSCRIPTION_PROVIDERS__*/[]` / `/*__BILLING_PROVIDERS__*/[]` 在产物中**零残留**（grep 无匹配），常量已注入（index.js 含 xiaomi-token-plan-cn ×4、amazon-bedrock ×7）。
- 产物内 `console.error` 仅 1 处（lib/client.js:220「切换信息密度失败」）——合法用户可见错误，非调试残留；4 处 `console.warn` 均为记账失败提示，无密钥上下文。
- **无个人路径**：`/Users/`、`/home/`、开发者本机用户名在产物中零出现；作者署名 `SONGOAO25` 仅在 package.json 元数据。
- 分发白名单 `package.json "files"` = `lib` + `cordis.patch.yml` + `README` + `LICENSE`；tests/docs 不入包。

---

## 2. 问题清单（按风险分级）

| # | 级别 | 描述 | 位置 | 处置建议 |
|---|---|---|---|---|
| L1 | **低** | 未知服务商（activeAccount=null）共桶聚合：窗口内不同未知 provider 花费合并显示，属跨服务商数据精度问题 | host.js:2035 | 可选：按 provider 拆桶或客户端标注「含未知服务商」；不影响 v1.7 发布 |
| I1 | 信息 | 同源门禁依赖浏览器头，DNS-rebinding 理论可绕过；无实际利用链（响应不可读、端点固定、无外泄） | host.js:2415-2428 | 记录在案，不阻塞发布 |
| I2 | 信息 | JWT 解码无长度/签名校验 | host.js:292-304 | 本地文件输入、失败全降级，保持现状 |

**高/中危：无。**

---

## 3. 与上轮审计清单对照（延续项全部保持通过）

| 清单项 | v1.6 | v1.7 |
|---|---|---|
| 无硬编码密钥/令牌 | ✅ | ✅（含 93 commits 全历史） |
| 无个人路径泄露 | ✅ | ✅（全树 + 产物） |
| 凭据只进 HTTP 头，不落盘、不打日志 | ✅ | ✅（+SigV4 密钥仅内存 HMAC） |
| JWT 解码安全（无 XSS、无注入） | —（v1.7 新增项） | ✅ |
| SigV4 密钥不出本机 | —（v1.7 新增项） | ✅ |
| 新适配器输入验证 | —（v1.7 新增项） | ✅（provider 白名单 + URL 硬编码 + encodeURIComponent） |
| 产物洁净 | ✅ | ✅（重建 diff 零差异） |

---

## 4. 审计结论

**v1.7（含「本会话」聚合 + 六项新适配器）达到可发布安全基线。** 无硬编码密钥、无 XSS/JWT 注入、SigV4 密钥零外泄、凭据仅存于 HTTP 头并受同源门禁保护、输入全部白名单/编码约束、零新增依赖、产物与源码一致。L1 观察项不阻塞发布，建议记入 ROADMAP 作为后续迭代的可选改进（未知服务商拆桶）。

（本轮审计未修改任何源码。）
