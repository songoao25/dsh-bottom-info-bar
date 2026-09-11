# 信息栏插件

[**English**](README.md) | **中文**

[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/dsh-bottom-info-bar/ci.yml)](https://github.com/songoao25/dsh-bottom-info-bar/actions)

DeepSeek Harness 输入框下方那行统计栏的**直接替代品**。

原生统计栏有的（轮次与步数、LLM 耗时、工具调用、缓存命中率、输入输出 token）它**全部保留**，另外补上干活时真正想随时看到的东西：**真实余额**（或订阅额度、或本月真实账单）、**服务商与具体模型**、**高峰/空闲价格**与切换倒计时，以及**本对话已经花了多少**。

装一次、重启一次，之后每次启动自动生效。计费模式自动识别，每一个数字**要么来自服务商接口，要么被明确标注为估算**。

![信息栏预览：ChatGPT 订阅、DeepSeek 余额、OpenCode Go 订阅，各含完整与简洁两种视图](assets/bottom-info-bar-preview.jpeg)

<sub>截图为中文界面；DSH 语言设为 English 时文案会自动切换。图中自上而下三组：**ChatGPT 订阅**、**DeepSeek 余额**、**OpenCode Go 订阅**——每组都是先**完整**视图、后**简洁**视图。</sub>

## 一眼看懂

- **三种计费模式自动切换** —— 余额制、订阅额度制、云账单制，互斥不重叠，无需手动选择。
- **真实数据，且诚实标注** —— 余额、额度、套餐、账单全部来自各家官方 API。唯一拿不到接口的那一项（OpenAI 无公开余额接口）按你的消耗速度推算，并在界面上标出**（估算）**。
- **与 DSH 显示完全一致** —— 服务商与模型名取自 DSH 模型切换器，新模型自动跟随，不用改插件。
- **高峰 / 空闲价** —— 两个价格并列，并给出切换倒计时（周末全天空闲价）。
- **诚实的花费记账** —— 本对话（含子代理）、今天、近 30 天、累计，落盘保存，重启不丢。
- **原生观感** —— 顶替原生统计栏而不是并列重复；点击切换完整/简洁，字段与配色可在设置里自选。

## 前置要求

- **[DeepSeek Harness](https://github.com/deepseek-ai)**，且使用 **Web 界面**（`dsh web`）。本插件**只支持 Web**——信息栏本身就是一个网页 UI 组件。
- **[pnpm](https://pnpm.io/)** —— `dsh plugin` 用它管理 profile 里的包。
- 你所使用服务商的 API Key，在 DSH 的 **设置 → 模型** 里配置。

## 快速开始

```bash
dsh plugin --profile web add dsh-bottom-info-bar
```

然后 **重启 `dsh web`** —— 插件在宿主进程启动时组合，**刷新页面不够**。

安装就到这里：配好服务商的 API Key、重启，完事。

<details>
<summary>其它安装方式（以及该怎么选）</summary>

**推荐用上面的 npm 命令。** 它是唯一能让内置的版本更新提醒给你一条可用更新命令的安装方式——见 [更新版本](#更新版本)。

**从本地代码安装**（用于开发，或想跑未发布的代码）：

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin
```

这会产生 `link:` 安装：它跟随你的本地代码而不是 npm，所以更新方式是 `git pull` 而不是装包——见 [更新版本](#更新版本)。

**一键脚本** —— clone 与安装一步完成：

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh                # 默认装到 web profile；用 --profile <name> 改
```

与「从本地代码安装」一样，这同样是 `link:` 安装。

详细步骤与故障排查见 [docs/INSTALL.md](docs/INSTALL.md)。
</details>

## 它不做什么

边界也是设计的一部分，值得说清楚：

- **绝不把猜测当成事实。** 每个数字要么来自服务商接口——要么，在唯一没有接口的那一项（OpenAI 无公开余额接口）上，按你的消耗速度推算，并在界面上标注**（估算）**。拿不到数字时，信息栏会明说，而不是填一个猜测上去。
- **绝不自动更新自己。** 版本提醒只负责告诉你"有新版本"并准备好命令；在你亲手运行之前，机器上不会有任何改动。
- **绝不绑定你的 ChatGPT 账号。** 那是配套插件 [dsh-chatgpt-subscription](https://github.com/songoao25) 的职责。本插件只读本地令牌。
- **绝不保存对话内容。** 账本记录的是 token、模型、服务商与花费——没有提示词、没有消息、没有 API Key。
- **不适用于 Web 之外的界面。** 终端或 headless 下没有对应的信息栏。

## 三种计费模式

信息栏跟随 DSH 的当前会话，按服务商自动决定显示内容，**无需手动切换模式**。

### 余额制（DeepSeek / Kimi / OpenRouter / StepFun / 小米 MiMo / OpenAI 参考价）

显示服务商官方接口返回的**真实余额**。信息栏打开、刷新、或切换服务商时会立即重新查询，之后每 60 秒轮询一次。查询失败时保留上一次的快照，**这一行永远不会变空白**。

余额低于 ¥20 时，金额与「低」标记转为红色。

### 订阅额度制（ChatGPT / Codex、OpenCode Go、智谱、小米 MiMo Token Plan）

显示**各窗口剩余额度**（5 小时 / 周 / 月，剩余 = 100 − 已用）与**距下次重置的倒计时**。额度与倒计时**永远取自同一个窗口**，不会互相矛盾。

- **ChatGPT / Codex** —— 在**本机离线解析** `~/.codex/auth.json`，显示真实套餐与到期时间（例如 `ChatGPT · Plus | Expires 2026-09-16`）。**零网络请求**：数值直接来自 OpenAI 自己的登录令牌，不做估算。未登录 → 显示**刷新失败**并提示重新授权。令牌的**绑定与续期**由配套插件 [dsh-chatgpt-subscription](https://github.com/songoao25) 负责——本插件**只读**令牌，绝不写回。
- **OpenCode Go** —— 通过 `OPENCODE_GO_API_KEY`（设置 → 模型）或 opencode CLI 的登录（`~/.local/share/opencode/auth.json`）读取 `opencode.ai/zen/go/v1/usage` 的额度。未配置 → 显示「未配置」提示而非报错。
- **智谱** —— 通过 `ZAI_CODING_CN_API_KEY`（回退 `ZAI_API_KEY`）读取 GLM Coding Plan 额度：套餐档位 + 5 小时窗口。
- **小米 MiMo Token Plan** —— 通过 `XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY` 按区域读取月度 Credits 额度（回退 `XIAOMI_API_KEY`）：套餐名 + 月度窗口。

简洁模式下优先显示**时长最短的窗口**（5 小时 > 周 > 月），因为它刷新最快；5 小时窗口不可用时依次回退到周、月。

### 账单制（Together / Fireworks / AWS Bedrock / Cloudflare）

显示官方账单接口返回的**本月真实花费**，例如 `Together | 本月 $12.34`、`AWS Bedrock | 本月 $45.60 · 预算 46%`。Cloudflare 还会显示每日免费额度剩余与 UTC 零点重置倒计时——**但仅在接口确实返回免费额度时才显示**；否则只显示真实用量，**绝不编造额度**。未配置密钥 → 显示「未配置」提示。

## 花费记账

每一次 `llm/stream` 请求都会被记录（用量 × 单价），并按四个口径聚合：**本对话**（含子代理）、**今天**、**近 30 天**、**累计**。

子代理与主会话走同一个服务商账户，因此其花费会并入当前会话。**单价在响应完成的那一刻锁定**，之后的价目表更新绝不会改写历史金额。价目表中没有的模型保留 token 用量但不计入金额，也**不会被编造出一个价格**。

重启不丢：新账目会先把流水**同步落盘确认**，再计入界面；若这次写入失败，信息栏会明确显示**账单未保存**，而不是悄悄少算一笔。账本明细会自动归档成汇总、统计增量计算，因此用上几个月界面刷新也不会变慢。

## 更新版本

插件在一次完整的 DSH 启动后检查一次 npm 上是否有新版本。有新版时，信息栏会出现红色的**新版本提醒**标签。

**点击这个标签**，更新命令就会复制到剪贴板——粘到终端执行，然后重启 `dsh web` 即可。复制成功后标签会短暂显示「更新命令已复制」。

把鼠标停在标签上会说明两条路径：让有终端权限的 Agent 帮你更新，或者点击标签自己复制命令。

复制的命令与你的安装方式匹配：

| 你的安装方式 | 拿到的命令 |
|---|---|
| npm（`dsh plugin add dsh-bottom-info-bar`） | `dsh plugin --profile <profile> add dsh-bottom-info-bar@latest` |
| `link:`（本地代码 / 一键脚本） | `git -C <你的代码目录> pull --ff-only` |

**它绝不会自动执行更新。** 插件只负责告诉你「有新版本」，在你亲手运行命令之前，机器上不会有任何改动。

## 支持的服务商

信息栏从 DSH 当前模型列表识别服务商——**零配置**。在 DSH 的「设置 → 模型」里配好密钥即可。DSH 尚未提供模型时，信息栏会**等待**，而不是猜一个。

### 余额制

| 服务商 | 显示名 | 凭据 | 数据来源 |
|---|---|---|---|
| deepseek / deepseek-official | DeepSeek | `DEEPSEEK_API_KEY` | 官方接口 |
| openai | OpenAI | `OPENAI_API_KEY` | 按消耗速度推算——官方无公开余额接口，界面上会标注**（估算）** |
| moonshotai / moonshotai-cn / kimi-coding | Kimi | `MOONSHOT_API_KEY`（回退 `KIMI_API_KEY`） | 官方接口 |
| openrouter | OpenRouter | `OPENROUTER_API_KEY` | 官方接口 |
| stepfun | StepFun | `STEPFUN_API_KEY` | 官方接口 |
| xiaomi | 小米 MiMo | `XIAOMI_API_KEY` | 官方接口 |

### 订阅额度制（额度窗口）

| 服务商 | 显示名 | 令牌来源 |
|---|---|---|
| codex / chatgpt / openai-codex | ChatGPT / Codex | `~/.codex/auth.json`（只读，本机解析） |
| opencode-go / opencode | OpenCode Go | `OPENCODE_GO_API_KEY` 或 opencode 登录文件 |
| zai / zai-coding-cn | 智谱 | `ZAI_CODING_CN_API_KEY`（回退 `ZAI_API_KEY`） |
| xiaomi-token-plan-cn / -sgp / -ams | 小米 MiMo | `XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY`（回退 `XIAOMI_API_KEY`） |

### 账单制（本月真实账单）

| 服务商 | 显示名 | 凭据 | 数据来源 |
|---|---|---|---|
| together | Together | `TOGETHER_API_KEY` | 官方用量接口（本月花费） |
| fireworks | Fireworks | `FIREWORKS_API_KEY` | 官方账单接口（周期花费） |
| amazon-bedrock | AWS Bedrock | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Cost Explorer + Budgets（花费 + 预算占比） |
| cloudflare-ai-gateway / cloudflare-workers-ai | Cloudflare | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID`（令牌需 Billing 读权限） | 计费用量接口（真实用量） |

**不在列表中的服务商**会显示**不支持**提示，而不是拿别的服务商的数据顶上。

### 关于模型名 V41-Flash

如果你看到 `V41-Flash` 并以为写错了，这里是完整的来龙去脉：

- **它就是 DeepSeek V4.1 Flash。** 真正在为你提供服务的模型，按 V4.1 Flash 官方公布的高峰/空闲价计费。
- **`DeepSeek-V41-Flash` 是 DSH 自己模型目录里的写法**——模型 id 为 `deepseek-flash`，显示名少了那个点。信息栏刻意与 DSH 的模型切换器保持一致，所以这个写法来自 DSH，不是本插件。
- **它对你的使用没有任何影响。** 同一个模型、同样的价格、同样的额度。信息栏显示的就是 DSH 显示的内容；DSH 哪天改名了，信息栏会自动跟着变，**不需要更新插件**。

`DeepSeek-V4-Flash` 则是**另一个**更早的模型 id，不是同一个模型。

## 界面语言

插件跟随 DSH 的 **设置 → 通用 → 语言**。切换语言无需刷新页面即可生效，插件**没有**独立的语言开关。宿主侧文案使用 DSH 已保存的语言偏好；远程浏览器里未保存的语言选择无法改变宿主文案；来自外部服务商/系统的消息保持原文。详见[本地化说明](docs/LOCALIZATION.md)。

## 数据存储

插件记录的一切都放在它自己的目录里，与其它插件和 DSH 配置完全隔离：

```
~/.dsh/dsh-bottom-info-bar/
├── usage-records.json           # 完整账本，人类可读
├── usage-records.journal.jsonl  # 恢复用流水，请勿手改
└── usage-records.json.bak       # 上一份完整快照，用于恢复
```

- **权限** —— 目录 `0700`、文件 `0600`，启动时自动收敛：只有你自己的账户可读。
- **换位置** —— 设置环境变量 `DSH_BOTTOM_INFO_BAR_DATA_DIR` 可整体迁移（外置硬盘、同步盘等）。
- **查看与迁移** —— 用任意编辑器打开 `usage-records.json`。换电脑时，在 DSH 关闭状态下整目录拷贝即可。
- **内容** —— 每条模型响应一条记录（`id / ts / model / provider / sessionId / input / cacheRead / cacheWrite / output / currency / cost / status`），`status` 为 `completed` 或 `interrupted`。**绝不保存对话内容、提示词或 API Key。**
- **保留** —— 没有静默的条数上限；若需要跨机器长期留存，请把该目录纳入你的常规备份。
- **管理** —— **设置 → 信息栏 → 账单数据**可导出 CSV/JSON，或在确认后清除插件记录。设置、登录信息与价目数据不受影响；**卸载插件也不会删除你的数据**。

> 金额只按当前服务商币种聚合（DeepSeek 为 CNY、OpenAI 参考价为 USD），跨币种绝不混加。DeepSeek 高峰时段为北京时间工作日 09:00–12:00 与 14:00–18:00；周末全天空闲价。

## 卸载

```bash
cd dsh-bottom-info-bar
./uninstall.sh
# 或手动：dsh plugin --profile web remove dsh-bottom-info-bar
```

重启后原生统计栏自动恢复，无残留。记账数据仍保留在 `~/.dsh/dsh-bottom-info-bar/`——想彻底清零，请在「设置 → 信息栏 → 账单数据」中导出后确认清除。

ChatGPT 的绑定与令牌维护属于独立插件 `dsh-chatgpt-subscription`，卸载本信息栏不会影响它。

## 常见问题

| 现象 | 怎么办 |
|---|---|
| 刷新页面后信息栏没出现 | **重启 `dsh web`** —— 宿主在启动时组合插件 |
| 余额显示 **未配置 DEEPSEEK_API_KEY** | 到「设置 → 模型」填入密钥 |
| 余额显示**刷新失败**但仍能看到数字 | 网络或密钥的临时问题；60 秒后自动重试，并保留上次数值。**把鼠标停在警告上**可看详情 |
| OpenCode Go 显示**刷新失败**且提示缺少凭据 | 到「设置 → 模型」填 `OPENCODE_GO_API_KEY`，或用 opencode CLI 登录 |
| ChatGPT 显示**未连接** | 安装配套插件 `dsh-chatgpt-subscription` 并登录 |
| ChatGPT 的套餐或到期时间为空 | 重新登录或重新绑定。若令牌里确实没有这些字段，信息栏会留空而不是猜 |
| 怎么更新插件？ | 点红色的**新版本提醒**标签复制命令，然后重启 `dsh web`。详见[更新版本](#更新版本) |
| 模型显示成 `V41-Flash` | 不是错字——那是 DSH 对 **V4.1 Flash** 的写法。详见[关于模型名](#关于模型名-v41-flash) |
| 简洁模式显示的额度窗口和完整模式不同 | 这是有意的：简洁模式优先最短窗口（5 小时 > 周 > 月）。额度与倒计时仍取自同一窗口 |
| 为什么看不到模型的思考过程？ | DSH 不在界面上渲染内部推理——这是 DSH 界面层的限制，与本插件无关 |
| 我想换回原来的统计栏 | 卸载插件并重启 |

## 开发

- **源码** —— `plugin/src/host.js`（宿主侧）与 `plugin/src/client-bundle.js`（客户端）
- **构建** —— `cd plugin && npm run build`（生成 `lib/`）
- **测试** —— `node tests/run-all.mjs`（先构建，再跑全部测试套件）
- **版本记录** —— [CHANGELOG.md](CHANGELOG.md)
- **参与贡献** —— [CONTRIBUTING.md](CONTRIBUTING.md)；日常流程与发布机制见 [docs/WORKFLOW.md](docs/WORKFLOW.md)

这个项目所有"踩过坑才学会"的规矩都由 **CI 强制执行**而不是靠口头约定——测试套件、源码守卫、发布链条契约都会在每个 PR 上运行。Agent 需要遵守的约束见 [AGENTS.md](AGENTS.md)。

## 许可证

[MIT](LICENSE) © 2026 songoao25
