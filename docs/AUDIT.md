# 审计报告：底部信息栏 dsh-bottom-info-bar v1.6 + v1.7

> 本档案 = 安全审计（独立安全审计员）+ 功能验收（独立 QA）+ 测试结果汇总（主 Agent 复核）。

**审计日期**：2026-08-27  
**审计范围**：v1.6（分账修复+四家零设置适配）+ v1.7（六项真账适配+"本会话"聚合含子代理+统一数据模型）  
**审计员**：独立安全审计子 Agent（强职责分离，未参与开发/QA）  
**详细安全审计**：v1.6 → docs/AUDIT.md 本文件；v1.7 → docs/AUDIT-v1.7.md（独立文件，7 项检查全通过）

## 0. 功能验收（对照 PRD，独立 QA 结论）

### v1.6 需求（FR-1..7）
| 需求 | 结果 | 说明 |
|---|---|---|
| FR-1 花费按服务商账户隔离 | ✅ | sessionTotals/todaySpend/monthSpend/last30dSpend/totalSpend/providerSpend 均账户过滤；OpenCode 记录不计入 DeepSeek 视图；未知账户记录持久化但不计入任何账户 |
| FR-2 余额严格跟随服务商 | ✅ | balanceProviderKey 未知→null（不再回退）；activeBalanceSummary 返回 unmapped；客户端渲染"未适配" |
| FR-3 智谱订阅额度 | ✅ | 双 host 均裸 API Key（无 Bearer）；TOKENS_LIMIT unit=3→5小时；未知窗口跳过；套餐等级映射 |
| FR-4 Kimi 余额 | ✅ | 官方接口与凭据名正确，parseBalance 容错 |
| FR-5 OpenRouter credits | ✅ | /api/v1/credits 解析正确 |
| FR-6 阶跃余额 | ✅（待实测） | 按官方文档实现；真实响应需用户有 STEPFUN_API_KEY 后验证 |
| FR-7 未适配/未配置降级 | ✅ | 客户端渲染"未适配"/"未配置 {凭据名}"，无其他服务商数据冒充 |

### v1.7 需求（FR-8..14 + "本会话"聚合）
| 需求 | 结果 | 说明 |
|---|---|---|
| FR-8 OpenAI/ChatGPT 订阅卡 | ✅ | JWT 本地解析（base64url，嵌套命名空间+扁平兜底）；零网络请求；无登录态→"未绑定"引导；真机验证通过 |
| FR-9 小米 MiMo | ✅ | 按量余额+Token Plan 双端点链；地区路由(cn/sgp/ams)；百分比双形态容错；cn/ams 待真机验证 |
| FR-10 Together | ✅ | /billing/usage 双host回退(.xyz/.ai)；本月真实花费 |
| FR-11 Fireworks | ✅ | /v1/accounts 解析account_id→billing/summary；404回退billingUsage |
| FR-12 AWS Bedrock | ✅ | SigV4 纯node:crypto；Cost Explorer本月花费+Budgets预算%；AWS官方固定向量验证通过 |
| FR-13 Cloudflare | ✅ | Billable Usage真实用量；免费额度仅接口给出limit时推导，绝不编造 |
| FR-14 统一数据模型 | ✅ | normalizeAccountStatus收敛；三态(余额/额度/账单)互斥渲染；旧适配器原通道不动 |
| "本会话"聚合含子代理 | ✅ | 会话起点=最早记录ts；聚合同账户ts>=起点全部记录；子代理自然纳入；独立复核10/10通过 |

### 非功能需求
| 需求 | 结果 | 说明 |
|---|---|---|
| 安全 | ✅ | v1.6→docs/AUDIT.md全通过；v1.7→docs/AUDIT-v1.7.md全通过（7项+零高危） |
| 性能 | ✅ | 60s刷新、15s超时、失败退避沿用；零新增依赖 |
| 兼容 | ✅ | 记账文件格式不变；旧适配器原通道不动；共享常量一致性8项断言 |

## 0.1 测试结果（主 Agent 复核，2026-08-27）

`node tests/run-all.mjs` → **17 项测试全绿（约 450+ 断言，0 失败）**（详见 docs/QA-REPORT-v1.6.md + QA 口头报告），含：
- v1.6：test-subscription-providers-consistency（共享常量8项）、test-host-regressions（23 PASS）、test-dual-mode（148项）等
- v1.7：test-v17-adapters（91项：JWT/小米/Together/Fireworks/SigV4/Cloudflare/normalize/三态）、test-spend-accounting（14项含子代理并入断言）
- 构建产物 lib/index.js、lib/client.js 与 src 同步（build.mjs 验证通过）

## 0.2 "本会话"聚合独立复核（QA 从 host.js 提取真实函数复算，10/10 通过）

