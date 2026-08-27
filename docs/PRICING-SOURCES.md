# 定价来源与复核规则

最后复核：2026-08-28（v1.8，智谱 GLM 全系列 + 小米/StepFun/Kimi 国内站按量价 + 远程价目目录）

信息栏中的价格用于展示与本地花费估算，不替代服务商账单。每次调整 `plugin/src/host.js` 的 `PRICING` 前，必须先人工复核相应服务商的正式价格页面，并在提交中同步更新本文件的复核日期和映射说明。

## 来源

- DeepSeek 价格页：<https://api-docs.deepseek.com/quick_start/pricing>
- OpenAI API 价格页：<https://openai.com/api/pricing/>
- 智谱 GLM 价格页：<https://open.bigmodel.cn/pricing>（主来源）/ <https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5>
- Kimi API 价格页：<https://platform.kimi.com/docs/pricing/chat-k27-code> / <https://platform.kimi.com/docs/pricing/chat-k3>
- 阶跃 StepFun 价格页：<https://platform.stepfun.com/docs/zh/guides/pricing/details>
- 小米 MiMo 按量价格页：<https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go>（2026-08-06 调价后口径）
- Kimi 国内站价格页：<https://platform.kimi.com/docs/pricing/chat>（国内=¥、国际=$ 两套口径分域维护）

## 当前映射

- DeepSeek V4 Flash、V4 Pro 与 V4 Flash Vision Exp 均使用两档价格：空闲价为高峰价的一半。自 2026-08-23 00:00 起，周六、周日全天按空闲价计费；周一至周五仍在北京时间 09:00–12:00、14:00–18:00 按高峰价计费，其余时段为空闲价。计费时段以服务端接收请求的北京时间为准；本地信息栏只作展示与估算。
- 官方价格页现已单列 `deepseek-v4-flash-vision-exp`，其当前各档价格与 `deepseek-v4-flash` 相同；代码中仍保留独立条目，以便服务商后续单独调价时直接更新，绝不按名称臆测。
- **v1.8 智谱 GLM 系列入库（8 款全）**：glm-5.3 / glm-5.3-flash / glm-5.2 / glm-5.1 / glm-5-turbo / glm-5v-turbo / glm-4.7 / glm-4.5-air，全部为 CNY flat 价（输入/缓存命中/输出，元每百万 tokens），官方单列缓存命中价与"缓存存储限时免费"口径。采集方式、全部分段档位数字与第三方交叉验证记录见 `docs/research/bigmodel-pricing-202608.md`。注意：
  - 分段价模型（5.1 / 5-turbo / 5v-turbo 按 32K 输入分档；4.7 / 4.5-air 另叠输出细分）主条目取**基础档**，长上下文档暂未参与计算——影响与后续方案见 `docs/BILLING-FRAMEWORK-AUDIT.md` P2。
  - `glm-5.3-flash` 官方存在"5折限时两周"双价：内置表取刊例价（0.8/0.23/2.8，保守不低估）；远程目录 `catalog/pricing.json` 在促销窗口内配实扣价（0.4/0.115/1.4），活动结束后翻回——价格更新走远程目录，无需发版。
  - 远程目录由插件启动/每 6 小时匿名拉取合并，来源同样在本文件登记后方可变更。
- **v1.6 新增适配器说明**：moonshotai（Kimi）、openrouter、stepfun（阶跃）、zai（智谱）的余额/额度查询已接入，但定价表仅收录有明确官方价格的模型。Kimi K2.7/K3、Step-2 等模型的 flat 价格需待官方明确公布后添加，当前保持"不臆测"行为——未收录模型的花费显示为"unpriced"（启动时一次性的回填机制亦只补算价目表已覆盖的模型）。
- **v1.7 说明**：新增的 ChatGPT 订阅卡（本地 JWT）、xiaomi 余额、xiaomi-token-plan 额度、Together / Fireworks / AWS Bedrock / Cloudflare 账单型显示，**全部只展示服务商官方 API 真实返回的金额/额度/账单，不新增任何本地定价估算条目**——`PRICING` 表未收录新模型价格（遵循"不臆测"规则），账单型金额来自官方计费接口，与本地定价表无关。
- **v1.8 后半补充（三家入库）**：mimo-v2-flash/-omni/-pro/v2.5/v2.5-pro 与 step-3.7-flash/3.5-flash 以裸键收录；
Kimi 全系以 `moonshotai-cn:kimi-*` 作用域键收录——同一型号在 api.moonshot.ai 国际站按美元另计，裸键留空防串币种。
米系注意本机 pi-ai 目录 cost 字段为 USD、官网为 CNY 调价新值（详见 kimi-stepfun-xiaomi-pricing 档案）。
mimo-v2.5-pro-ultraspeed 因人民币价无独立确认暂不收录。未收录的模型不显示峰谷价格，且不应凭名称猜测价格。

定价可能随服务商更新而变化；发布新版本前应重新打开上述正式页面并核对。
