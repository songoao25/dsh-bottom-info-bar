# 安装 / 卸载 / 故障恢复

## 前置条件

- 已安装 DeepSeek Harness（网页端命令行安装需要 `dsh` CLI 在 PATH 中）
- 已安装 [pnpm](https://pnpm.io/)
- 网页端用 `dsh web` 启动。桌面客户端通过**插件 → 添加插件**安装；`desktop` 配置由客户端管理，命令行不允许修改。以下脚本和命令适用于 CLI 的网页端配置。

## 安装

### 方式一：在 DSH 插件页里添加（推荐）

**插件 → 添加插件**，「包名或地址」填 npm 包名：

```
dsh-bottom-info-bar
```

装的是 npm 上已发布的版本，与方式二完全相同，只是不用敲命令。

那一栏也可以直接填仓库地址 —— 包就在仓库根目录，所以填地址装的是默认分支的最新代码：

```
https://github.com/songoao25/dsh-bottom-info-bar
```

这种方式不跑构建（`lib/` 已入库），也不需要额外授权。更新就是再执行一次同样的命令。

### 方式二：命令行 NPM 安装

```bash
dsh plugin --profile web add dsh-bottom-info-bar
```

装的是已发布的版本，更新提醒给出的也是这条命令。

### 方式三：一键脚本（产生 `link:` 安装）

macOS / Linux：

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh
# 默认安装到 web profile
```

Windows（PowerShell，原生，无需 Git Bash）：

```powershell
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
.\install.ps1

```

卸载对应为 `./uninstall.sh` / `.\uninstall.ps1`（同样支持 `--profile` / `-Profile`）。

### 方式四：从本地代码安装（产生 `link:` 安装）

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
node scripts/build.mjs
dsh plugin --profile web add /path/to/dsh-bottom-info-bar
```

> 1.15.0 及更早的版本里，插件包放在仓库的 `plugin/` 子目录，安装路径末尾写的是 `/plugin`。仓库里保留了 `plugin/` 软链指向仓库根，所以旧路径依然可用、不必重装；万一不生效（例如用 ZIP 下载仓库时软链会变成普通文件），先 `dsh plugin --profile web remove dsh-bottom-info-bar`，再用上面的命令装一次。

### 安装原理

`dsh plugin add` 会：

1. 用 pnpm 把插件包安装到 profile 目录（本端 `DSH_HOME` 下的 `profiles/<name>/`，默认 `~/.dsh/profiles/<name>/`）；
2. 检测到包声明了 `dsh.bundle`（仓库根的 `cordis.patch.yml`），自动把包名加入 profile 的 bundle 层列表（`dsh.profile.bundles`）；
3. 下次启动 `dsh` 时，插件随 profile 自动加载——host 注册 HTTP 路由、client 注入页面信息栏。

**注意：安装后需要重启 DSH（网页端即重启 `dsh web`）才会生效**——宿主进程在启动时组合插件。刷新页面不足以加载 host 端。

### 验证安装成功

```bash
dsh --profile web --dump-config | grep -A2 dsh-bottom-info-bar
# 应看到 dsh-bottom-info-bar 行（bundle 层已生效）
```

重启后页面底部输入框下方出现信息栏即安装成功。

## 配置余额

在 **设置 → 模型** 中配置 DeepSeek API Key（环境变量名 `DEEPSEEK_API_KEY`）。
未配置时信息栏显示引导文案，其余功能（统计/定价/记账）不受影响。

## 配置订阅额度（可选，v1.1.0）

信息栏按当前服务商自动选择三种口径之一（互斥，无需手动切换）：**余额制**（DeepSeek 等）显示官方接口的真实余额，**订阅制**（Codex、OpenCode、小米 Token Plan、Command Code、MiniMax、智谱、阿里 Token Plan、Kimi For Coding）显示各额度窗口剩余额度与重置倒计时，**云账单制**（Together、Fireworks 等）显示官方账单的本月真实花费。订阅额度数据源：

- **Codex / ChatGPT**：信息栏**只读** `~/.codex/auth.json` 中的登录令牌，解析真实套餐与到期信息；token 仅在本机内存中使用，不落盘、不记录、不续期、不写回。令牌的**绑定 / 续期**由独立插件 [**dsh-chatgpt-sub**](https://github.com/songoao25/dsh-chatgpt-sub)（独立仓库）负责——安装并绑定后，本信息栏即可显示订阅信息；令牌缺失时信息栏显示「未绑定」引导，相关字段缺失时只保留服务商和模型。
- **OpenCode Go**：在 **设置 → 模型** 配置 `OPENCODE_GO_API_KEY`（或先用 opencode CLI 登录其订阅，写入平台共享目录 `opencode/auth.json` 的 `opencode-go` 条目：macOS/Linux 为 `~/.local/share/opencode/auth.json`，Windows 为 `%LOCALAPPDATA%\opencode\auth.json`）。未配置时信息栏显示"未配置 OpenCode Go"引导，不报错。
- **阿里 Token Plan（百炼，中国站 / 国际站）**：额度接口不认推理套餐 Key（`sk-sp-…` 只能推理），要另配阿里云 AccessKey——`ALIBABA_CLOUD_ACCESS_KEY_ID` 与 `ALIBABA_CLOUD_ACCESS_KEY_SECRET`（RAM 用户即可），配置给 DSH 凭据或设为同名环境变量（插件先读 DSH 凭据，再读环境变量）。最小权限：系统策略 `AliyunTokenPlanReadOnlyAccess` 覆盖官方 OpenAPI `GetSubscriptionStats`；官方 CLI 同款的控制台链路还要给该 RAM 用户一个自定义策略，授予 `modelstudio:GenerateCLIAccessToken`。两条链路都只读、不读浏览器 Cookie；未配置、权限不足或未订阅时信息栏给明确提示并保留上一份额度，不显示 0%。
- **Kimi For Coding**：配订阅专属 API Key `KIMI_API_KEY`（DSH 里 kimi-coding 的凭据名；回退 `KIMI_CODING_API_KEY` / `MOONSHOT_API_KEY`），配置给 DSH 凭据或设为同名环境变量；信息栏用 Bearer 调 `GET https://api.kimi.com/coding/v1/usages`，国内站不通时自动试国际站 `https://api.kimi.ai/coding/v1/usages`，显示 5 小时与周窗口。这个端点没有官方公开文档，可能随上游变化；读不到时保留上一份额度。

最小配置示例（示例值换成自己的凭据，别提交到仓库）：

```bash
export ALIBABA_CLOUD_ACCESS_KEY_ID="<your-access-key-id>"
export ALIBABA_CLOUD_ACCESS_KEY_SECRET="<your-access-key-secret>"
export KIMI_API_KEY="sk-..."
```

这两类都不需要额外插件，也不需要网页 Cookie；凭据只用于只读查询额度，不参与推理请求。

## 更新版本

插件在每次 DSH 启动后约 30 秒（另有 0–5 秒抖动）检查一次 npm 上有没有新版本——这个延迟刻意放在宿主启动完成之后，避免插件在宿主启动窗口里做下载或替换文件（见下方「启动诊断」）。处理方式在插件设置页的**版本与更新**里二选一：

- **全自动更新**（默认）：自动下载 → 校验 → 替换插件自己的文件，然后你重启一次 DSH 就生效。
- **手动更新**：只提示、不下载；点「检查更新」按钮才执行（该按钮只在手动方式下出现）。

设置页那一块分三层看：最上面是**状态**（结论 + 运行中版本 / 最新版本 / 上次检查时间），中间是**更新方式**二选一，最下面是**出问题时的办法** —— 「回滚到上一版」只在真需要时出现（新版已装好待重启，或上次更新失败），并写明为什么出现。更新失败时会用一句人话讲清原因，原始报错留在本端 `DSH_HOME` 下 `dsh-bottom-info-bar/update-log.jsonl`（默认 `~/.dsh/dsh-bottom-info-bar/update-log.jsonl`）。

检查只发生在启动那一次：新版本装好本来就要重启才生效，而重启本身会触发下一次检查。所以「上次检查」的时间就是判断它有没有在干活的依据。

替换前会校验文件完整性，任何一步失败都整批回滚，不会破坏正在运行的那一份。整个过程只改插件包内文件，不动 profile 的 `package.json` / `pnpm-lock.yaml`，也不碰依赖树。

**前提**：自更新只在插件被当作 profile 插件装载时启用（npm、GitHub 地址、一键脚本三种安装方式都算；Windows 与 macOS 的大小写差异已在判定里归一，不会误判）。源码副本与 `link:` 安装按只读处理，插件不会去改那份代码，需要按下面的方式手动更新。

手动更新时，按当初的安装方式二选一：

如果最初使用 NPM 安装：

```bash
dsh plugin --profile web add dsh-bottom-info-bar@latest
# 重启 DSH
```

如果最初填的是 GitHub 地址（方式一），更新就是再执行一次同样的命令：

```bash
dsh plugin --profile web add https://github.com/songoao25/dsh-bottom-info-bar
# 重启 DSH
```

如果最初使用本地代码 / symlink 安装（方式三、方式四），要**三步一起做**：拉代码 → 切到默认分支 → 重新构建：

```bash
cd dsh-bottom-info-bar
git fetch origin && git checkout main && git merge --ff-only origin/main
node scripts/build.mjs
# 重启 DSH
```

- **别只用 `git pull`**：分支没推到远端时它会直接失败（`no such ref was fetched`）——开发分支就是这种状态；而且 `link:` 安装加载的是构建产物 `lib/`，本地副本可能改过 `src/` 却没重建，只拉代码不重建，重启后跑的还是旧代码。
- 停在功能分支上时，更新前要先切回默认分支：信息栏加载的就是这份副本，快进一个功能分支不会改变任何东西。
- 三条命令都是 `--ff-only` / 非破坏性的：工作区不干净或分支上有本地提交时，git 会拒绝执行，而不是覆盖你的改动。

本地 symlink 安装**不会**被 NPM 更新命令替换；想迁移到 NPM，先移除旧安装，再执行 NPM 安装命令。

> 无论哪种方式，**更新后都必须重启 DSH** 才会生效。

首次升级到 v1.19.0 时自更新还没装在机器上（这套流程本身就在 v1.19.0 里），所以那一次仍需按上表手动更新；之后的版本不必再管。

## 信息栏出现「重启生效」/「更新失败」怎么办

这两枚短标记只作提示，**不需要点击**（插件没有打开设置页的能力，点它不会有反应）：

- **重启生效**：新版已经下载并替换到磁盘，内存里跑的还是旧代码。重启 DSH 即可，标记随之消失。
- **更新失败**：上次自动更新没成功（网络、校验或写入失败）。插件不会破坏现有安装，失败会自动回滚。到设置页的**版本与更新**里点「检查更新」重试；反复失败时按上一节手动更新一次。

两枚标记各自在设置页的**提醒信息**分组里有开关，不想要可以单独关掉；它们与「简洁 / 完整」模式无关，两种模式下都一样受开关控制。

如果想让 Agent 代劳排查，可以把下面这句话发给它：

> 我的 DSH 底部信息栏显示「更新失败」，请帮我看看本端 DSH_HOME 下 `dsh-bottom-info-bar/update-log.jsonl`（默认 `~/.dsh/dsh-bottom-info-bar/update-log.jsonl`）里的失败原因，再判断是重试还是手动更新。不要删除 `dsh-bottom-info-bar/usage-records.json`，不要覆盖未提交代码，更新后提醒我重启 DSH。

普通网页聊天如果没有本机终端权限，不能直接完成更新；Agent 仍应在执行删除、覆盖或迁移安装前先征得用户确认。

## 卸载

```bash
cd dsh-bottom-info-bar
./uninstall.sh
# Windows PowerShell：.\uninstall.ps1
# 或手动：
dsh plugin --profile web remove dsh-bottom-info-bar
```

重启后原生统计栏自动恢复（插件 unload 时槽位自动退位，这是 DSH 插槽特性）。插件代码无残留；记账数据会保留，不会被卸载操作删除。如需清空统计，请在「插件页（插件 → bottom-info-bar）→ 账单数据」中先导出，再确认清除。

## 故障排查

| 现象 | 原因与处理 |
|---|---|
| 信息栏不出现 | ① 没重启：需重启 DSH（网页端即重启 `dsh web`）；② 装错 profile：确认启动用的 profile 与安装目标一致（CLI 网页端通常为 `web`；桌面端请在应用的插件页检查）；③ `dsh --profile <name> --dump-config` 里没有 dsh-bottom-info-bar：重新执行安装 |
| 安装报 `pnpm not found` | 安装 pnpm：`npm i -g pnpm` 或 `corepack enable` |
| 安装报 `dsh-bottom-info-bar` 找不到 | 确认包名拼写；本地目录安装时路径要指向**仓库根**（包在仓库根，不是子目录） |
| 插件页报「这个包没有声明组合包」（英文界面：declares no bundle） | 装到的是一个「仓库根不是包」的仓库——那是包移到仓库根之前的本仓库。插件页里改填包名 `dsh-bottom-info-bar`，或用包含该修复的版本上的仓库地址 |
| 插件页提示「待批准的构建脚本」 | 装的是 1.15.0 及更早的仓库地址（旧清单带 `prepack`）。改用包名安装，或装包含修复的版本 |
| 余额显示未配置/刷新失败 | 见 README「常见问题」 |
| 桌面端启动约 10 秒后宿主不再响应新连接（余额、插件市场、新建会话全失效，退出被 SIGKILL） | 这是 issue #260 的宿主侧现象。新版本已把 sqlite 账本整体移出宿主主线程（worker 线程 + 首次使用时才打开），先升级再复测；若仍复现，按下方「启动诊断」做 `DSH_BOTTOM_INFO_BAR_LEDGER=off` 对照并把日志发到 issue #260 |
| 想彻底回到原生状态 | 卸载 + 重启，系统统计栏自动恢复 |


### 启动诊断（issue #260）

无法复现「宿主启动后不再接受新连接」时，用下面两组环境变量拿对照数据；它们只影响本插件，**不改宿主持久化数据**：

| 环境变量 | 作用 |
|---|---|
| `DSH_BOTTOM_INFO_BAR_SELF_UPDATE=off` | 完全关闭自更新（含启动检查）。用来对照「自更新完全不是触发点」 |
| `DSH_BOTTOM_INFO_BAR_STARTUP_TRACE=1` | 打开启动采样：apply 之后 2/8/15/30/60 秒各打一行 `[dsh-bottom-info-bar] startup-trace {...}`，含 pid、已打开 fd 数（仅 Linux）、活动 handle 数、距 apply 的毫秒数；事件循环滞后 ≥200ms 时额外打一行 `event-loop-lag`。只写 stderr，不落盘、不联网 |
| `DSH_BOTTOM_INFO_BAR_SELF_UPDATE_DELAY_MS=<毫秒>` | 覆盖自更新首次检查的基准延迟（默认 30000；只用于诊断/测试，会被钳到 0–6 小时） |
| `DSH_BOTTOM_INFO_BAR_LEDGER=off` | 完全关闭账本（花费统计不可用，余额/价目/信息栏照常）。用于对照「卡死是否与 sqlite 有关」：关掉后仍卡 → 与账本无关 |

启动方式：在启动 DSH 之前把变量放进环境（例如 `DSH_BOTTOM_INFO_BAR_STARTUP_TRACE=1 dsh web --profile web`；桌面端请通过桌面应用的启动脚本或系统服务环境注入）。按 `t+8000` 前后几行是否出现 `event-loop-lag`、`fds` 是否单调上涨，即可区分「插件同步阻塞主线程」「插件 fd 泄漏」「宿主自身 IO 停摆」三种情况。

新版本默认把账本放在 worker 线程里、首次用到时才打开，宿主主线程不再有同步 sqlite 调用；`startup-trace` 一路正常但仍卡，说明问题在宿主/桌面壳侧，请把日志发到 issue #260，插件侧会带着这些数据去对应的桌面壳仓库跟进。


## Ledger compatibility and recovery

The disk-backed ledger requires Node.js 22.13 or newer in the DSH host. Older
runtimes keep the rest of the plugin available but report the ledger as unavailable;
they do not silently fall back to the history-sized in-memory implementation.

Legacy JSON snapshots, journals and summaries are imported once with transactional
rollback. The original files remain in the same local data directory. New writes
use the database; running an older plugin against these retained files will not
show records written after migration. Export the current ledger before any manual
data downgrade. See [Ledger storage and recovery](LEDGER.md).
