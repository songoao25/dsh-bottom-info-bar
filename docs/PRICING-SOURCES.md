# 定价来源与复核规则

最后复核：2026-08-27（v1.7）

信息栏中的价格用于展示与本地花费估算，不替代服务商账单。每次调整 `plugin/src/host.js` 的 `PRICING` 前，必须先人工复核相应服务商的正式价格页面，并在提交中同步更新本文件的复核日期和映射说明。

## 来源

- DeepSeek 价格页：<https://api-docs.deepseek.com/quick_start/pricing>
- OpenAI API 价格页：<https://openai.com/api/pricing/>
- 智谱 GLM 价格页：<https://bigmodel.cn/pricing> / <https://docs.bigmodel.cn/cn/guide/models/text/glm-4.5>
- Kimi API 价格页：<https://platform.kimi.com/docs/pricing/chat-k27-code> / <https://platform.kimi.com/docs/pricing/chat-k3>
- 阶跃 StepFun 价格页：<https://platform.stepfun.com/docs/zh/guides/pricing/details>

## 当前映射

- DeepSeek V4 Flash、V4 Pro 与 V4 Flash Vision Exp 均使用两档价格：空闲价为高峰价的一半。自 2026-08-23 00:00 起，周六、周日全天按空闲价计费；周一至周五仍在北京时间 09:00–12:00、14:00–18:00 按高峰价计费，其余时段为空闲价。计费时段以服务端接收请求的北京时间为准；本地信息栏只作展示与估算。
- 官方价格页现已单列 `deepseek-v4-flash-vision-exp`，其当前各档价格与 `deepseek-v4-flash` 相同；代码中仍保留独立条目，以便服务商后续单独调价时直接更新，绝不按名称臆测。
- **v1.6 新增适配器说明**：moonshotai（Kimi）、openrouter、stepfun（阶跃）、zai（智谱）的余额/额度查询已接入，但定价表仅收录有明确官方价格的模型。GLM-4.5/4.6、Kimi K2.7/K3、Step-2 等模型的 flat 价格需待官方明确公布后添加，当前保持"不臆测"行为——未收录模型的花费显示为"unpriced"。
- **v1.7 说明**：新增的 ChatGPT 订阅卡（本地 JWT）、xiaomi 余额、xiaomi-token-plan 额度、Together / Fireworks / AWS Bedrock / Cloudflare 账单型显示，**全部只展示服务商官方 API 真实返回的金额/额度/账单，不新增任何本地定价估算条目**——`PRICING` 表未收录新模型价格（遵循"不臆测"规则），账单型金额来自官方计费接口，与本地定价表无关。
- 未收录的模型不显示峰谷价格，且不应凭名称猜测价格。

定价可能随服务商更新而变化；发布新版本前应重新打开上述正式页面并核对。