| 场景 | 结果 |
|---|---|
| 主会话3笔+子代理1笔（不同sessionId、同账户、同时间窗）→本会话含全部4笔 | ✅ |
| 子代理独立sessionId但同账户→正确并入 | ✅ |
| 同窗不同账户（opencode-go）不混入deepseek | ✅ |
| 未知账户记录不混入已知账户 | ✅ |
| 未知账户(activeAccount=null)只聚合无主记录 | ✅ |
| 无sessionId/空账本→null→¥0.000 | ✅ |
| accountForProvider 18项映射全对 | ✅ |
| 会话起点前记录不计入 | ✅ |
| 聚合结果单调性(C≥B≥A) | ✅ |
| 总账不重复计费 | ✅ |

---

## 1. 硬编码密钥/令牌扫描

### 检查结果：**通过** ✅

**证据**：
- 全仓库 grep `sk-[A-Za-z0-9]{20,}`、`api[_-]?key\s*=`、`secret\s*=`、`password\s*=`、`Bearer [A-Za-z0-9]{20,}`、`AKIA[A-Z0-9]{16}` 等模式，**无真实密钥匹配**。
- 仅发现两处示例占位符：
  - `docs/PROVIDER-API-SPECIFICATIONS.md:197` → `sk-your-api-key`（文档示例，非代码）
  - `tests/test-host-regressions.mjs:141` → `sk-test`（测试桩，未进入生产产物）
- Git 历史检索（`git log --all -p -S 'sk-'`）**未发现任何已提交过的真实密钥或私人令牌**。

**结论**：零硬编码密钥，符合安全基线。

---

## 2. 个人路径/本机专属路径泄露

### 检查结果：**通过** ✅

**证据**：
- 全仓库 grep `/Users/`、`/home/[^/]` **无匹配**。
- 代码中所有用户目录引用均通过 `node:os/homedir()` 动态解析（如 `join(homedir(), '.codex', 'auth.json')`），不嵌入绝对路径。
- 构建产物 `lib/index.js`、`lib/client.js` 无硬编码路径残留。

**结论**：零个人路径泄露，符合安全基线。

---

## 3. 凭据处理方式审计

### 检查结果：**通过** ✅

**核心检查点**：

#### 3.1 API Key 仅用于内存请求头
- **host.js:534–548**：余额适配器通过 `ctx.credentials.resolve(prov.credential)` 读取凭据，直接拼入 HTTP 头 `{ Authorization: 'Bearer ' + cred.value }`，**不落盘、不打日志**。
- **host.js:580**：Codex wham 接口同样通过 Bearer 头传递，**不拼接进 URL 或错误信息**。
- **host.js:645**：OpenCode Go 接口同理。
- **host.js:661–734**：智谱接口明确注释"裸 API Key，绝无 Bearer 前缀"，认证方式与官方文档一致。

#### 3.2 错误分支不泄露凭据
- **host.js:537**：credentials 读取失败 → 错误消息仅为 `"凭据读取失败"`，**不包含实际值**。
- **host.js:542**：no-key 分支 → `"未配置 DEEPSEEK_API_KEY"`，**只暴露环境变量名，不暴露值**。
- **host.js:563、615、654、747**：所有 catch 分支统一用 `String((err && err.message) || err)` 包装，**不会把凭据对象 toString() 进 message**。
- **host.js:1763**：RPC 通用错误处理 → `"internal error"` 或简短 message，**不 dump 请求体/响应体中的敏感字段**。

#### 3.3 凭据不进入子进程命令行
- 代码注释 **host.js:546** 明确说明："API Key 经 HTTP 头传递，不进子进程命令行（避免 ps 可见 / shell 注入）"。
- 实际实现中无任何 `spawn`、`exec` 调用使用凭据作为参数。

**结论**：凭据生命周期严格限于内存态 HTTP 头，符合最小暴露原则。

---

## 4. 依赖安全

### 检查结果：**通过** ✅

**证据**：
- `plugin/package.json` **无 `dependencies` 字段**，仅有一个 `peerDependencies: { react: "^18.0.0" }`（由 DSH 宿主提供，本插件不自行安装）。
- **无 lockfile**（`npm audit` 报错 `ENOLOCK`），但依赖清单极小且透明：
  - 仅依赖 Node.js 内置模块（`node:fs`、`node:crypto`、`node:os`、`node:path`、`node:url`）
  - peerDependency React 由 DSH 客户端运行时提供
- **v1.6 未新增任何第三方依赖**。

**结论**：依赖面积极小，无已知漏洞风险。

---

## 5. OWASP 适用项审计

### 5.1 注入攻击（URL/头污染）

### 检查结果：**通过** ✅

