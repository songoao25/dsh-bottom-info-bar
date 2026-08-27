# A4 调研：阿里云百炼 Qwen Token Plan × 小米 MiMo Token Plan —— 底部信息栏适配可行性

**调研日期**: 2026-08-27 ｜ **调研人**: 调研工程师（子 Agent）｜ **方法**: 官方文档抓取 + 开源实现逆向交叉验证 + 本地 DSH 内置 provider 源码核对
**可信度标记**: 🟢 官方文档 ｜ 🔵 社区逆向（多实现验证）｜ 🟡 待核实（信息冲突/缺失）
**研究对象**: `qwen-token-plan` / `qwen-token-plan-cn`（阿里云百炼 Token Plan、CN/国际双端点）、`xiaomi`（MiMo 按量）、`xiaomi-token-plan-cn` / `-ams` / `-sgp`（MiMo Token Plan 三集群）

### 稳定性分级约定（A–E，本项目沿用）

| 级 | 含义 | 适用 |
|---|---|---|
| A | 官方文档化、接口稳定 | 如 DeepSeek /v1/user/balance |
| **B** | 未文档化但鉴权＝API Key、多开源实现交叉验证、字段稳定 | 小米 /v1/user/balance、/v1/tokenPlan/usage（sgp） |
| C | 文档不全或字段易变，需持续跟进 | — |
| **D** | 网页私有接口（Cookie/CSRF/OAuth 登录态），脆弱易碎 | 百炼控制台网关、小米平台 Cookie 端点 |
| E | 不可用 / 需人工介入 | API Key 路径下的百炼额度查询 |

API 分级：**公开官方 API**（A/B，可用用户既有凭据）vs **网页私有 API**（D，需登录态/抓取，仅留档）。

---

## 0. DSH 内置 provider 事实（本地源码确认）

来源：`@earendil-works/pi-ai/dist/providers/{qwen-token-plan,qwen-token-plan-cn,xiaomi,xiaomi-token-plan-*}*.js`（平铺在 `/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/node_modules/@earendil-works/pi-ai/`）

