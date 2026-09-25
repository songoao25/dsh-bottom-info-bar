# 底部信息栏

[**English**](README.md) | **中文**

[![npm 版本](https://img.shields.io/npm/v/dsh-bottom-info-bar)](https://www.npmjs.com/package/dsh-bottom-info-bar)
[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)

DeepSeek Harness 插件：把输入框下方那行统计栏换成一行信息栏——服务商与模型、真实余额或订阅额度、高峰/空闲定价，以及本会话已经花了多少。

![信息栏完整模式](assets/bar-full.zh-CN.webp)

## 它显示什么

| 分组 | 内容 |
|---|---|
| 服务商 | 当前会话的服务商与具体模型，跟随 DSH 模型切换器 |
| 原生统计（保留） | 轮次与步数、模型耗时、工具耗时、缓存命中率、输入/输出 token、上下文占用 |
| 金额 | 真实余额、订阅额度窗口，或本月云账单 |
| 定价 | 高峰价与空闲价、当前时段、下次价格切换倒计时 |
| 花费 | 本会话（含子代理）、今天、近 30 天、累计 |
| 其它 | 主时间、世界时间、自定义文字 |

信息栏有两种显示方式，点击即可切换：**简洁**只保留服务商、模型和一项核心账户信息——余额、最短的有效额度窗口，或本计费周期花费，右端始终跟着上下文占用圆环；**完整**显示所有已启用细节，并保留 DSH 原生统计行。两种方式都跟随 DSH 的深色/浅色主题。

## 简洁模式

四种真实状态：浅色与深色、余额制与订阅额度制。

**浅色 · 余额制**

![余额制·浅色](assets/bar-compact-light-balance.zh-CN.webp)

**深色 · 余额制**

![余额制·深色](assets/bar-compact-dark-balance.zh-CN.webp)

**浅色 · 订阅额度制**

![订阅额度制·浅色](assets/bar-compact-light-subscription.zh-CN.webp)

**深色 · 订阅额度制**

![订阅额度制·深色](assets/bar-compact-dark-subscription.zh-CN.webp)

## 三种计费模式

信息栏跟随当前会话，按服务商自动选择模式。三种模式互斥，无需手动切换。

### 余额制

显示服务商官方接口返回的真实余额。信息栏打开、页面刷新或切换服务商时立即重查，之后每 60 秒轮询一次；刷新失败时保留上一次的数值。余额低于 20（按账户币种）时，金额与**低**标记转红。

### 订阅额度制

完整模式显示各窗口剩余额度（5 小时 / 周 / 月）与距下次重置的倒计时——两者始终取自同一个窗口，不会互相矛盾。窗口默认按**剩余**显示百分比，可在设置里切换为**已用**；低额度告警始终按剩余 ≤ 20% 判定。简洁模式只保留时长最短的可用窗口（5 小时 → 周 → 月），不显示重置倒计时。

### 云账单制

显示官方账单接口返回的本月真实花费，例如 `Together | 本月 $12.34`、`AWS Bedrock | 本月 $45.60 · 预算 46%`。Cloudflare 还会在接口确实返回免费额度时，显示每日免费额度剩余与 UTC 零点重置倒计时。

## 安装

需要带 Web 界面的 DeepSeek Harness（`dsh web`）与 pnpm。

**npm 安装**（推荐，装的是已发布版本）：

```bash
dsh plugin --profile web add dsh-bottom-info-bar
```

**从 GitHub 仓库安装** —— [github.com/songoao25/dsh-bottom-info-bar](https://github.com/songoao25/dsh-bottom-info-bar)（跟随默认分支；`lib/` 已入库，安装时不跑构建）：

```bash
dsh plugin --profile web add https://github.com/songoao25/dsh-bottom-info-bar
```

**本地一键脚本**（clone、构建、安装一步完成）：

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh
```

如果你在「包移到仓库根」之前用本地代码装过，profile 里的路径末尾是 `/plugin`。这条路径依然有效——仓库里保留了 `plugin/` 软链指向仓库根，所以不必重装。万一它不生效（例如用 ZIP 下载仓库时，软链会变成普通文件），先卸载，再用上面的任一方式装一次。

然后**重启 `dsh web`** —— 插件在宿主启动时组合，刷新页面不够。重启后插件出现在插件列表并处于启用状态：

![插件列表：底部信息栏已安装](assets/plugins-list.zh-CN.webp)

详细步骤与故障排查见 [docs/INSTALL.md](docs/INSTALL.md)。

## 设置

配置都在插件页（**插件 → bottom-info-bar**），改完自动保存。

![插件设置页总览](assets/settings-overview.zh-CN.webp)

**信息显示方式** —— 选择**简洁**或**完整**，选择会自动保存。简洁模式不会改掉字段开关，切回完整模式即可查看已启用的全部细节。

**字段与配色** —— 每个字段一个开关、一个颜色，分三组。关掉哪个字段，信息栏就不再显示它。三组默认都收起，想看哪组点哪组（在搜索框里打字会把三组一起展开）。字段归哪一组，决定它能不能出现在简洁模式里。

- **原生信息** —— DSH 原生统计栏本来就有的字段，只在完整模式出现。
- **插件信息** —— 信息栏新增的全部内容：服务商与模型、订阅、花费、余额、定价与额度，以及接管过来的上下文圆环。简洁模式与完整模式都显示。
- **提醒信息** —— 更新与失败短标记，以及「刷新失败」这类一次性提醒。两种模式都显示，每条单独开关。

上下文圆环固定在主行最右端，而主行正是简洁模式保留的那一行，所以两种模式下它都在。

![原生信息字段](assets/settings-native.zh-CN.webp)
![插件信息字段](assets/settings-plugin.zh-CN.webp)

**订阅窗口百分比方向** —— 按**剩余**（默认）或**已用**显示额度窗口。低额度告警始终按剩余 ≤ 20% 判定。

![订阅窗口百分比方向：剩余](assets/settings-quota.zh-CN.webp)
![订阅窗口百分比方向：已用](assets/settings-quota-used.zh-CN.webp)

**时间与日期** —— 主时间与世界时间的时区，以及年 / 月 / 日 / 时 / 分 / 秒的显示格式。

![时间与日期设置](assets/settings-time.zh-CN.webp)

**自定义文字** —— 最多 64 个字符，显示在信息栏中。

![自定义文字设置](assets/settings-custom.zh-CN.webp)

**账单数据** —— 导出 CSV / JSON，或确认后清除记录。设置与登录信息不受影响。

## 支持的服务商

信息栏从 DSH 当前模型识别服务商，零配置；密钥在 DSH 的**设置 → 模型**里填写。

### 余额制

| 服务商 | 显示名 | 凭据 / 数据来源 |
|---|---|---|
| deepseek / deepseek-official | DeepSeek | `DEEPSEEK_API_KEY` |
| openai | OpenAI | `OPENAI_API_KEY` —— 按消耗速度估算；官方没有公开余额接口 |
| moonshotai / moonshotai-cn / kimi-coding | Kimi | `MOONSHOT_API_KEY` |
| openrouter | OpenRouter | `OPENROUTER_API_KEY` |
| stepfun | StepFun | `STEPFUN_API_KEY` |
| xiaomi | 小米 MiMo | `XIAOMI_API_KEY` |

### 订阅额度制

| 服务商 | 显示名 | 凭据 / 数据来源 |
|---|---|---|
| codex / chatgpt / openai-codex | ChatGPT / Codex | `~/.codex/auth.json`（只读，本机解析） |
| opencode-go / opencode | OpenCode Go | `OPENCODE_GO_API_KEY` 或 opencode CLI 登录 |
| zai / zai-coding-cn | 智谱 | `ZAI_CODING_CN_API_KEY`（回退 `ZAI_API_KEY`） |
| xiaomi-token-plan-cn / -sgp / -ams | 小米 MiMo | `XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY`（回退 `XIAOMI_API_KEY`） |
| command / command-code | Command Code | `COMMAND_CODE_API_KEY` 或 `CMD_API_KEY`，或 `~/.commandcode/auth.json` |
| minimax / minimax-cn | MiniMax | `MINIMAX_API_KEY`（Global）/ `MINIMAX_CN_API_KEY`（国内）—— 必须是 **Subscription Key** |

### 云账单制

| 服务商 | 显示名 | 凭据 / 数据来源 |
|---|---|---|
| together | Together | `TOGETHER_API_KEY` —— 官方 Usage API，本月花费 |
| fireworks | Fireworks | `FIREWORKS_API_KEY` —— 官方 Billing API，本周期花费 |
| amazon-bedrock | AWS Bedrock | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` —— Cost Explorer + Budgets |
| cloudflare-ai-gateway / cloudflare-workers-ai | Cloudflare | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID`（令牌需 Billing 读权限） |

不在列表中的服务商显示**未适配**提示，绝不借用别的服务商的数据。

## 花费记账

每次模型响应都会记录一条（用量 × 单价），并按四个口径聚合：**本会话**（含子代理）、**今天**、**近 30 天**、**累计**。单价在响应完成的那一刻锁定，之后的价目表更新不会改写历史金额。价目表里没有的模型保留 token 用量但不计入金额，绝不编造金额。记录先落盘再计入，重启不丢；写入失败时信息栏显示**账单未保存**。

## 更新

插件在每次 DSH 启动后不久检查一次 npm 上有没有新版本。更新方式在插件设置页的**版本与更新**里二选一：

- **全自动更新**（默认）：发现新版本就自动下载、校验、替换好，你只需要重启一次 DSH 就生效。
- **手动更新**：只提示、不下载，你点「检查更新」时才执行。这个按钮只在选手动时出现。

检查只发生在启动那一次（装好也本来就要重启才生效，而重启本身就会触发下一次检查），所以设置页里会写明**上次检查**是什么时候，你不用猜它有没有在干活。

替换前先校验文件完整性，任何一步没过就整批回滚，不会把正在用的版本弄坏。万一新版有问题，设置页会出现「回滚到上一版」并说明原因；确认没问题之后它就不占位了。整个过程只改插件自己的文件，不碰依赖树，也不改 profile 的清单。

需要你动手时，信息栏会出现两枚短标记：**重启生效**（新版已装好，等重启）和**更新失败**（上次更新没成功）。两枚标记各自可以在「提醒信息」里关掉，平时不占位。更新失败时设置页会用一句人话讲清原因，原始报错留在 `~/.dsh/dsh-bottom-info-bar/update-log.jsonl` 里备查。

自更新只在插件被正常装进 profile 时启用（npm、GitHub 地址、一键脚本三种安装方式都算）。如果你用的是本仓库的源码副本或 `link:` 安装，插件会把它当成只读副本、不去改动，这时按下面的方式手动更新：

| 安装方式 | 命令 |
|---|---|
| npm | `dsh plugin --profile <profile> add dsh-bottom-info-bar@latest` |
| GitHub 地址 | `dsh plugin --profile <profile> add <同一个地址>` |
| 本地代码或一键脚本 | `git -C <仓库> fetch origin && git -C <仓库> checkout main && git -C <仓库> merge --ff-only origin/main && node <仓库>/scripts/build.mjs` |

首次升级到 v1.19.0（或更早版本升上来）时，自更新这套流程还没装在你机器上，所以那一次仍要按上表手动更新；之后的版本就不用再管了。

## 隐私与安全

- **只读凭据。** API Key 始终留在 DSH 里；`~/.codex/auth.json` 与 `~/.commandcode/auth.json` 只在本机读取，绝不写回。本插件不负责绑定或续期账号。
- **不保存对话内容。** 账本只记录 token、模型、服务商、币种与花费——没有提示词、消息或密钥。
- **只存本地。** 数据在 `~/.dsh/dsh-bottom-info-bar/`（目录 `0700`、文件 `0600`）。除了信息栏自身发起的服务商接口请求，没有任何数据离开本机。
- **卸载不删数据。** 想彻底清零，在插件页的「账单数据」里导出或清除。

## 开发

- 构建：`npm run build`
- 测试：`node tests/run-all.mjs`
- 贡献：[CONTRIBUTING.md](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE) © 2026 songoao25

💬 有问题或想法？扫码加入微信群 **DeepThinking**：

<img src="assets/wechat-group.png" width="180" alt="微信群 DeepThinking 二维码">
