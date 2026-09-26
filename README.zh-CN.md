# 底部信息栏

[**English**](README.md) | **中文**

[![npm 版本](https://img.shields.io/npm/v/dsh-bottom-info-bar)](https://www.npmjs.com/package/dsh-bottom-info-bar)
[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)

DeepSeek Harness 插件：把输入框下方那行统计栏换成一行信息栏——服务商与模型、真实余额或订阅额度、高峰/空闲定价，以及本会话已经花了多少。

![信息栏完整模式](assets/bar-full.zh-CN.webp)

## 它显示什么

信息栏跟随当前会话，按服务商自动选择三种口径之一（互斥，不用手动切）：**余额制**显示官方接口的真实余额，**订阅制**显示各额度窗口剩余额度与重置倒计时，**云账单制**显示官方账单接口的本月真实花费。之外还有本会话/今天/近 30 天/累计四档花费，以及时间、自定义文字等通用项。

点一下信息栏可以在**完整**与**简洁**之间切换，区别只有一处：完整保留 DSH 原生统计行，简洁把它收起。看哪个字段，只由该字段自己的开关决定，两种模式显示的主行逐字相同。

## 安装

```bash
dsh plugin --profile web add dsh-bottom-info-bar
```

然后**重启 DSH**（插件在宿主启动时组合，只刷新页面不够）。桌面客户端把 `--profile web` 换成 `--profile desktop`。其他装法（含 Windows PowerShell）与排障见 [docs/INSTALL.md](docs/INSTALL.md)。

## 设置

都在插件页（**插件 → bottom-info-bar**），改完自动保存，一共三组，每组默认收起：**原生信息**（DSH 原生统计行，只在完整模式出现）、**插件信息**（本插件新增的全部内容，两种模式都显示）、**提醒信息**（更新与失败这类一次性提醒，真有事才出现）。

![插件信息：按计费方式分块](assets/settings-plugin.zh-CN.webp)

「插件信息」里再按计费方式分块——你用哪种服务，就只看哪一块，哪几项有数据的说明写在块标题旁。时区、自定义文字、订阅窗口方向、账单数据是独立设置区：

![时间与日期：只设时区](assets/settings-time.zh-CN.webp)

密钥填在 DSH 的**设置 → 模型**；订阅类（Codex、OpenCode、小米 Token Plan、Command Code、MiniMax）读本机登录，MiniMax 必须用 Subscription Key。列表里没有的服务商只会显示未适配提示，绝不借用别家的数据。

## 花费与更新

每次模型响应记一条（用量 × 单价，单价在响应完成时锁定），重启不丢。插件每次随 DSH 启动检查一次新版本：**全自动更新**（默认）下载好等你重启生效，**手动更新**只提示不下载；新版有问题可以在设置页回滚到上一版。账本只记 token 与金额，不记对话内容；数据存放在本端 `DSH_HOME` 下的 `dsh-bottom-info-bar/` 目录（默认 `~/.dsh/dsh-bottom-info-bar/`，可用 `DSH_BOTTOM_INFO_BAR_DATA_DIR` 覆盖），卸载不删——要清零去设置页的账单数据里导出或清除。

## 开发

- 构建：`npm run build`
- 测试：`node tests/run-all.mjs`
- 贡献：[CONTRIBUTING.md](CONTRIBUTING.md)

## 许可证

[MIT](LICENSE) © 2026 songoao25

💬 有问题或想法？扫码加入微信群 **DeepThinking**：

<img src="assets/wechat-group.png" width="180" alt="微信群 DeepThinking 二维码">