| provider id | baseUrl | 内置凭据 env | 模型 cost |
|---|---|---|---|
| `qwen-token-plan` | `https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_API_KEY` | 全 0（套餐制） |
| `qwen-token-plan-cn` | `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1` | `QWEN_TOKEN_PLAN_CN_API_KEY` | 全 0（套餐制） |
| `xiaomi`（按量） | `https://api.xiaomimimo.com/v1` | `XIAOMI_API_KEY` | 有单价（如 mimo-v2-flash input 0.14 / output 0.28） |
| `xiaomi-token-plan-cn` | `https://token-plan-cn.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_CN_API_KEY` | 全 0（套餐制） |
| `xiaomi-token-plan-ams` | `https://token-plan-ams.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` | 全 0（套餐制） |
| `xiaomi-token-plan-sgp` | `https://token-plan-sgp.xiaomimimo.com/v1` | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` | 全 0（套餐制） |

认证均为 `envApiKeyAuth`（`Authorization: Bearer <key>` 风格）。模型目录含 deepseek-qwen 混合（qwen-token-plan 内还有 deepseek-v4-flash、MiniMax-M2.5 等第三方模型）。

---

## 1. 家庭 A — 阿里云百炼 Qwen Token Plan

### 1.1 十四问必答（qwen-token-plan 与 qwen-token-plan-cn 共用一套答案，仅端点/地域不同）

1. **DSH provider id**: `qwen-token-plan`（国际）、`qwen-token-plan-cn`（中国）。
2. **DSH 认证方式**: Bearer API Key（`QWEN_TOKEN_PLAN_API_KEY` / `QWEN_TOKEN_PLAN_CN_API_KEY`）。🟢 [get-api-key](https://help.aliyun.com/zh/model-studio/get-api-key)
3. **消费方式**: 订阅制——Credits 统一计量。个人版 7 天滚动窗口限额（Lite 2,500 / Standard 10,000 / Pro 40,000 Credits/7 天，限时价 ¥39/139/499 月）；团队版月度固定额度（标准 25,000 / 高级 100,000 / 尊享 250,000 Credits/月，¥150/550/1398 坐席·月）+ 共享用量包（625,000 Credits/¥5,000）。🟢 [个人版概述](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview) [团队版概述](https://help.aliyun.com/zh/model-studio/token-plan-team-overview)
4. **官方 Balance API？**: ❌ 无。官方从未提供 API Key 可查的余额接口（百炼余额走的阿里云费用中心账单体系，也不属于 Token Plan）。🟢 [费用/账单文档](https://help.aliyun.com/zh/model-studio/bill-query-and-cost-management)
5. **官方 Usage API？**: ❌ 无。模型用量只能在控制台「模型用量」页看（约 1 小时延迟），无 REST API。🟢 [模型用量](https://help.aliyun.com/zh/model-studio/model-usage-statistics)
6. **官方 Subscription/Plan API？**: ❌ 无公开 OpenAPI。额度查看仅控制台「我的订阅」「用量分析」页面。🟢 [团队版概述](https://help.aliyun.com/zh/model-studio/token-plan-team-overview) [快速开始](https://help.aliyun.com/zh/model-studio/token-plan-quickstart)
7. **Rate Limit 是否从 Response Headers 返回？**: 🟡 待核实——官方文档只描述 429 错误码（`429 Allocated quota exceeded`），未记载任何 `x-ratelimit-*` 响应头。🟢 [团队版 FAQ](https://help.aliyun.com/zh/model-studio/token-plan-team-faq)
8. **Reset Time？**: 个人版＝每 7 天窗口（自窗口内首次调用起算）；团队版＝订阅月到期重置。重置时间无 API 字段，只能从控制台读。🟢 [个人版概述](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)
9. **套餐名**: 个人版 Lite/Standard/Pro（+用量包）；团队版 标准坐席/高级坐席/尊享坐席（+共享用量包）。🟢 同上
10. **Balance/Used/Remaining/Percentage/Reset/Expiration**: 全部只在控制台可见，无官方 API 字段。社区逆向的**网页私有接口**（D 级，需浏览器登录态 Cookie）可拿到完整字段，见 1.2。🔵 [CodexBar alibaba-token-plan.md](https://github.com/steipete/CodexBar/blob/main/docs/alibaba-token-plan.md)
11. **无接口时能否本地 Token Usage × 官方价格计算？**: ⚠️ 可做**近似**：官方只给示例抵扣系数（如 qwen3.6-plus：输入 8,349 tok≈1.67 Credits），未公开全部模型×Token 类型的抵扣系数表，单次消耗"由模型类型、Token 用量、思考模式及工具调用动态决定"。本地估算精度低，只能作兜底/趋势线，不能当额度真值。🟢 [团队版概述-计费示例](https://help.aliyun.com/zh/model-studio/token-plan-team-overview)
12. **是否需要用户额外提供权限？**: 需要且代价大——任何真实额度数据都要求**浏览器登录 Cookie**（含 `sec_token` + CSRF）或 **Bailian CLI 登录态**（`bl usage token-plan --output json`）；都违背"零设置、复用 DSH 凭据"原则。若只复用 API Key，则查不到任何额度。
13. **区分公开官方 API vs 网页私有 API**:
    - A/B 级公开 API：❌ 没有额度类公开 API。
    - D 级网页私有接口（逆向留档，勿正式依赖）：
      - 团队版：控制台网关 `data/api.json`，`action=GetSubscriptionSummary&product=BssOpenAPI-V3&params={"ProductCode":"sfm_tokenplanteams_dp_cn|_intl"}`，返回 `totalQuota/remainingQuota/usedQuota/resetsAt/planName`。
      - 个人版：网关 `action=BroadScopeAspnGateway`（国际 `IntlBroadScopeAspnGateway`）+ `api=zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/{usage|subscription|quota-config}`，返回 7 天窗口用量百分比、套餐 specCode（lite/standard/pro）、quota 绝对额度。
      - 二者均需 Cookie（`login_aliyunid_csrf` 等）+ `x-xsrf-token` + 区域 Host + 部分账户还要 `sec_token`。
      - 来源：🔵 [CodexBar Alibaba 实现](https://github.com/steipete/CodexBar/blob/main/docs/alibaba-token-plan.md)、[CodexBar AlibabaTokenPlanAPIRegion.swift](https://github.com/steipete/CodexBar/blob/main/Sources/CodexBarCore/Providers/Alibaba/AlibabaTokenPlanAPIRegion.swift) 与本仓库旧调研 [ALIYUN-BAILIAN-TOKEN-PLAN-API-RESEARCH.md](../ALIYUN-BAILIAN-TOKEN-PLAN-API-RESEARCH.md)（2025-12，经 CodexBar 实测）。另见同生态 [千问AI平台个人版 FAQ](https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-faq)（7 天窗口、额度查看在工作台，同样无 API）。
14. **稳定性分级 + 是否适合正式集成**: **D 级**（网页私有接口，Cookie/CSRF/sec_token 极易过期与随前端变更）——**不适合正式集成**；API Key 路径则零数据可查（实质 E 级）。

#### 1.1.x 十四问速览（家庭 A）

| # | 答案 | # | 答案 |
|---|---|---|---|
| 1 provider id | qwen-token-plan / qwen-token-plan-cn | 8 Reset Time | 个人=7 天窗口；团队=订阅月；无 API 字段 |
| 2 认证 | Bearer API Key（仅推理） | 9 套餐名 | Lite/Standard/Pro（个人）；标准/高级/尊享坐席（团队） |
| 3 消费方式 | token_plan（Credits，窗口/月度定额） | 10 字段可得性 | 控制台才有；D 级逆向接口可全量拿 |
| 4 Balance API | ❌ 无 | 11 本地计算 | 仅近似（抵扣系数未全公开） |
| 5 Usage API | ❌ 无 | 12 额外权限 | 必需要 Cookie 或 CLI，违背零设置 |
| 6 Plan API | ❌ 无 | 13 公开/私有 | 公开=0；私有=console 网关 + zeldaHttp |
| 7 Rate-Limit 头 | 🟡 待核实 | 14 分级 | D，不推荐正式集成 |

### 1.2 适配方案（10 项紧凑）

| # | 项 | 结论 |
|---|---|---|
| 1 | 可展示字段 | 窗口额度（已用/限额/百分比）、重置时间、套餐档。**现状：全部拿不到** |
| 2 | 获取方法 | 官方：无；D 级：Cookie/CSRF 网关查询；可选：Bailian CLI 子进程 |
| 3 | Endpoint | 团队 `bailian.console.aliyun.com/data/api.json`（CN）/ `modelstudio.console.alibabacloud.com/data/api.json`（国际）；个人 `bailian-cs.console.aliyun.com|bailian-singapore-cs.alibabacloud.com/data/api.json`（均 D 级，Cookie） |
| 4 | Auth | Cookie（`login_aliyunid_csrf` + `sec_token`）+ `x-xsrf-token`；或 CLI 登录态；❌ API Key 不可用 |
| 5 | 请求示例（脱敏） | `POST /data/api.json?action=GetSubscriptionSummary&product=BssOpenAPI-V3&params={"ProductCode":"sfm_tokenplanteams_dp_cn"}&region=cn-beijing&sec_token=****`，Header: `Cookie: ****; x-xsrf-token: ****` |
| 6 | Response 示例（脱敏） | `{"code":"200","data":{"DataV2":{"data":{"data":{"totalQuota":100000,"remainingQuota":85000,"usedQuota":15000,"resetsAt":1787328000000,"planName":"TOKEN PLAN"}}}}}`（数值示意） |
| 7 | 刷新频率建议 | （若走 D 级）≥10 分钟且失败退避；不建议高频（网关无官方 SLA） |
| 8 | 错误处理 | 401/403→提示重新登录；`BailianGateway.Workspace.NotAuthorised`→补 sec_token 重试；空数据→重试 3 次；全部失败→回退本地记账并标注「估算」 |
| 9 | 安全风险 | 读取浏览器 Cookie＝账号登录态泄露面；sec_token/CSRF 需正则抓网页，脆弱且敏感；建议绝不本地持久化 Cookie |
| 10 | 是否推荐正式集成 | ❌ **本期不推荐**。无 API Key 可查接口，Cookie/CLI 违背零设置原则。留档 2 个触发升级条件：①官方开放额度 OpenAPI；②用户明确接受手动粘贴 Cookie（改 D 级适配器） |

**billingMode 分类**: `token_plan`（个人版 quotaWindows 类型 `weekly`/7d；团队版 `monthly`；均无公开官方来源 → `source: unsupported`，UI 走「未适配/本地估算」渲染）。

### 1.3 一句话结论
> 阿里云百炼 Qwen Token Plan 官方从不提供 API Key 可查的额度接口，只有控制台/网页私有网关（Cookie）或 CLI，违背插件"零设置"铁律——**本期不集成**，用本地记账兜底并留档案。

---

## 2. 家庭 B — 小米 MiMo（按量 + Token Plan 三集群）

### 2.1 十四问必答（`xiaomi` 与 `xiaomi-token-plan-{cn,ams,sgp}` 分列）

1. **DSH provider id**: `xiaomi`（按量）、`xiaomi-token-plan-cn` / `xiaomi-token-plan-ams` / `xiaomi-token-plan-sgp`（套餐三集群）。
2. **DSH 认证方式**: Bearer API Key（`XIAOMI_API_KEY` 与 `XIAOMI_TOKEN_PLAN_{CN,AMS,SGP}_API_KEY`）；Token Plan 专属 Key 形如 `tp-xxxxx`。🟢 [订阅说明](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription)
3. **消费方式**: 按量＝账户余额（CNY，充值/赠金，余额为负停服）；Token Plan＝月度 Credits 定额（Lite 4.1B / Standard 11B / Pro 38B / Max 82B Credits·月，¥39/99/329/659；年度≈12 倍），额度耗尽停服（不扣余额）。🟢 [Token Plan 价格](https://mimo.mi.com/docs/zh-CN/price/token-plan)、[付费 FAQ](https://mimo.mi.com/docs/zh-CN/quick-start/faq/payment)
4. **官方 Balance API？**: ⚠️ 半公开。官方 API 文档未记载，但存在稳定的 `GET /v1/user/balance`（Bear API Key 可用，多实现验证）。🔵 [quotas-rs mimo.rs](https://docs.rs/quotas/latest/src/quotas/providers/mimo.rs.html)、[CodexBar mimo.md](https://github.com/steipete/CodexBar/blob/main/docs/mimo.md)
   - `xiaomi`（按量）: `https://api.xiaomimimo.com/v1/user/balance` → CNY 三明细。
   - `xiaomi-token-plan-sgp`: `https://token-plan-sgp.xiaomimimo.com/v1/user/balance` → `token_balance/token_limit/plan_name`。
   - `xiaomi-token-plan-cn/-ams`: 🟡 **待核实**（同平台三集群、预期同构，但开源实现仅实测 SGP，需真弹各验一次）。
