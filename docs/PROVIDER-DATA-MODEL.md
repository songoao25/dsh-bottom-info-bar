# 统一服务商账户数据模型提案（ProviderAccountStatus v2）

> 依据：用户调研任务书"插件统一数据模型建议" + 现有 v1.6 实现（余额制快照 / 订阅制窗口快照）。
> 目的：所有服务商适配器输出同一结构 → 客户端一套渲染逻辑，不为每家写独立 UI。
> 状态：提案（v1.7+ 落地候选；v1.6 现有双模式结构是其子集）。

## 1. 模型

```ts
interface ProviderAccountStatus {
  provider: string            // DSH provider id（如 'zai-coding-cn'）
  providerType: string        // 'brand' | 'aggregator' | 'cloud' | 'gateway'
  authType: string            // 'api_key' | 'oauth' | 'access_key' | 'headers' | 'cli' | 'none'

  billingMode:               // 消费模式枚举
    'pay_as_you_go' | 'token_plan' | 'coding_plan' | 'subscription'
    | 'free_tier' | 'cloud_billing' | 'aggregator'

  planName?: string           // 套餐名（如 GLM Pro / Kimi Coding / Step Pro）
  currency?: string           // 'CNY' | 'USD' | ...

  cashBalance?: number        // 现金/充值余额
  giftBalance?: number        // 赠送/赠金余额
  creditBalance?: number      // Credits（如 OpenRouter / Step Plan / 小米 Token Plan）
  balanceUpdatedAt?: number

  usage?: {                   // 用量（累计，可来自官方 API 或本地记账）
    inputTokens?: number; outputTokens?: number
    cacheReadTokens?: number; cacheWriteTokens?: number
    requests?: number; creditsUsed?: number; cost?: number
  }

  quotaWindows?: Array<{      // 额度窗口（subscription/coding/token plan 核心）
    type: '5h' | 'daily' | 'weekly' | 'monthly' | 'billing_cycle' | 'plan'
    used?: number; limit?: number; remaining?: number
    usedPercent?: number      // 0-100
    resetAt?: number          // 下次重置（ms）
    expiresAt?: number        // 到期（plan 级）
  }>

  billing?: {                 // 账单周期（cloud/pay-as-you-go）
    currentPeriodSpend?: number; budget?: number
    billingCycleStart?: number; billingCycleEnd?: number
  }

  rateLimit?: {               // 速率限制（free_tier / headers 来源）
    requestsRemaining?: number; tokensRemaining?: number; resetAt?: number
  }

  subscription?: { plan?: string; expiresAt?: number; renewsAt?: number }

  source:                    // 数据来源分级
    'official_api' | 'response_headers' | 'local_calculation'
    | 'oauth_endpoint' | 'dsh_session' | 'unsupported'

  lastUpdated?: number
  error?: { kind: string; message: string }   // 失败保留旧快照，仅换 error
}
```

## 2. 与现有 v1.6 结构的映射（存量兼容）

| v1.6 现有 | 统一模型 | 说明 |
|---|---|---|
| 余额快照 data.{currency,total,granted,toppedUp} | cashBalance/giftBalance/currency | total = cash+gift；topUp→cash、granted→gift |
| 订阅快照 windows[{key,label,usedPercent,resetsAt}] | quotaWindows[{type,usedPercent,resetAt}] | key 映射：five_hour→5h、seven_day→weekly、monthly→monthly |
| 订阅 plan（'GLM Pro' / 'OpenCode Go'） | planName + billingMode | — |
| OpenAI 记账回退估算（estimate=true） | source='local_calculation' + cashBalance | — |
| 未适配（unmapped） | billingMode 未识别 + source='unsupported' | — |

## 3. 渲染规则（客户端一套逻辑）

- `quotaWindows` 非空 → 订阅制渲染（窗口百分比 + 重置倒计时；窗口缺失自适应）
- 否则 `cashBalance/giftBalance` 非空 → 余额渲染（金额 + 赠送标注 + 预警阈值）
- `usage.cost` 来自官方且有 `billing` → 账单渲染（cloud）
- 只有 `rateLimit` → free_tier 渲染（速率 + 重置倒计时）
- `source='unsupported'` → "未适配"引导

## 4. 各家 billingMode 分类（调研后填全，草稿）

| provider | billingMode | source |
|---|---|---|
| deepseek | pay_as_you_go | official_api（balance_infos） |
| openai | pay_as_you_go | local_calculation（估算） |
| openai-codex / chatgpt | subscription | oauth_endpoint（wham，D 级） |
| opencode-go | coding_plan | official_api（usage，社区逆向） |
| zai / zai-coding-cn | coding_plan | oauth/api_key endpoint（quota/limit，B/C 级） |
| moonshotai | pay_as_you_go | official_api（balance，A 级） |
| openrouter | aggregator | official_api（credits，A 级） |
| stepfun | pay_as_you_go（+ plan） | official_api（accounts，A 级） |
| qwen-token-plan(-cn) | token_plan | 待调研 |
| xiaomi-token-plan-* | token_plan | 待调研 |
| anthropic/google/xai/… | 待调研 | 待调研 |

## 5. 落地节奏建议
- v1.6（已就绪）：保持现有双模式结构，输出已含统一模型子集
- v1.7：内部聚合层收敛到 ProviderAccountStatus（host 统一产出，client 单渲染逻辑）；新增 provider 只写适配器
- 评估期：以全品牌调研的"是否推荐集成 + 稳定性等级"决定各 provider 接入顺序