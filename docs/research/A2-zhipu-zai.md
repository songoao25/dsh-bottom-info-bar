# A2 调研：智谱 Z.ai / GLM 在底部信息栏插件的适配可行性

> 调研对象：`zai` / `zai-coding-cn` 两个 DSH 内置 provider（智谱国际 api.z.ai + 国内 open.bigmodel.cn）。
> 范围：GLM Coding Plan 套餐额度制 + 普通 GLM API 按量计费两种消费方式。
> 调研方法：直接阅读 DSH 内置 pi-ai 源码 + 官方文档站 + 四个社区实现（CodexBar / tokn / zai-quota / 智谱官方 glm-plan-usage 插件）。
> 状态：以 2026 年社区验证版本为准，每条结论标注来源；不确定处标"待核实"。

---

## 0. DSH 内置实现（本地源码核实，非猜测）

来源：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/dist/providers/`
下 `zai.js`、`zai-coding-cn.js`、`env-api-keys.js`、`zai.models.js` 与 `data/zai.json`。

| 项目 | `zai`（国际） | `zai-coding-cn`（国内） |
|---|---|---|
| DSH provider id | `zai` | `zai-coding-cn` |
| 显示名 | Z.AI | Z.AI Coding CN |
| baseUrl | `https://api.z.ai/api/coding/paas/v4` | `https://open.bigmodel.cn/api/coding/paas/v4` |
| API 环境变量 | `ZAI_API_KEY` | `ZAI_CODING_CN_API_KEY` |
| API 风格 | OpenAI Completions 兼容 | OpenAI Completions 兼容 |
| 内置模型 | glm-4.5-air / glm-4.7 / glm-5-turbo / glm-5.1 / glm-5.2 / glm-5v-turbo | 同左 |
| 模型 cost | 全部为 0（in/out/cache 均 0） | 同左 |

要点：

- 两个 provider 都走 `coding/paas/v4`（GLM Coding Plan 套餐专用入口），DSH 已按"套餐额度制免费"处理 cost=0。
- **没有内置普通 GLM 按量计费 provider**（普通 API 是另一入口 `/api/paas/v4`，用户需自配）。

---

## 1. 逐项答问（14 项）

### 1.1 DSH provider id
`zai`（国际）、`zai-coding-cn`（国内）。唯一可信来源是本机 pi-ai 源码（见第 0 节），于 `/node_modules/@earendil-works/pi-ai/dist/env-api-keys.js` 第 88–89 行与 `zai.js` / `zai-coding-cn.js` 确认。

### 1.2 DSH 认证方式
环境变量 API Key：`ZAI_API_KEY` / `ZAI_CODING_CN_API_KEY`。调用模型时走 OpenAI 兼容的 `Authorization: Bearer <key>`。来源：pi-ai `env-api-keys.js`、`zai.js`。

### 1.3 消费方式
两种并存：

- **套餐额度制**：GLM Coding Plan（Lite / Pro / Max 三档，按 Credits 计额，非现金消耗）——DSH 内置的两个 provider 即此模式。
- **按量计费**：普通 GLM API（`open.bigmodel.cn` 或 `api.z.ai` 的 `/api/paas/v4`），现金余额扣费，非 DSH 内置。

