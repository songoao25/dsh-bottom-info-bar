# A5. StepFun（阶跃星辰）与腾讯混元 底部信息栏适配可行性调研

> 调研日期：本仓库研究轮次内（StepFun 文档站信息以 2026-06 后「Token Plan / Credit 月池」新版为准）
> 方法：官方文档站直读（llms.txt 索引 / markdown / 官方 PDF）+ web_search 交叉核实；所有结论附来源 URL；不确定项标注「待核实」。
> 结论速览：**StepFun 余额（按量 API）可正式集成（A 级）；StepFun Step Plan（订阅月池）无官方配额 API，暂不可靠（C 级，只能本地估算，须标注「估算」）；腾讯混元可经 OpenAI 兼容接口 + APIKey 低成本接入并做本地花费核算（B+），但真实余额/资源包需腾讯云签名且资源包剩余无 API，配置成本高，仅适合可选高级模式（B-）**

---

## 0. 方法与证据基线

- 信息获取顺序：StepFun 文档站 `/docs/llms.txt` 全量页面索引 → 逐页抓取官方 markdown（accounts、credits、pricing、step-plan 系列）→ 官方 PDF（腾讯混元兼容接口 1729_111006、混元购买指南 1729_97731）→ 腾讯云 API 文档（555 费用中心）→ web_search 交叉核对社区/官方动态。
- 关键判定口径：凡「官方文档页面/API 目录」之外的能力一律视为**网页私有 API（不可依赖）**；凡未见于任何官方文档的信息一律标 **「待核实」**。
- 分级口径：A = 官方公开 API + 字段稳定 + 已有实现与 QA 支撑；B = 官方接口可用但有明显配置/覆盖短板；C = 无公开接口、仅网页 UI 或本地估算；D = 无可用途径；E = 明确不可行。

---

## 一、StepFun 阶跃星辰

### 1.1 关键事实（官方文档核实）