5. **官方 Usage API？**: ⚠️ 半公开 `GET /v1/tokenPlan/usage`（sgp 实测；另有 Cookie 版平台端点，非 API Key 首选）。返回月度 Credits 用量（used/limit/percent）。🔵 [quotas-rs](https://docs.rs/quotas/latest/src/quotas/providers/mimo.rs.html)；官方文档无此端点（[官方 API 文档仅 chat 类](https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api)）。
6. **官方 Subscription/Plan API？**: ❌ 官方无。额度查看仅「Token Plan 页面/订阅管理」；社区逆向的 usage 端点可当用量来源。🟢 [订阅说明](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription)、🔵 [cc-switch #5031](https://github.com/farion1231/cc-switch/issues/5031)
7. **Rate Limit 是否从 Response Headers 返回？**: 🟡 待核实——官方「速率限制」文档只讲策略，无响应头规格；需实测抓包。
8. **Reset Time？**: 官方为"订阅月/年"重置（无 API 字段）。usage 响应的 items 无 resetAt，开源实现按 30 天期硬编码。→ **Reset 需本地推导**（订阅期期初，可近似取购买日/自然月）。🟢 [订阅说明](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription)
9. **套餐名**: Lite / Standard / Pro / Max（Token Plan）；按量侧 plan 字段返回 `PAYG`。🟢 [Token Plan 价格](https://mimo.mi.com/docs/zh-CN/price/token-plan)
10. **Balance/Used/Remaining/Percentage/Reset/Expiration**: 半公开端点字段：余额侧 `balance/charge_balance/granted_balance`（按量）、`token_balance/token_limit`（套餐）；usage 侧 `month_total_token.used/limit/percent`（套餐）。Reset/Expiration 均无字段。🔵 [quotas-rs](https://docs.rs/quotas/latest/src/quotas/providers/mimo.rs.html)
11. **无接口时能否本地 Token Usage × 官方价格计算？**: ✅ 可行且精度较高——官方公开全部抵扣系数（mimo-v2.5：缓存 2 / 输入 100 / 输出 200 Credits·百万tok；v2.5-pro：2.5/300/600；ASR 30M/h；TTS 免费；夜间 0.8x 系数）。本地记账可复用。🟢 [订阅说明](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription)
12. **是否需要用户额外提供权限？**: **否（推荐路径）**——`/v1/user/balance` 与 `/v1/tokenPlan/usage` 直接用 DSH 内置 API Key（Bearer）即可，零设置。唯一例外：若想拿 Cookie 版平台 usage（含跨集群汇总），才需浏览器 Cookie——不推荐使用。🔵 [quotas-rs](https://docs.rs/quotas/latest/src/quotas/providers/mimo.rs.html)
13. **区分公开官方 API vs 网页私有 API**:
    - A/B 级：`GET /v1/user/balance`（按量与套餐）→ **B 级**：未文档化但接口稳定、双开源实现（quotas-rs、CodexBar）交叉验证、鉴权即 OpenAI 兼容 Bearer；`GET /v1/tokenPlan/usage`（sgp Bearer）→ **B 级（sgp）/🟡 待核实（cn/ams）**。
    - D 级：`https://platform.xiaomimimo.com/api/v1/tokenPlan/usage` 走小米账号 OAuth Cookie（`api-platform_serviceToken` + `userId`），社区明确指出**不是 tp-xxx Key 可查**（🔵 [cc-switch #5031](https://github.com/farion1231/cc-switch/issues/5031)），仅作对照，不推荐。
    - 官方公开文档侧确认无余额端点：🔵/🟢 平台 [OpenAI API 文档](https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api) 仅 chat/速率限制/错误码。
14. **稳定性分级 + 是否适合正式集成**: `xiaomi`（按量）B 级、`xiaomi-token-plan-sgp` B 级 → **适合正式集成**（Bearer Key 零设置）；`xiaomi-token-plan-cn/-ams` 预期同构但仅 SGP 被验证 → **条件集成**（上线前用真实凭据各验一次）。

#### 2.1.x 十四问速览（家庭 B）

| # | 答案 | # | 答案 |
|---|---|---|---|
| 1 provider id | xiaomi；xiaomi-token-plan-{cn,ams,sgp} | 8 Reset Time | 订阅月/年；无 API 字段，需本地推导 |
| 2 认证 | Bearer API Key（按量 sk-* / 套餐 tp-*） | 9 套餐名 | Lite/Standard/Pro/Max（按量=PAYG） |
| 3 消费方式 | 按量=CNY 余额；套餐=月度 Credits 定额 | 10 字段可得性 | ✅ balance / token_balance / month_total_token |
| 4 Balance API | ⚠️ 半公开 B 级：/v1/user/balance（按量+套餐） | 11 本地计算 | ✅ 精确（官方抵扣系数全公开） |
| 5 Usage API | ⚠️ 半公开 B 级：/v1/tokenPlan/usage（sgp 实测） | 12 额外权限 | ❌ 不需要（复用 DSH API Key） |
| 6 Plan API | ❌ 官方无（usage 端点可当来源） | 13 公开/私有 | 半公开 B 级×2；私有 D 级=平台 Cookie 端点（不用） |
| 7 Rate-Limit 头 | 🟡 待核实 | 14 分级 | B（xiaomi/sgp）；B-（cn/ams 待核实） |

### 2.2 适配方案（10 项紧凑）

| # | 项 | 结论 |
|---|---|---|
| 1 | 可展示字段 | 按量：CNY 余额（总/充值/赠送）+ plan；套餐：月度 Credits（已用/限额/剩余/百分比）+ plan_name |
| 2 | 获取方法 | 半公开 `GET`（未文档化，实现已验证）；失败回退本地记账（官方抵扣系数，精度高） |
| 3 | Endpoint | 按量 `https://api.xiaomimimo.com/v1/user/balance`；套餐按 provider 路由：`…/token-plan-{cn,ams,sgp}.xiaomimimo.com/v1/user/balance` 与 `…/v1/tokenPlan/usage` |
| 4 | Auth | `Authorization: Bearer <DSH API Key>`（与 DSH 一致，零设置）；❌ 不用 Cookie 版平台端点 |
| 5 | 请求示例（脱敏） | `GET https://api.xiaomimimo.com/v1/user/balance` ／ `GET https://token-plan-sgp.xiaomimimo.com/v1/tokenPlan/usage`，Header: `Authorization: Bearer sk-****` |
| 6 | Response 示例（脱敏） | 按量 `{"data":{"balance":"12.5000","charge_balance":"10.0000","granted_balance":"2.5000","plan":"PAYG"}}`；套餐 `{"data":{"token_balance":800000,"token_limit":1000000,"plan_name":"Pro"}}`；usage `{"code":0,"data":{"monthUsage":{"percent":0.1661,"items":[{"name":"month_total_token","used":265741632,"limit":1600000000,"percent":0.1661}]}}}`（数值均示意） |
| 7 | 刷新频率建议 | 5–30 分钟一次，带指数退避；用量变化慢（月度窗），建议 15 分钟档 |
| 8 | 错误处理 | 401/403→标记凭据失效并保留旧快照；code≠0→跳过该端点尝试下一候选；空 data→重试 1–2 次；全败→本地记账 fallback + source 标注 |
| 9 | 安全风险 | 低：仅用 API Key 只读端点；勿持久化 Cookie；勿高频轮询防误判滥用（套餐规则禁止非编程工具调用，查询本身是只读、风险可控）；响应含金额，客户端展示时勿落盘敏感字段 |
| 10 | 是否推荐正式集成 | ✅ **推荐**：`xiaomi`（B）与 `xiaomi-token-plan-sgp`（B）直接集成；`xiaomi-token-plan-cn/-ams` 同适配器按 provider 路由 baseUrl、**上线前各真弹验证一次**（预期同构） |

**billingMode 分类**: `xiaomi` → `pay_as_you_go`（CNY 余额，source=`official_api`/`api_key_endpoint`，B 级）；`xiaomi-token-plan-*` → `token_plan`（quotaWindows `monthly`/month_total_token，source=`api_key_endpoint`，B 级｜cn/ams 待核实）。

### 2.3 一句话结论
> 小米 MiMo 是本期最大惊喜：半公开的 `GET /v1/user/balance`（按量 CNY）与 `GET /v1/tokenPlan/usage`（套餐 Credits）**直接用 DSH 里已有的 API Key 就能查**，零设置可集成；三集群中仅 SGP 被开源实现实测，CN/AMS 同构但需真弹确认。

---

## 3. 推荐集成清单（本期）

| 优先级 | provider | 动作 | 字段 | 稳定性 |
|---|---|---|---|---|
| P0 | `xiaomi`（按量） | 正式集成 `/v1/user/balance` | 余额（总/充值/赠送）+ plan | B |
| P0 | `xiaomi-token-plan-sgp` | 正式集成 `/v1/user/balance` + `/v1/tokenPlan/usage` | Credits used/limit/percent + plan_name | B |
| P1 | `xiaomi-token-plan-cn` / `-ams` | 同适配器路由 baseUrl，**真弹验证后**开启 | 同上 | B-（待核实） |
| P2 | `qwen-token-plan` / `qwen-token-plan-cn` | ❌ 本期不集成；本地记账兜底；留档 Cookie/CLI 升级路径 | 无（本地估算标注） | D |

**实施要点**: 三者共用 `ProviderAccountStatus.quotaWindows` 渲染（个人版 weekly、团队版/小米 monthly）；失败一律保留旧快照并降级 `source`；响应字段不落盘敏感金额；真弹验证清单（cn/ams balance+usage、rate-limit 响应头、resetAt 是否存在）列入 v1.7 QA。

## 4. 参考文献

- 阿里云百炼：[个人版概述](https://help.aliyun.com/zh/model-studio/token-plan-personal-overview)｜[团队版概述](https://help.aliyun.com/zh/model-studio/token-plan-team-overview)｜[团队版 FAQ](https://help.aliyun.com/zh/model-studio/token-plan-team-faq)｜[快速开始](https://help.aliyun.com/zh/model-studio/token-plan-quickstart)｜[模型用量](https://help.aliyun.com/zh/model-studio/model-usage-statistics)｜[费用/账单](https://help.aliyun.com/zh/model-studio/bill-query-and-cost-management)｜[获取 API Key](https://help.aliyun.com/zh/model-studio/get-api-key)｜[千问AI平台个人版 FAQ](https://platform.qianwenai.com/docs/token-plan/personal/token-plan-personal-faq)
- 小米 MiMo：[订阅说明](https://mimo.mi.com/docs/zh-CN/tokenplan/Token%20Plan/subscription)｜[Token Plan 价格](https://mimo.mi.com/docs/zh-CN/price/token-plan)｜[付费 FAQ](https://mimo.mi.com/docs/zh-CN/quick-start/faq/payment)｜[官方 API 文档（chat 类）](https://platform.xiaomimimo.com/docs/zh-CN/api/chat/openai-api)
- 开源实现：[quotas-rs mimo.rs](https://docs.rs/quotas/latest/src/quotas/providers/mimo.rs.html)（2026-07-30，v0.11.0，MiMo 四端点+响应字段+测试 fixture）｜[CodexBar mimo.md](https://github.com/steipete/CodexBar/blob/main/docs/mimo.md)｜[CodexBar alibaba-token-plan.md](https://github.com/steipete/CodexBar/blob/main/docs/alibaba-token-plan.md)｜[cc-switch #5031](https://github.com/farion1231/cc-switch/issues/5031)｜[cc-switch #2488](https://github.com/farion1231/cc-switch/issues/2488)
- 本仓库既有：[ALIYUN-BAILIAN-TOKEN-PLAN-API-RESEARCH.md](../ALIYUN-BAILIAN-TOKEN-PLAN-API-RESEARCH.md)（2025-12 逆向规格）｜[PROVIDER-DATA-MODEL.md](../PROVIDER-DATA-MODEL.md)（billingMode=token_plan 提案）

---

**报告完成时间**: 2026-08-27 ｜ **下次更新触发条件**: ① 百炼/小米官方发布额度 OpenAPI；② 小米 cn/ams 真弹验证结果；③ Token Plan 抵扣系数表或套餐档位变更。