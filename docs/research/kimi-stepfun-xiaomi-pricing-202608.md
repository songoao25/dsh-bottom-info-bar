# Kimi / StepFun / 小米 MiMo 官方按量定价采集记录（2026-08）

## 数据来源

- Kimi: `https://platform.kimi.com/docs/pricing/chat` 及 chat-k3 / chat-k25 / chat-k26 / chat-k27-code 分页
- StepFun: `https://platform.stepfun.com/docs/zh/guides/pricing/details`
- 小米 MiMo: `https://mimo.mi.com/docs/zh-CN/price/pay-as-you-go`

## 关键发现与陷阱记录

1. **小米 MiMo 本机 pi-ai 目录（dist/providers/data/xiaomi.json）里的 cost 字段是 USD 数字**（如 mimo-v2-flash input 0.14），不是 CNY；官方页 2026-08-06 调价后的实价是 ¥1.00 输入。若按 USD 数值配 CNY 币种会把花费**低估约 7 倍**——入库前必须以官方页数字为准。
2. **小米 2026-08-06 大幅调价**：V2-Pro 系 ¥7/¥21 → ¥3/¥6。
3. `mimo-v2.5-pro-ultraspeed` 仅见美元口径、人民币数无独立确认 → 按"不臆测"规则暂不收录，待官方明确。
4. **Kimi 同一型号在两个计费域价格不同**：api.moonshot.cn（¥）与 api.moonshot.ai（$）。为此价目表新增 `provider:model` 作用域键（例：`moonshotai-cn:kimi-k3`）；裸模型键刻意不填，防串币种。国际站 USD 数字待单独采集后以 `moonshotai:kimi-*` 收录。
5. Kimi Coding（api.kimi.com/coding）为订阅制，不适用按量价目表。
6. StepFun 旧系（step-1/step-2-mini/step-2-16k/step-3）2026-07-08 全部下线；在售仅 step-3.5-flash / step-3.7-flash 系。
7. 各家缓存写入价均未单列（免费或并入输入价），本表不涉及 cacheWrite。

## 入库清单（内置表 + catalog/pricing.json 同步）

- 小米 5 款、StepFun 2 款（裸键）；Kimi 国内站 10 款（作用域键）
- 三家全部 CNY、flat；来源 URL 已写入每条 notes
