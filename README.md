# Bottom Info Bar

**English** | [**中文**](README.zh-CN.md)

[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/dsh-bottom-info-bar/ci.yml)](https://github.com/songoao25/dsh-bottom-info-bar/actions)

The **best-adapted bottom info bar for [DeepSeek Harness](https://github.com/deepseek-ai)**, and a drop-in replacement for the native stats row under the composer. It shows a **fresh balance**, **subscription quota**, or **provider billing data** at a glance, alongside provider & model, peak/off-peak pricing, and real spend — **smart and concise**, **conflict-free**, and **native in look and feel**: it auto-detects the billing mode, replaces the native row instead of duplicating it, and matches the model switcher exactly. Install once; it activates automatically on every launch.

## Preview

![Bottom Info Bar preview: ChatGPT subscription, DeepSeek API, and OpenCode Go subscription](/assets/bottom-info-bar-preview.jpeg)

The preview was captured before the English UI update. From top to bottom, the combined screenshot shows **ChatGPT subscription**, **DeepSeek API**, and **OpenCode Go subscription**. Each account is shown in **full view** followed by **compact view**.

## Features

- **Three-state billing bar** — Auto-detects whether the active provider is **subscription-based** (quota windows: Codex / OpenCode Go / Zhipu / Xiaomi MiMo Token Plan), **cloud-billing-based** (this month's real bill: Together / Fireworks / AWS Bedrock / Cloudflare), or **balance-based**. The three modes replace each other, never overlap; balance mode stays exactly as before.
- **ChatGPT subscription card (pure local)** — When the active provider is **ChatGPT / Codex**, the bar decodes `~/.codex/auth.json` locally and shows the **real plan tier + expiry date**, e.g. `ChatGPT · Plus | Expires 2026-09-16` — zero network, real fields straight from OpenAI's own login token (chatgpt_plan_type / subscription_active_until), no local estimation. Not signed in → **Refresh failed**, with a reauthorization reminder in the tooltip. Binding, token refresh and the `openai-codex` model route are **not part of this plugin** — install the companion plugin [**dsh-chatgpt-subscription**](https://github.com/songoao25) (separate repo) to bind your ChatGPT account; this bar only reads the token.
- **Subscription quota display (OpenCode Go / Zhipu / Xiaomi MiMo Token Plan)** — When the active provider is a subscription service, the bar shows the **subscription service · model** (e.g. `OpenCode Go · V4 Flash`, `Xiaomi MiMo · Mimo-V2.5`), the **5-hour / weekly / monthly quota remaining** per window (remaining = 100 − used), and a **countdown to the next reset** (e.g. `Resets in 1d 21h`). **Quota and countdown always match** — both come from the same window. Quota sources:
  - **OpenCode Go** — reads quota from `opencode.ai/zen/go/v1/usage` via `OPENCODE_GO_API_KEY` (Settings → Models) or the opencode CLI login (`~/.local/share/opencode/auth.json`); missing key → "not configured" hint instead of an error.
  - **Zhipu (zai / zai-coding-cn)** — reads GLM Coding Plan quota via `ZAI_CODING_CN_API_KEY` (fallback: `ZAI_API_KEY`); shows plan tier + 5-hour window remaining.
  - **Xiaomi MiMo Token Plan** — reads monthly Credits quota via `XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY` per region (fallback: `XIAOMI_API_KEY`); shows plan name + monthly window.
- **Cloud-billing display (real monthly bill)** — When the active provider is **Together / Fireworks / AWS Bedrock / Cloudflare**, the bar reads the official billing API and shows **this month's real spend**, e.g. `Together | This month $12.34`, `AWS Bedrock | This month $45.60 · Budget 46%`. Cloudflare additionally shows daily free-quota remaining and a UTC-midnight reset countdown **only when the API actually reports a free allowance** (otherwise it shows real usage only — never fabricated). All bill figures come from official provider APIs; **no local estimation is ever displayed**. Missing keys → "not configured" hint.
- **Drop-in replacement** — Replaces the native stats row while keeping its core original information (turns/steps, LLM latency, tool calls, cache hit rate, in/out tokens) with a native-consistent layout. Speed metrics (TTFT, tok/s) move to the hover tooltip so the row stays on a single line.
- **Provider & model detection** — Follows the active session in DSH and reads provider/model names from DSH's current model list (for example, `DeepSeek · V41-Flash`). Newly published models are picked up automatically, without a plugin model list to maintain. While the current model is not available yet, the bar says it is reading the model instead of guessing or borrowing another model's data.
- **Fresh balance** — Fetches real balance from DeepSeek's `/user/balance` API, refetches immediately when the bar opens/refreshes or the provider changes, then auto-refreshes every 60 s. This is polling rather than a provider-pushed real-time stream; provider-side billing delay still applies. The last known snapshot is kept on failure so usage is never interrupted.
- **Peak / off-peak pricing** — Shows peak (alert red, bold) and off-peak (green, bold) prices with a countdown to the next switch; hidden automatically for providers without tiered pricing. The text labels remain visible in both appearances.
- **Real spend tracking** — Records every `llm/stream` request (usage × unit price) and aggregates precisely by **this session (includes subagents) / today / last 30 days / all time**. Subagents share the same provider account, so their records are folded into the current session's spend (session starts at the earliest record of the current session, then every same-account record from that moment on counts). Records are persisted to disk — nothing is lost on restart.
- **Bold numbers** — Balance, countdown, spend, and all stats are rendered with bold numerals for instant readability.
- **Full / compact toggle** — Click the bar to switch between two strict modes (debounced).
- **Low-balance alert** — When the balance drops below ¥20, its amount and adjacent `Low` status turn alert red.
- **Real data only** — The bar only ever shows balances / quotas / plans / bills returned by each provider's official API; local spend estimation is never displayed.
- **Info Bar settings** — Choose what appears, search the list, and set colors with native controls. The list scrolls inside its card so the page stays stable; changes save automatically. Restore the default display or colors, export billing as CSV/JSON, or confirm to clear billing records saved by this plugin.
- **Stays fast over months (v1.9)** — Ledger details auto-archive into summaries and stats are computed incrementally, so bar refreshes never slow down with usage; ledger file permissions are hardened automatically on startup.

## Supported Providers (v1.7)

The bar follows the active session in DSH and detects the provider from its current model list — **zero configuration needed**. Set up your API key in DeepSeek Harness (Settings → Models), and the bar recognizes the active provider automatically. If DSH has not supplied the model yet, the bar waits instead of guessing.

### Balance-based providers
| Provider | Display Name | Credential Key | Balance API |
|---|---|---|---|
| deepseek / deepseek-official | DeepSeek | DEEPSEEK_API_KEY | Official API |
| openai | OpenAI | OPENAI_API_KEY | Estimated (no public API) |
| moonshotai / moonshotai-cn / kimi-coding | Kimi | MOONSHOT_API_KEY (fallback: KIMI_API_KEY) | Official API |
| openrouter | OpenRouter | OPENROUTER_API_KEY | Official API |
| stepfun | StepFun | STEPFUN_API_KEY | Official API |
| xiaomi | Xiaomi MiMo | XIAOMI_API_KEY | Official API |

### Subscription-based providers (quota windows)
| Provider | Display Name | Token Source |
|---|---|---|
| codex / chatgpt / openai-codex | ChatGPT / Codex | `~/.codex/auth.json` (read-only; local JWT decode → plan + expiry) |
| opencode-go / opencode | OpenCode Go | OPENCODE_GO_API_KEY or opencode auth.json |
| zai / zai-coding-cn | Zhipu | ZAI_CODING_CN_API_KEY (fallback: ZAI_API_KEY) |
| xiaomi-token-plan-cn / -sgp / -ams | Xiaomi MiMo | XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY (fallback: XIAOMI_API_KEY) |

### Cloud-billing providers (real monthly bill)
| Provider | Display Name | Credential Key | Billing API |
|---|---|---|---|
| together | Together | TOGETHER_API_KEY | Official Usage API (month spend) |
| fireworks | Fireworks | FIREWORKS_API_KEY | Official Billing API (period spend) |
| amazon-bedrock | AWS Bedrock | AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY | AWS Cost Explorer + Budgets (month spend + budget %) |
| cloudflare-ai-gateway / cloudflare-workers-ai | Cloudflare | CLOUDFLARE_API_KEY + CLOUDFLARE_ACCOUNT_ID (Token needs Billing read) | Billable Usage API (Alpha, real usage) |

**Unsupported providers**: If your provider is not in the list above, the bar shows a **Not supported** hint instead of displaying another provider's data.

## UI language

The plugin follows **Settings → General → Language** in DSH. Choose Chinese to keep the original Chinese UI or English for the labels shown in this README. Switching languages updates the UI without reloading; there is no separate plugin language selector. Chinese documentation remains available.

Host messages use DSH’s saved language preference. A remote browser’s unsaved language choice cannot change host-only text. External provider/system messages keep their original wording. See [localization notes](docs/LOCALIZATION.md) for scope and verification.

## Requirements

- [DeepSeek Harness](https://github.com/deepseek-ai) (`dsh` CLI) installed and used via the web interface (`dsh web`)
- [pnpm](https://pnpm.io/) (used by `dsh plugin`)

## Installation

### Option 1 — One-command script (recommended)

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh                # installs to the "web" profile; use --profile <name> to override
```

### Option 2 — NPM package (recommended for future updates)

```bash
dsh plugin --profile web add dsh-bottom-info-bar
```

To update later:

```bash
dsh plugin --profile web update dsh-bottom-info-bar --latest
```

### Option 3 — dsh plugin command from a local checkout

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin
```

> **Restart `dsh web` after installing or updating.** Plugins are composed when the host process starts; a page refresh alone is not enough.

For detailed installation, troubleshooting, and upgrade instructions, see [docs/INSTALL.md](docs/INSTALL.md).

## Usage

- **Hover** the bar for details: balance, per-token pricing, next price-switch time, and this-conversation spend (today / last 30 days / all time).
- **Click** the bar to toggle between full and compact modes.
- **Version reminder**: once per full DSH startup, the plugin checks NPM; if a newer version exists, it shows a red **Update available** label with the new version in its tooltip. The label only reminds you and never updates code automatically; tell an Agent with local terminal access to help update it.

## Configuration

- **API key**: configure the DeepSeek API key under **Settings → Models** (environment variable `DEEPSEEK_API_KEY`). Without it, the plugin shows a hint and every other feature keeps working.
- **Data scope**: in Beijing time, peak hours are 09:00–12:00 and 14:00–18:00 on weekdays; Saturday and Sunday use off-peak prices all day. Built-in pricing covers DeepSeek V4 models plus OpenAI reference prices; models not in the table are excluded from spend statistics.
- **Mode**: the bar automatically chooses balance, subscription-quota, or billing display from the active session's provider. No manual mode selection is needed.
- **Subscription sources**:
  - **ChatGPT (Codex)**: install the companion plugin [**dsh-chatgpt-subscription**](https://github.com/songoao25) (separate repo) and bind your ChatGPT account once — it maintains the token in `~/.codex/auth.json` (mode `0600`) and registers the ChatGPT models. This bar only **reads** the local token to show the plan and expiry fields it contains; it never refreshes, writes back, or injects credentials. Missing credentials show **Not connected**, with instructions to install **dsh-chatgpt-subscription** and sign in. Missing plan fields remain blank rather than being guessed.
  - **OpenCode Go**: set `OPENCODE_GO_API_KEY` under **Settings → Models**, or log in with the opencode CLI (writes the `opencode-go` entry in `~/.local/share/opencode/auth.json`). Without a key the bar shows a "not configured" hint instead of an error.

#### ChatGPT subscription: known limitations

- This plugin reads only the local token fields supplied by the companion plugin. If the token does not contain a plan or expiry, the bar leaves that detail unset rather than inventing it.
- Available models depend on your subscription plan; model access is provided by the companion plugin **dsh-chatgpt-subscription**.

### Data storage (plugin-owned directory)

All spend data lives in the plugin's own data directory, isolated from other plugins and DSH configuration:

```
~/.dsh/dsh-bottom-info-bar/
├── usage-records.json           # the complete, human-readable bill to open
├── usage-records.journal.jsonl  # recovery journal; do not edit manually
└── usage-records.json.bak       # previous complete snapshot for recovery
```

- **Location**: `~/.dsh/dsh-bottom-info-bar/` (directory mode `0700`, file mode `0600` — readable only by the current user).
- **Override**: set the environment variable `DSH_BOTTOM_INFO_BAR_DATA_DIR` to relocate the whole data directory (e.g. an external drive or a synced folder).
- **View and migrate**: open `usage-records.json` in any text editor to inspect every recorded model response. To back up or move to another computer, copy the entire `~/.dsh/dsh-bottom-info-bar/` directory while DSH is closed.
- **Contents**: one entry per model response (`id / ts / model / provider / sessionId / input / cacheRead / cacheWrite / output / currency / cost / status`). `status` is `completed` or `interrupted`; an interrupted response can still have confirmed billable usage. The billed price is fixed when the response completes, so later price-table updates never rewrite historical totals. Unknown-price models keep their token usage with `pricingStatus: "unpriced"` and are not given an invented cost. No conversation content, prompts, or API keys are ever stored.
- **Durability**: the journal is synchronously confirmed before the UI includes a new bill. If that write fails, the bar says **Spend not saved** and the amount is not added. The readable JSON snapshot is rebuilt in the background; if it is damaged after an interruption, the last good snapshot and every intact journal line are recovered automatically. Do not manually edit the journal or backup file.
- **Retention**: no silent entry cap. Keep the directory in normal user backups if you need long-term retention beyond this machine.
- **Spend scope**: money is aggregated only in the active provider's currency (CNY for DeepSeek, USD for the OpenAI reference prices); records in other currencies are not mixed in. Models absent from the pricing table remain visible in the ledger but are excluded from money totals. The latest DSH `deepseek-flash` (`DeepSeek-V41-Flash` in the current DSH catalog; official release name V4.1 Flash) is priced using DeepSeek's official peak/off-peak rates.
- **Manage records**: open **Settings → Info Bar → Billing data** to export CSV/JSON or clear the plugin’s billing records after confirmation. Settings, sign-in information and pricing data are not affected. Uninstalling the plugin does not delete your data.

## Uninstall

```bash
cd dsh-bottom-info-bar
./uninstall.sh                       # remove the plugin only
# or: dsh plugin --profile web remove dsh-bottom-info-bar
```

ChatGPT subscription (binding & token maintenance) is owned by the separate plugin `dsh-chatgpt-subscription`; uninstalling this info bar does not touch it.

After restarting, the native stats row returns automatically with no residue. Usage records remain under `~/.dsh/dsh-bottom-info-bar/`; use Settings → Info Bar → Billing data to export or clear them when you want to reset the statistics.

## FAQ

| Symptom | Fix |
|---|---|
| Bar does not appear after a page refresh | **Restart** `dsh web` (the host process loads plugins) |
| Balance shows **Not configured: DEEPSEEK_API_KEY** | Add the key under Settings → Models |
| Balance shows **Refresh failed** while a balance remains visible | Transient network/key issue; retries automatically after 60 s. The last successful data is kept so the bar never goes blank. **Hover over the warning** for a detailed explanation and retry timing. |
| OpenCode Go shows **Refresh failed** with a missing-credentials tooltip | Add `OPENCODE_GO_API_KEY` under Settings → Models, or configure OpenCode Go in the opencode CLI |
| How do I bind my ChatGPT subscription? | Install the companion plugin **dsh-chatgpt-subscription** and authorize on the official page — it maintains the token this bar reads for quota display |
| ChatGPT plan or expiry is empty | Sign in again or rebind the companion plugin. If the token does not contain those fields, the bar keeps only the provider and model instead of guessing. |
| Why does compact mode show a different window? | Compact mode prioritizes the shortest-duration window (5-hour > weekly > monthly) because it refreshes fastest. If the 5-hour window is unavailable, it falls back to weekly or monthly. **Quota and countdown always match** — both come from the same window. |
| Why is the model's reasoning process not shown? | DSH does not render the model's internal reasoning in the UI — a DSH interface-layer limitation, not the plugin's |
| Want the original stats row back | Uninstall the plugin and restart |

## Development

- **Source**: `plugin/src/host.js` (host) + `plugin/src/client-bundle.js` (client)
- **Build**: `cd plugin && npm run build` (generates `lib/`)
- **Test**: `node tests/run-all.mjs`

## License

[MIT](LICENSE) © 2026 songoao25
