# Bottom Info Bar

**English** | [**中文**](README.zh-CN.md)

[![npm version](https://img.shields.io/npm/v/dsh-bottom-info-bar)](https://www.npmjs.com/package/dsh-bottom-info-bar)
[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)

A DeepSeek Harness plugin that replaces the stats row under the composer with one line: provider and model, real balance or subscription quota, peak/off-peak pricing, and what this session has cost.

![Bottom Info Bar in full mode](assets/bar-full.webp)

## What it shows

The bar follows the active session and picks one of three readings per provider (mutually exclusive, nothing to switch by hand): **balance** shows the real balance from the provider's own API, **subscription quota** shows each quota window's remaining allowance with its reset countdown, and **cloud billing** shows this month's real spend from the official billing API. On top of that come four spend tallies — this session, today, last 30 days, all time — plus extras such as time and custom text.

Click the bar to switch between **Full** and **Compact**. They differ in exactly one way: Full keeps DSH's native stats row, Compact collapses it. Whether a field appears is decided by that field's own switch alone, so the main row reads identically in both.

## Install

Recommended: open the DSH plugin page, add a plugin, and paste this repository URL — no commands needed:

```
https://github.com/songoao25/dsh-bottom-info-bar
```

Prefer the terminal? This installs the same thing from npm:

```bash
dsh plugin --profile web add dsh-bottom-info-bar
```

Then **restart DSH** — plugins are composed when the host starts, so a page refresh is not enough. Use `--profile desktop` instead of `--profile web` on the desktop client. Other install methods (including Windows PowerShell) and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).

## Settings

Everything lives on the plugin page (**Plugins → bottom-info-bar**) and saves as you change it, in three groups, all collapsed by default: **native information** (DSH's own stats row, Full mode only), **plugin information** (everything this bar adds, both modes), and **notices** (one-off update and failure reminders, shown only when there is really something to say).

![Plugin information grouped by billing mode](assets/settings-plugin.webp)

Plugin information is further grouped by billing mode — read only the block that matches your provider; each block's heading says which items carry data for it. Time zones, custom text, quota percentage direction and billing data are separate sections:

![Time and date: time zones only](assets/settings-time.webp)

API keys go in DSH under **Settings → Models**; subscriptions (Codex, OpenCode, Xiaomi Token Plan, Command Code, MiniMax) read the local sign-in, and MiniMax requires a Subscription Key. Anything off the list gets a not-supported hint instead of borrowed numbers.

## Spend and updates

Every model response records one entry (usage × unit price, locked the moment the response completes) and survives restarts. The plugin checks npm once per DSH start: **automatic updates** (default) download in the background and take effect after you restart, **manual updates** only notify; a bad release can be rolled back from settings. The ledger stores tokens and amounts, never conversation content; data stays under this end's `DSH_HOME` in `dsh-bottom-info-bar/` (default `~/.dsh/dsh-bottom-info-bar/`, overridable via `DSH_BOTTOM_INFO_BAR_DATA_DIR`) and survives uninstall — export or clear it from Billing data if you want a clean slate.

## Development

- Build: `npm run build`
- Test: `node tests/run-all.mjs`
- Contributing: [CONTRIBUTING.md](CONTRIBUTING.md)

## License

[MIT](LICENSE) © 2026 songoao25

💬 Questions or ideas? Join our WeChat group **DeepThinking** — [QR code](assets/wechat-group.png).