| # | 项目 | 结论 | 来源 |
|---|---|---|---|
| 1 | DSH provider id | `stepfun`（插件 registry `PROVIDERS.stepfun` 与 DSH 服务商映射均用此 id；已在 v1.6 落地为 `accountForProvider(stepfun)→stepfun`）。DSH 骨架是否原生注册该 provider 建议真机核实 | 仓库 PRD FR-6 / tasks T5、T1；PRICING-SOURCES 前提 |
| 2 | DSH 认证方式 | API Key Bearer：`Authorization: Bearer <STEPFUN_API_KEY>`（凭据名 `STEPFUN_API_KEY`，仓库已实现并过 QA） | 官方 [获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get)、仓库 QA-REPORT-v1.6 FR-6 |
| 3 | 消费方式 | 按量付费（Token × 单价，扣减顺序：赠送 → 充值，`balance` 为折算后可用）；企业套餐 / Step Plan 走组织级 Credit 账户（1 元 = 1,000,000 Credit） | [计费介绍](https://platform.stepfun.com/docs/zh/guides/pricing/intro)、[Credit 额度规则](https://platform.stepfun.com/docs/zh/guides/organization/credits) |
| 4 | 官方 Balance API | ✅ `GET https://api.stepfun.com/v1/accounts`（Bearer，无参数）返回：`object`（固定 account）、`type`（prepaid/postpaid）、`balance`（当前可用余额）、`total_cash_balance`（总充值）、`total_voucher_balance`（总赠送） | [获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get) |
| 5 | 官方 Usage API | ❌ 无公开 API。「组织用量 / 使用详情」仅网页 UI（主账号「组织管理 > 组织用量」可按项目/成员/模型筛选导出；成员「账户管理 > 使用详情」） | [Credit 额度规则](https://platform.stepfun.com/docs/zh/guides/organization/credits) |
| 6 | 官方 Subscription/Plan API | ❌ 无。`llms.txt` 全量 API 目录（chat/images/audio/files/vector-stores/models/accounts/search/token-count/error-codes）中**没有任何 plan / credit / usage / quota 查询接口**；Step Plan 剩余量仅存在于平台网页（订阅页/个人中心） | [llms.txt 目录](https://platform.stepfun.com/docs/llms.txt)、[Step Plan 概述](https://platform.stepfun.com/docs/zh/step-plan/overview) |
| 7 | Rate Limit 头部 | ❌ 官方文档未说明响应头携带限速信息；限速为「充值阶梯制」：V0（¥0）并发5/RPM10/TPM 500万 → V1（¥100）100/1000/2000万 → V2（¥500）200/5000/3000万；Step Plan 不适用阶梯限速。**响应头是否含 x-ratelimit-* 待实测** | [定价与限速](https://platform.stepfun.com/docs/zh/guides/pricing/details) |
| 8 | Reset Time | 按量余额无重置概念；阶梯限速随累计充值升降级（非周期）；Step Plan 月池**每月 1 号发放、月末清零不结转**；加油包独立 30 天到期；旧 Coding Plan 为 5 小时/周限额（已停售） | [Step Plan 概述](https://platform.stepfun.com/docs/zh/step-plan/overview)、[升级公告](https://platform.stepfun.com/docs/zh/step-plan/upgrade-notice) |
| 9 | 套餐名 | 订阅制总称 **Step Plan**；2026-06-18 起官方新名 **Token Plan（Credit 月池）**，旧版 **Coding Plan** 停售（自动续费可延续）。档位 **Flash Mini / Plus / Pro / Max**：月 Credit 400M/1600M/8000M/40000M（1M Credit=¥1），月付 ¥49/¥99/¥199/¥699（季/年付更低）；加油包 小油包 ¥49/400M、大油包 ¥99/1600M | [Step Plan 概述](https://platform.stepfun.com/docs/zh/step-plan/overview)、[升级公告](https://platform.stepfun.com/docs/zh/step-plan/upgrade-notice) |
| 10 | Balance / Used / Remaining / Percentage / Reset / Expiration | 按量 API：Balance ✅（`balance`/`total_cash_balance`/`total_voucher_balance`，CNY，**维度是元不是 Credit**）；Used/Remaining/Percentage 无接口（网页 UI 有组织用量明细）；Expiration 无（赠送金平台侧有期限，API 不返回）。Plan：以上**全部无公开 API**（网页订阅页可见剩余 Credit，属私有数据） | [获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get)、[Credit 额度规则](https://platform.stepfun.com/docs/zh/guides/organization/credits) |
| 11 | 本地 Token Usage × 官方价 | ✅ 可行且是 Plan 场景唯一可选路径。官方价格页齐全：step-3.7-flash ¥1.35/¥8.1 每 1M token（缓存命中 ¥0.27）、step-3.5-flash ¥0.7/¥2.1（缓存命中 ¥0.14）；响应 `usage` 计 prompt/completion/total tokens；按 1M Credit=¥1 折算可本地累计出 Credit 剩余（忽略加油包/手动调整，精度有限） | [定价详情](https://platform.stepfun.com/docs/zh/guides/pricing/details)、[计费介绍](https://platform.stepfun.com/docs/zh/guides/pricing/intro) |
| 12 | 用户额外权限 | 按量：**零额外配置**，复用 STEPFUN_API_KEY，符合零设置原则。Step Plan：需专用 Key + 专用 Base URL `https://api.stepfun.com/step_plan/v1`（与普通 API 相互独立，余额与订阅互不影响）；**Step Plan Key 调 `/v1/accounts` 的返回未被官方文档化（可能报错或返回 0），待实测** | [Step Plan 概述 FAQ](https://platform.stepfun.com/docs/zh/step-plan/overview) |
| 13 | 公开 vs 网页私有 | 公开官方 API：`/v1/accounts`、chat/completions、models、files、vector-stores、audio、images 等（官方未发布 openapi.json 正式版，文档站 `docs/api-reference/openapi.json` 为 Mintlify 示例占位，不用作依据）。网页私有（勿依赖）：组织用量、使用详情、Step Plan 订阅页剩余量、Studio 创作额度 | [llms.txt](https://platform.stepfun.com/docs/llms.txt)、[获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get) |
| 14 | 稳定性分级 | 按量余额适配 **A 级**（官方接口、字段稳定、v1.6 已实现并通过 QA 单测，仅缺真实 Key 端到端实测）；Step Plan 配额 **C 级**（无公开 API，网页 UI/本地估算），暂不适合正式集成 | 仓库 QA-REPORT-v1.6 FR-6、tasks T5 |

**示例响应（官方文档，脱敏）**
```json
{"object":"account","type":"prepaid","balance":0.00,"total_cash_balance":0.00,"total_voucher_balance":26.00}
```
> 数值已抹除（0/26 来自官方示例页），来源 [获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get)。

### 1.2 StepFun 适配方案

| 项 | 方案 |
|---|---|
| 可展示字段 | 按量：余额 balance（CNY）、充值额、赠送额、type。Plan（增强项）：本地估算 Credit 剩余 + 档位月额度（标注「估算」） |
| 获取方法 | 官方 API：`GET /v1/accounts`（Bearer STEPFUN_API_KEY）；Plan 用本地累计（usage × 官方价 → Credit） |
| Endpoint | `https://api.stepfun.com/v1/accounts`（Plan 专用 `https://api.stepfun.com/step_plan/v1` 无等价文档化接口） |
| Auth | `Authorization: Bearer <STEPFUN_API_KEY>` |
| 请求示例 | `curl -H "Authorization: Bearer sk-***" https://api.stepfun.com/v1/accounts` |
| Response 示例 | `{"object":"account","type":"prepaid","balance":<x.xx>,"total_cash_balance":<x.xx>,"total_voucher_balance":<x.xx>}`（脱敏） |
| 刷新频率 | 余额：会话内低频（5–10 分钟或点击刷新；余额变化慢）；Plan 估算：随每次调用 usage 即时累计 |
| 错误处理 | 401 无效 Key → 提示重新配置；429 → 区分 `insufficient_credit`（402 语义，余额不足）、`project_credit_limit_exceeded`、`member_project_credit_limit_exceeded`（项目/成员月上限，1 号重置）→ 按错误标识降级提示；超时指数退避 | 
| 安全风险 | Key 仅存本地 env，不走网络中转；请求 HTTPS；日志不落完整 Key；响应不做整包 JSON.stringify 留痕 |
| 是否推荐正式集成 | **按量：推荐**（A 级：零设置、接口稳、已实现，唯一前置是真 Key 端到端补测）。**Step Plan 配额：暂不推荐正式集成**（无官方 API；网页私有接口不可依赖；本地估算只可作「估算余额」标注展示，避免与真实余额混淆） |
| billingMode 分类 | 按量 `pay_as_you_go`；Step Plan ⇒ `token_plan`（官方已更名 Token Plan，与插件既有 token_plan 语义可对齐），按量与 plan 双模式并存互斥 |

### 1.3 证据核对记录

- [获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get)：唯一账户级 API；响应仅 5 个字段，**无 plan/usage/quota/currency**——直接否定了「/v1/accounts 含 plan 字段」的假设。
- [llms.txt](https://platform.stepfun.com/docs/llms.txt)：全量 API 目录核对，确认不存在独立 plan/usage 接口；`docs/api-reference/openapi.json` 为示例占位（plant store），不能作为规格依据。
- [Step Plan 概述](https://platform.stepfun.com/docs/zh/step-plan/overview)：月池 4 档位、1M Credit=¥1、月末清零、专用 Base URL、余额与订阅互相独立。
- [升级公告](https://platform.stepfun.com/docs/zh/step-plan/upgrade-notice)：Token Plan（2026-06-18 起）替代 Coding Plan；「按请求次数、5 小时/周」成为历史语义——插件若处理旧订阅数据需注意口径。
- [Credit 额度规则](https://platform.stepfun.com/docs/zh/guides/organization/credits)：用量查看只能在网页 UI；1 号 00:00 月重置；402/429 错误标识语义明确，可映射到插件的错误提示。

---

## 二、腾讯混元（TCLM）

### 2.1 关键事实

| # | 项目 | 结论 | 来源 |
|---|---|---|---|
| 1 | DSH provider id | ❌ DSH 无内置混元 provider 与内置凭据名；需用户自定义 provider（OpenAI 兼容 endpoint）。仓库产品定义明确把「腾讯混元等云厂商密钥适配（需云账号 AccessKey，配置重）排后续」 | 仓库 product-definition.md「零设置适配器 vs 排后续」清单 |
| 2 | DSH 认证方式 | 两种：① 兼容接口用**混元控制台 APIKey（Bearer）**，与 OpenAI SDK 直接兼容，最简单；② 腾讯云 OpenAPI 签名（SecretId/SecretKey，TC3-HMAC-SHA256），用于费用/管理类 API。插件余额查询属于② | [混元兼容接口 PDF](https://main.qcloudimg.com/raw/document/product/pdf/1729_111006_cn.pdf)、[调用示例文档](https://cloud.tencent.com/document/product/1729/111007) |
| 3 | 消费方式 | 后付费日结（按 token 计费，每日出昨日账单自动扣费）；免费资源包优先扣 → 按量计费；欠费 24 小时未充值停服（此时免费额度亦不享受）。另有 TokenHub 等平台活动体验包 | [混元生文计费概述](https://cloud.tencent.com/document/product/1729/97731) |
| 4 | 官方 Balance API | ✅ `DescribeAccountBalance`（费用中心 Billing v2018-07-09，POST）：返回 `Balance`（账户余额）、`Currency`、`CashAccountBalance`（现金）、`GiftAccountBalance`（赠送）、`CouponBalance`（代金券）、`FreezeAmount`（冻结/欠费相关）、`DebtAmount`、`BalanceDetails`（余额构成明细）等；**必须 SecretId/SecretKey 做 TC3 签名** | [获取账户余额](https://cloud.tencent.com/document/api/555/20253)、[国际版文档](https://www.tencentcloud.com/zh/document/product/555/50284) |
| 5 | 官方 Usage API | 半✅：账单类 API 可拉历史用量（`DescribeBillSummaryByProduct` 等，费用中心 555 系列，同需签名）；混元自身**无实时用量公开接口**，控制台可看 token/调用明细（网页私有） | [费用中心 API 概览](https://cloud.tencent.cn/document/product/555/19170) |
| 6 | 官方 Subscription/Plan API | ❌ 混元无订阅制；腾讯云「资源包」剩余量**未见公开查询 API**（费用中心「资源包总览」为控制台 UI，社区也以控制台/账单口径为主）；API 化状态**待核实** | [资源包总览](https://cloud.tencent.com/document/product/555/122539) |
| 7 | Rate Limit 头部 | ❌ 官方兼容接口文档未见响应头限速说明；各模型有并发/限速配置（控制台可调，如 lite 低速档）。**是否返回 x-ratelimit 头待实测** | 兼容接口 PDF [111006](https://main.qcloudimg.com/raw/document/product/pdf/1729_111006_cn.pdf)（无限速头说明） |
| 8 | Reset Time | 免费资源包 12 个月有效期（以资源包形式发放，优先扣除）；结算日结（每日出昨日账单）；无订阅「重置」概念 | [混元生文计费概述](https://cloud.tencent.com/document/product/1729/97731) |
| 9 | 套餐名 | 无订阅套餐。计费项：免费资源包（hunyuan-pro/standard/lite **共用 10 万 token**、embedding 100 万 token，均 12 个月）+ 按量刊例价 + 可选资源包/TokenHub 活动体验包 | [混元生文计费概述](https://cloud.tencent.com/document/product/1729/97731) |
| 10 | Balance/Used/Remaining/Percentage/Reset/Expiration | Balance：DescribeAccountBalance（元，需签名）；Used/Remaining：无直接 API（资源包剩余在控制台「资源包总览」，账单 API 可推历史消耗）；Percentage：可本地算（余额/充值基线）；Expiration：免费包 12 个月（控制台/账单可见） | #4/#6、[资源包总览](https://cloud.tencent.com/document/product/555/122539) |
| 11 | 本地 Token Usage × 官方价 | ✅ 可行。官方刊例（每千 token）：hunyuan-pro ¥0.10（=¥100/1M）、hunyuan-standard ¥0.01（=¥10/1M）、hunyuan-lite ¥0.008（=¥8/1M）、embedding ¥0.0007（=¥0.7/1M）；**新模型单价（如 hunyuan-turbos-latest）以控制台/TokenHub 定价页为准，待核实**。兼容接口返回标准 `usage` 字段 | [混元生文计费概述](https://cloud.tencent.com/document/product/1729/97731)、[TokenHub 模型价格](https://cloud.tencent.cn/document/product/1823/130055) |
| 12 | 用户额外权限 | 兼容接口：仅需**混元控制台创建 APIKey**（前提：腾讯云账号 + 个人/企业实名认证 + 开通混元）——比 AccessKey 签名轻得多，但仍是多步网页配置，**与插件「零设置」原则冲突**。真实余额/资源包查询还需 SecretId/SecretKey 签名 | [兼容接口 PDF](https://main.qcloudimg.com/raw/document/product/pdf/1729_111006_cn.pdf)、[购买指南](https://cloud.tencent.com/document/product/1729/97731) |
| 13 | 公开 vs 网页私有 | 公开：兼容接口（chat/completions、embeddings 等）、DescribeAccountBalance、账单 API。网页私有（勿依赖）：控制台余额页、资源包总览、token 明细、限速配置页 | 见 #4/#6 |
| 14 | 稳定性分级 | 兼容接口接入 **B+ 级**（OpenAI 兼容、官方 APIKey、字段标准）；余额真实查询 **B- 级**（API 稳定但签名重、仅覆盖账户余额不覆盖资源包剩余）；资源包剩余量 **D 级**（无公开 API）。整体：**默认本地花费核算，余额仅作可选高级模式，不宜默认正式集成** | 综合 #4/#6/#11 |

**示例响应（脱敏）**
```json
{"Response":{"Balance":<x.xx>,"Currency":"CNY","CashAccountBalance":<x.xx>,
 "GiftAccountBalance":<x.xx>,"CouponBalance":<x.xx>,"FreezeAmount":<x.xx>,
 "DebtAmount":<x.xx>,"RequestId":"<uuid>"}}
```
> 字段名以 [DescribeAccountBalance](https://cloud.tencent.com/document/api/555/20253) 文档为准；数值已抹除。

### 2.2 腾讯混元适配方案

| 项 | 方案 |
|---|---|
| 可展示字段 | 首选：本地核算花费（token usage × 官方价）+ 模型名自动识别；可选高级：账户余额（元）/现金/赠送/代金券 |
| 获取方法 | 本地核算：解析兼容接口响应 usage；余额：`DescribeAccountBalance`（TC3 签名） |
| Endpoint | 兼容：`https://api.hunyuan.cloud.tencent.com/v1/chat/completions`；余额：`https://billing.tencentcloudapi.com`（POST，Action=DescribeAccountBalance） |
| Auth | 兼容：`Authorization: Bearer <HUNYUAN_API_KEY>`（控制台创建）；余额：SecretId/SecretKey TC3-HMAC-SHA256 签名 |
| 请求示例 | `curl -H "Authorization: Bearer sk-***" -d '{"model":"hunyuan-lite","messages":[{"role":"user","content":"hi"}]}' https://api.hunyuan.cloud.tencent.com/v1/chat/completions` |
| Response 示例 | chat：`{"choices":[<...>],"usage":{"prompt_tokens":<n>,"completion_tokens":<n>,"total_tokens":<n>}}`（脱敏）；余额见 2.1 |
| 刷新频率 | 花费随会话即时（usage 每次返回）；余额（高级模式）低频（日结制，1 小时~每日一次足够） |
| 错误处理 | 401（APIKey 失效/未开通）；429 限速（降级提示）；欠费/停服（免费包不享，提示充值）；签名失败提示检查 SecretId/SecretKey；解析失败容错降级不崩溃 |
| 安全风险 | APIKey/SecretId 仅存本地 env；兼容接口 HTTPS；签名请求不落日志、不透传第三方；明确告知用户凭据只用于余额查询 |
| 是否推荐正式集成 | **推荐做「兼容接口 + 本地花费核算 + provider 识别」**（B+：零签名、官方定价、usage 标准）；**不推荐默认做真实余额**（C/B-：签名配置重 + 资源包剩余无 API，与零设置冲突）；余额作为「高级/可选」开关 |
| billingMode 分类 | `cloud_billing`（主：腾讯云后付费账户，余额=账户余额/现金/赠送/代金券）；`token_plan` 语义可映射免费资源包/活动包（控制台管理、无 API，仅提示不取数） |

### 2.3 证据核对记录

- [混元兼容接口 PDF（1729_111006）](https://main.qcloudimg.com/raw/document/product/pdf/1729_111006_cn.pdf)：`base_url=https://api.hunyuan.cloud.tencent.com/v1`、APIKey 认证、标准 usage——证明「免签名接入」成立，显著降低配置成本判断（原「需 AccessKey」假设部分修正为「仅 APIKey 也可行」）。
- [混元生文计费概述（1729_97731，官方 PDF）](https://main.qcloudimg.com/raw/document/product/pdf/1729_97731_cn.pdf)：后付费日结、免费资源包（pro/standard/lite 共用 10 万 token；embedding 100 万 token；12 个月）、四档刊例价——本地花费核算的价格基线。文档更新于 2024-04，新模型价格须另核。
- [获取账户余额 DescribeAccountBalance](https://cloud.tencent.com/document/api/555/20253)：余额查询的官方途径；需要 TC3 签名，无法用混元 APIKey 代替。
- [资源包总览](https://cloud.tencent.com/document/product/555/122539)：资源包剩余只能在控制台查看；未发现对应公开 API（待核实）。
- 局限说明：腾讯云中文文档站为 JS 加密渲染，正文以官方 PDF 与搜索快照交叉核实；混元 APIKey 的确切创建入口、新模型单价、限速头行为均属**待实测**项。

---

## 三、交叉结论与推荐集成清单

**StepFun（一句话）**：按量余额适配已是 A 级（仅差真 Key 实测）；其订阅制 Step Plan 无官方配额 API，只能本地估算并必须标注「估算」，不满足插件「真实余额」承诺，本期只做按量、Plan 留增强。

**腾讯混元（一句话）**：OpenAI 兼容 + 控制台 APIKey 让「接入 + 本地花费核算」低成本可行（B+）；但真实余额必须腾讯云签名且资源包剩余无 API，配置成本与零设置原则冲突，只宜作可选高级模式（B-）。

推荐集成清单（按优先级）：
1. **stepfun 按量余额（A）**：v1.6 已实现，补真实 STEPFUN_API_KEY 端到端实测即收口。来源：[获取账户信息](https://platform.stepfun.com/docs/zh/api-reference/accounts/get)
2. **hunyuan 兼容接口 + 本地花费核算 + 服务商识别（B+）**：官方定价（pro/standard/lite 已核实）与标准 usage。来源：[混元兼容接口 PDF](https://main.qcloudimg.com/raw/document/product/pdf/1729_111006_cn.pdf)、[混元生文计费概述](https://cloud.tencent.com/document/product/1729/97731)
3. **hunyuan 账户余额（可选高级，B-）**：DescribeAccountBalance，需用户自愿提供 SecretId/SecretKey。来源：[获取账户余额](https://cloud.tencent.com/document/api/555/20253)
4. **stepfun Step Plan 配额（C）**：暂缓；如做，标注「本地估算（非官方实时值）」。来源：[Step Plan 概述](https://platform.stepfun.com/docs/zh/step-plan/overview)

## 四、待核实清单（前置测试项）

- StepFun：
  1. Step Plan Key 调 `GET /v1/accounts` 的实际返回（报错 / 0 / 含其他字段）。
  2. 响应头是否携带限速字段（阶梯限速语义如何落到头部）。
  3. DSH 骨架是否原生注册 `stepfun` provider（仓库侧已按「存在」实现）。
- 腾讯混元：
  1. hunyuan-turbos-latest 等新模型官方单价（控制台刊例 / [TokenHub 定价](https://cloud.tencent.cn/document/product/1823/130055)）。
  2. 兼容接口响应头限速字段。
  3. 资源包剩余量是否存在任何官方 API（当前证据：仅控制台 UI）。
  4. 混元控制台 APIKey 的创建路径与有效期（PDF 提及，具体入口待核）。

## 附录：关键来源 URL 索引

- StepFun 官方：llms 索引 https://platform.stepfun.com/docs/llms.txt ；账户 https://platform.stepfun.com/docs/zh/api-reference/accounts/get ；Credit 规则 https://platform.stepfun.com/docs/zh/guides/organization/credits ；定价限速 https://platform.stepfun.com/docs/zh/guides/pricing/details ；Step Plan https://platform.stepfun.com/docs/zh/step-plan/overview 、升级公告 https://platform.stepfun.com/docs/zh/step-plan/upgrade-notice
- 腾讯云官方：余额 API https://cloud.tencent.com/document/api/555/20253 、国际版 https://www.tencentcloud.com/zh/document/product/555/50284 ；混元计费 https://cloud.tencent.com/document/product/1729/97731 ；兼容接口 PDF https://main.qcloudimg.com/raw/document/product/pdf/1729_111006_cn.pdf 、示例 https://cloud.tencent.com/document/product/1729/111007 ；资源包总览 https://cloud.tencent.com/document/product/555/122539 ；TokenHub 定价 https://cloud.tencent.cn/document/product/1823/130055
- 仓库内相关既有调研：docs/AI-PLATFORM-SUBSCRIPTION-API-RESEARCH.md、docs/chinese-ai-platforms-research.md（§七 StepFun、§十 混元）、docs/PROVIDER-DATA-MODEL.md（billingMode 分类表）