### 1.4 官方 Balance API
**没有任何公开文档**。社区发现一个 CN 专属接口：`GET https://www.bigmodel.cn/api/biz/account/query-customer-account-report`。注意是 `www.bigmodel.cn` 控制台域（非 `open.` API 域）。返回 `data.availableBalance / balance / rechargeAmount / giveAmount / totalSpendAmount`；认证 Bearer 或裸 Key 均可（2026-08 实测）。**z.ai 国际无对应接口**——国际端余额显示待核实。来源：[CodexBar PR #3109](https://github.com/steipete/CodexBar/pull/3109)。

### 1.5 官方 Usage API
无公开文档。实际存在的用量接口（官方插件与社区项目均使用）：`GET {host}/api/monitor/usage/model-usage?startTime=...&endTime=...(&type=3)`，返回 `data.x_time[]`（时间轴）+ `data.modelDataList[].modelName/.tokensUsage[]`（各模型 token 序列），可画小时/日用量图。来源：[智谱官方 glm-plan-usage 插件 query-usage.mjs](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)、[CodexBar zai.js](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/zai.js)。

### 1.6 官方 Subscription/Plan API
**无**。套餐信息只能从 quota 接口的响应字段里取（见 1.9 / 1.10）。账号管理/续费走网页控制台，无 API。

### 1.7 Rate Limit 是否从 Response Headers 返回
**否**。额度全部在 JSON body（`data.limits[]`），无 `X-RateLimit-*` 头。响应里可能出现 `RATE_LIMIT`/`TIMES_LIMIT`/`SESSION_LIMIT` 类型条目，但社区实现均忽略（CodexBar 只解析 `TOKENS_LIMIT`/`TIME_LIMIT`/`CREDIT_LIMIT`）。来源：[CodexBar zai.js parseLimit](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/zai.js)。

### 1.8 Reset Time
`nextResetTime`，unix **毫秒**时间戳，每条 limit 独立返回，可转倒计时。规则：

- TOKENS_LIMIT (unit=3, number=5)：**5 小时滚动窗口**，消耗后 5 小时动态重置；
- TOKENS_LIMIT (unit=6, number=1)：每周窗口，订阅激活后每 7 天重置；
- TIME_LIMIT：MCP 月度窗口（unit/number 有特殊标记，CodexBar 按 30 天处理）。

来源：[docs.z.ai/devpack/overview](https://docs.z.ai/devpack/overview)（"5-hour credits: Dynamically refreshed; credit quota resets 5 hours after consumption"）、[tokn quota.rs](https://github.com/agentic-rs/tokn/blob/main/crates/provider-zai/src/quota.rs)、[智谱官方使用须知](https://docs.bigmodel.cn/cn/coding-plan/usage-notes)。

### 1.9 套餐名
- 官方公开套餐名：**Lite / Pro / Max**（[docs.z.ai/devpack/overview](https://docs.z.ai/devpack/overview)）。
- quota 接口返回 `data.level`（实测见过 `lite`/`standard`/`pro`、`PRO` 等，大小写与取值两端不一致，**精确映射待核实**）。
- CodexBar 兜底取 `data.planName / plan / plan_type / packageName / level` 中第一个非空字符串作显示名。来源：[CodexBar zai.js](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/zai.js)、[SeeYangZhi/zai-quota](https://github.com/SeeYangZhi/zai-quota/)。

### 1.10 可展示字段（Balance/Used/Remaining/Percentage/Reset/Expiration）
quota 响应 body 提供：`limits[].percentage`（已用%）、`usage`（额度上限）、`currentValue`（当前已用）、`remaining`（剩余）、`nextResetTime`（重置时间戳）、`usageDetails[].modelCode/.usage`（TIME_LIMIT 按模型细分）。Balance（CN 专属）另有 `availableBalance/balance/totalSpendAmount`。注意事项：

- TIME_LIMIT 的字段语义与 TOKENS_LIMIT 略有出入：TIME_LIMIT 的 `usage` 实为上限、`currentValue` 为已用（[tokn quota.rs 注释](https://github.com/agentic-rs/tokn/blob/main/crates/provider-zai/src/quota.rs)）；
- 按量余额无 "Expiration"（现金不过期）；
- 套餐额度本身显示 used% + remaining + reset 倒计时，就是信息栏需要的形态。

### 1.11 无接口时能否本地 Token Usage × 官方价格计算
**可**。DSH 已记录每次调用 token 用量（插件现有 spend 记账可复用）。套餐外价格：GLM-4.5-Air 文档页标注"输入 0.8 元/百万 tokens、输出 2 元/百万 tokens"（[GLM-4.5 文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5)）；完整价目以 [open.bigmodel.cn/pricing](https://open.bigmodel.cn/pricing) 为准（JS 动态渲染页，**具体金额待核实、随版本变动**；GLM-4.5 已列"即将下线"，现主力 GLM-4.7 / GLM-5.x）。→ 结论：本地估算可行，作为 pay_as_you_go 模式的兜底方案。

### 1.12 是否需要用户额外提供权限
**不需要**。完全复用 DSH 环境变量 `ZAI_API_KEY` / `ZAI_CODING_CN_API_KEY` 即可打到 quota 端点，**禁止让用户重复填 Key**。例外：团队版额度需要额外头 `Bigmodel-Organization` / `Bigmodel-Project` 与 `type=2/3` 参数（CodexBar 团队 scope），个人版用不到 → 默认实现个人版即可。

### 1.13 区分公开官方 API 与网页私有 API
- **公开官方 API**：模型调用接口（`/api/paas/v4`、`/api/coding/paas/v4` 的 chat/completions 等）、官方文档站、价格页。
- **网页私有 API（本调研核心）**：`quota/limit`、`model-usage`、`query-customer-account-report` 均属此类——官方从未在 API 文档公开这些端点 URL，只发布封装好的 Claude Code 插件 [glm-plan-usage](https://docs.bigmodel.cn/cn/coding-plan/extension/usage-query-plugin)，端点藏在插件源码里，正是"用私有接口实现官方功能"的证据。

### 1.14 稳定性分级（A–E，A=官方文档化长期稳定，E=随时失效）
- **quota 接口 `GET /api/monitor/usage/quota/limit`：B/C 级（非官方文档化）**。社区多项目生产验证多年（CodexBar #346/#662/#913、tokn、zai-quota、智谱官方插件全在依赖），但无文档、且发生过 schema 变更（[CodexBar PR #346](https://github.com/steipete/CodexBar/pull/346) 专门处理 "missing token limit fields"）。tokn 自述 "community-reverse-engineered"。定级 B-偏 C。
- **balance 接口（CN 专属）：C 级**。2026-08 新发现、仅 CN、无文档。
- **model-usage 接口：B/C 级**。官方插件在用，但同样无文档。

均衡结论：稳定性足以支撑"信息展示型"集成，不足以支撑任何写操作；全部按失败降级处理。

---

## 2. 适配方案（10 项）

### 2.1 可展示字段
套餐名（Lite / Pro / Max）；5 小时滚动额度 used% + 剩余 + 重置倒计时；每周额度%；MCP 月度用量%（含按模型细分）；**峰值/谷值状态与倒计时**（复用插件现有"高峰低谷"特性）；按量计费余额（仅 CN：`¥xx.xx` + 已充值/赠金/已消费明细）。

### 2.2 获取方法
- 套餐额度：`GET {host}/api/monitor/usage/quota/limit`（主通道，一次到位）；
- 按量余额：`GET https://www.bigmodel.cn/api/biz/account/query-customer-account-report`（CN 可选，失败不影响主显示）；
- 峰值/谷值：**纯本地时钟计算**，无任何接口（CodexBar 注释确认："No z.ai endpoint exposes this - purely a function of the injected clock"）。

### 2.3 Endpoint
| 用途 | 国际（zai） | 国内（zai-coding-cn） |
|---|---|---|
| 套餐额度 | `https://api.z.ai/api/monitor/usage/quota/limit` | `https://open.bigmodel.cn/api/monitor/usage/quota/limit` |
| 模型用量 | `https://api.z.ai/api/monitor/usage/model-usage` | `https://open.bigmodel.cn/api/monitor/usage/model-usage` |
| 按量余额 | 无（待核实） | `https://www.bigmodel.cn/api/biz/account/query-customer-account-report` |

### 2.4 Auth
**裸 API Key，无 Bearer 前缀**（`Authorization: <key>`）——对齐智谱官方控制台 XHR（tokn 源码注释 "confirmed against the official z.ai dashboard XHR"）与官方插件（[query-usage.mjs](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs) 直接 `Authorization: authToken`）。已知 Bearer 也普遍被接受（CodexBar 即用 Bearer）：建议主用裸 Key，401 时回退 Bearer 再报错，兼容性最优。

### 2.5 请求示例（脱敏）
```
GET https://api.z.ai/api/monitor/usage/quota/limit
Authorization: <ZAI_API_KEY 裸值>
Accept-Language: en-US,en
Content-Type: application/json
（超时 5s；对齐 tokn / CodexBar 生产取值）
```

### 2.6 Response 示例（脱敏）
quota（取自 tokn 官方测试样例，非真实账户数据）：
```json
{
  "success": true, "code": 200,
  "data": {
    "level": "PRO",
    "limits": [
      {"type": "TOKENS_LIMIT", "unit": 3, "number": 5, "percentage": 18.5,
       "total": 6000000, "nextResetTime": 1735000000000},
      {"type": "TOKENS_LIMIT", "unit": 6, "number": 1, "percentage": 47.2,
       "total": 80000000, "nextResetTime": 1735500000000},
      {"type": "TIME_LIMIT", "percentage": 4.0, "currentValue": 12,
       "usage": 300, "nextResetTime": 1736000000000}
    ]
  }
}
```
balance（CN，结构参考 CodexBar #3109，数值为虚构）：
```json
{"success": true, "data": {"availableBalance": 123.45, "balance": 123.45,
 "rechargeAmount": 200.0, "giveAmount": 10.0, "totalSpendAmount": 86.55}}
```

### 2.7 刷新频率建议
- quota：**5 分钟**一次（5 小时滚动窗口，无需更频；避免触发风控）；
- balance（CN）：30–60 分钟一次；
- 峰值/谷值状态与倒计时：每次渲染本地即时重算（依赖注入时钟，不请求网络）。

### 2.8 错误处理
- 401 → 提示密钥无效/过期；非 200、`success !== true`、`limits` 缺失 → 显示"额度不可用"占位，**绝不阻断主界面**；
- 单条 limit 缺字段容错（PR#346 教训：percentage 缺失时可按 usage/remaining/currentValue 推算）；
- quota / model-usage / balance 三者独立请求、独立降级，互不拖累；
- 5s 超时静默降级；不做重试风暴。

### 2.9 安全风险
- Key 仅发往 HTTPS 端点；日志与 UI 输出严禁出现完整 Key；
- 复用 DSH 环境变量、零 Key 落盘（符合仓库"零密钥"分发铁律）；
- 非官方接口可能 404 / 改结构 / 收费策略调整 → 按"纯信息展示、失败降级"处理，不做任何写操作；
- 低频轮询（≥5 分钟）避免触发套餐风控（官方使用须知明确有风控限流机制）。

### 2.10 是否推荐正式集成 + billingMode 分类
**推荐正式集成（高价值、可接受风险）**，理由：

1. DSH 已内置 provider 即套餐制，quota 接口是唯一能显示"剩余额度 / 重置倒计时"的来源；智谱官方自己的 Claude Code 插件就在用同一批端点（间接背书，非纯社区 hack）；
2. 峰值/谷值 priced info 直接复用插件现有逻辑，官方文档确认 credit 制 1x / 0.5x 与高峰时段（[docs.z.ai/devpack/overview](https://docs.z.ai/devpack/overview)）；
3. 社区多项目 2 年生产验证 + 结构容错已有成熟范式。

**billingMode 分类**：

- `zai` / `zai-coding-cn`（内置）→ **`coding_plan`**（套餐额度制，Credit 配额，DSH cost=0 语义正确，零金额显示）；
- 用户自配普通 GLM API（`/api/paas/v4`，非内置）→ **`pay_as_you_go`**（余额制：CN 用 balance 接口；无接口/国际端用本地 token × 官方价估算兜底）。

---

## 3. 峰值/谷值定价（"高峰低谷"特性的数据基础）

- 高峰：**周一至周五 14:00–18:00 新加坡时间（UTC+8）= UTC 06:00–10:00**；周末全天谷值；
- 谷值时段 credit 费率 **50%**（标准费率 0.5 倍）；
- 官方原话："During off-peak hours, model usage is charged at 50% of the standard credit rate. Peak hours: Monday to Friday, 14:00–18:00 Singapore Standard Time (UTC+8)."（[docs.z.ai/devpack/overview](https://docs.z.ai/devpack/overview)）；
- Credit 折算公式：`(输入×6.9 + 缓存×1.7 + 输出×24) / 10000`（GLM-5.3 档）；GLM-5.3-Flash 为 2.3 / 0.56 / 8——**multiplier 随模型换代而变，须跟随官方文档维护**；
- 套餐额度：Lite 5h/周 = 2000 / 10000；Pro = 12000 / 60000；Max = 28000 / 140000 credits。
- 无任何 endpoint 暴露该状态，纯本地时钟函数（CodexBar 注释确认）。

## 4. 与插件现状的对接点

1. **复用凭据**：插件按"当前使用的 provider"选择 `ZAI_API_KEY`（国际）或 `ZAI_CODING_CN_API_KEY`（国内）与对应 host，零新增用户配置；
2. **互斥模式**：`zai` / `zai-coding-cn` 进 `coding_plan` 分支（显示额度 % + 倒计时，与 Codex / OpenCode Go 订阅模式并列）；普通 GLM 按量计费进余额制分支——两分支不重叠，符合插件 DUAL-MODE 设计；
3. **真实数据验证**：用户已绑定智谱 Key（ZAI_API_KEY / ZAI_CODING_CN_API_KEY），可直接做真实验证。

## 5. 参考来源清单

- DSH 内置：pi-ai `dist/providers/zai.js`、`zai-coding-cn.js`、`env-api-keys.js`、`zai.models.js`（本机源码，路径见第 0 节）
- 智谱官方文档：[docs.z.ai/devpack/overview](https://docs.z.ai/devpack/overview)（Credit 制 / 峰值定价 / 套餐额度）、[docs.bigmodel.cn/cn/coding-plan/usage-notes](https://docs.bigmodel.cn/cn/coding-plan/usage-notes)（使用须知 / 续费 / 并发 / 风控）、[用量查询插件](https://docs.bigmodel.cn/cn/coding-plan/extension/usage-query-plugin)（官方插件说明）、[GLM-4.5 文档](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5)（价格标注）、[GLM-4.6](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.6) / [GLM-4.7](https://docs.bigmodel.cn/cn/guide/models/text/glm-4.7)、[open.bigmodel.cn/pricing](https://open.bigmodel.cn/pricing)
- 智谱官方插件源码：[zai-org/zai-coding-plugins（glm-plan-usage/query-usage.mjs）](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)
- 社区实现：[CodexBar zai.js + PR #346 / #662 / #913 / #3109](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Resources/Plugins/zai.js)、[tokn provider-zai quota.rs](https://github.com/agentic-rs/tokn/blob/main/crates/provider-zai/src/quota.rs)、[SeeYangZhi/zai-quota](https://github.com/SeeYangZhi/zai-quota/)

## 6. 明确"待核实"项

- `data.level` 取值（`lite/standard/pro` vs `PRO`…）与官方套餐名（Lite / Pro / Max）的精确映射；
- 新 credit 制 `CREDIT_LIMIT` 条目是否沿用 TOKENS_LIMIT 的 unit/number 语义（CodexBar 已同构解析，未单独验证）；
- 普通 GLM API（`/api/paas/v4`）在 z.ai 国际端是否有隐藏 balance 端点（目前仅 CN `www.bigmodel.cn` 已知）；
- GLM-4.6 / 4.7 精确单价（pricing 页 JS 渲染，静态抓取失败；仅 GLM-4.5-Air 有文档页标注）；
- 个人版 quota 响应是否同时含 CREDIT_LIMIT（老用户可能纯 TOKENS_LIMIT——CodexBar 两者兼容，适配时应两种都处理）。