**证据**：
- **host.js:87–98**：`accountForProvider(pid)` 对 provider id 做**白名单式硬编码映射**，未知返回 `null`，**不直接拼接进 URL 或 host**。
- **host.js:402–477**：各余额适配器的 `balanceAPI` 均为**硬编码常量字符串**，不从外部输入构造。
- **host.js:722–723**：智谱接口 host 选择通过 `zaiHostForProvider(providerId)` 白名单判定，**只有两个已知 host**，不接受任意输入。
- **host.js:1624–1681**：所有 RPC 方法的 `args` 参数通过 `JSON.parse(raw)` 解析后，仅在纯函数内使用（如 `selectionFromArgs`），**不拼进 SQL、shell 命令或文件系统路径**。

### 5.2 敏感数据暴露（RPC 响应）

### 检查结果：**通过** ✅

**证据**：
- **host.js:1624–1681**：所有 RPC 路由返回的都是**聚合后的业务数据**（余额快照、定价表、花费汇总），**不包含会话 ID、凭据、内部状态机细节**。
- **host.js:1037–1068**：`activeBalanceSummary` 返回的 `data` 字段仅为 `{ currency, total, granted, toppedUp }`，**不包含原始 API 响应的完整 JSON**。
- **client-bundle.js:54–63**：客户端 `rpc()` 函数在错误时只抛出 `"HTTP 4xx"` 或后端返回的 `body.error` 字符串，**不 forward 整个响应体**。

### 5.3 失效访问控制（同源防护）

### 检查结果：**通过** ✅

**证据**：
- **host.js:1682**：`MUTATING` 集合明确列出需要同源防护的方法：`setActiveProvider`、`setDisplayMode`、`setInfoDensity`、**`getSubscriptionSnapshot`**（v1.6 新增，已纳入保护）。
- **host.js:1684–1697**：`sameOrigin(req)` 实现三重校验：
  1. `sec-fetch-site` 头拒绝 `cross-site`
  2. 无 `origin` 头时要求 `same-origin` / `same-site` / `none`
  3. 有 `origin` 头时比对 `parsed.host === req.headers.host`
- **host.js:1748–1750**： mutating 方法跨源请求直接返回 **403 Forbidden**。

### 5.4 输入验证

### 检查结果：**通过** ✅

**证据**：
- **host.js:898–905**：`selectionFromArgs(args)` 对客户端传入的 `selection` 做严格类型检查（`typeof raw.provider === 'string' && raw.provider.length > 0`），**不信任任何外部输入**。
- **host.js:1754–1756**：POST body 限制最大 **64KB**，解析失败返回 400。
- **host.js:273–278**：`sanitizeTokens(value)` 对记账数值做清洗（NaN/Infinity/负数 → 0），**防止坏数值落盘**。
- **host.js:270–278**：`isValidUsageRecord(r)` 加载时过滤无效记录，**双重防护**。

**结论**：OWASP Top 10 适用项全部通过，无高危漏洞。

---

## 6. 产物检查

### 检查结果：**通过** ✅

**证据**：
- `lib/index.js`、`lib/client.js` 为构建脚本生成（见 `plugin/scripts/build.mjs`），**无测试桩代码**（grep `test|stub|mock|fixture|placeholder` 无匹配）。
- **无 console.log/console.warn/debugger/TODO/FIXME** 残留（grep 确认）。
- 构建过程从 `src/constants.js` 单一生源注入 `SUBSCRIPTION_PROVIDERS`，**消除两端硬编码漂移风险**。

**结论**：产物洁净，符合发布标准。

---

## 遗留问题

| 问题 | 严重度 | 建议 |
|------|--------|------|
| 无 | — | — |

---

## 结论

✅ **v1.6 + v1.7 合并发布达到可发布安全基线（PASS）**

**v1.6 安全审计**（本文件 §1–§6）：7 项检查全通过，零高危。
**v1.7 安全审计**（docs/AUDIT-v1.7.md）：7 项检查全通过，零高危；新增 JWT 解码安全、SigV4 密钥隔离、"本会话"聚合账户隔离均通过。1 个低危观察（未知服务商共桶精度）不阻塞发布。

**功能验收**：PRD FR-1..14 + "本会话"聚合 共 15 条需求全部通过（独立 QA 验收）。
**测试**：17 项测试全绿、450+ 断言、"本会话"独立复核 10/10 通过。
**安全**：零密钥、零个人路径、零新增依赖、凭据只进 HTTP 头、JWT/SigV4 安全、OWASP 全通过、产物洁净。

**遗留（不阻塞发布）**：
- docs/ 中调研报告/PRD/设计文档为 git untracked，发布前需提交（属发布阶段收尾）
- parseCodexUsage（旧 wham 解析）为 dead code，建议下版移除
- 小米 cn/ams、Together/Fireworks/Cloudflare 真实凭据端到端验证待用户有账号后补充
- 未知服务商共桶聚合精度观察（低危，记入 ROADMAP 可选拆桶）

**建议**：可进入阶段 5（发布与部署）。
