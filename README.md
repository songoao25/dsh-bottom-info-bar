# Bottom Info Bar

**English** | [**中文**](README.zh-CN.md)

[![License: MIT](https://img.shields.io/github/license/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar/releases)
[![Last commit](https://img.shields.io/github/last-commit/songoao25/dsh-bottom-info-bar)](https://github.com/songoao25/dsh-bottom-info-bar)
[![CI](https://img.shields.io/github/actions/workflow/status/songoao25/dsh-bottom-info-bar/ci.yml)](https://github.com/songoao25/dsh-bottom-info-bar/actions)

A drop-in replacement for the stats row under the DeepSeek Harness composer.

It keeps everything that row already showed — turns and steps, LLM time, tool calls, cache hit rate, input/output tokens — and adds what you actually want to see while you work: **your real balance** (or subscription quota, or this month's bill), the **provider and exact model**, **peak/off-peak pricing** with a countdown to the next switch, and **what this conversation has cost so far**.

Install once, restart once, then it activates on every launch. The billing mode is detected automatically, and **estimated data is never displayed**.

![Bottom Info Bar preview: ChatGPT subscription, DeepSeek balance, and OpenCode Go subscription — each in full and compact view](assets/bottom-info-bar-preview.jpeg)

<sub>The screenshot uses the Chinese UI; with DSH's language set to English the labels switch automatically. From top to bottom: **ChatGPT subscription**, **DeepSeek balance**, **OpenCode Go subscription** — each shown in **full** view followed by **compact** view.</sub>

## At a glance

- **Three billing modes, auto-detected** — balance, subscription quota, or cloud bill. They replace each other and never overlap.
- **Real data only** — every balance, quota, plan and bill comes from the provider's official API. Nothing is estimated locally.
- **Exactly what DSH shows** — the provider and model match DSH's model switcher, and newly published models are picked up automatically.
- **Peak / off-peak pricing** — both prices plus a countdown to the next switch (weekends count as off-peak all day).
- **Honest spend tracking** — this conversation (including subagents), today, last 30 days, and all time — persisted to disk, nothing lost on restart.
- **Native by design** — it replaces the native row instead of duplicating it; click to switch full/compact, and choose which fields and colors appear.

## Quick start

```bash
dsh plugin --profile web add dsh-bottom-info-bar
```

Then **restart `dsh web`** — plugins are composed when the host process starts, so a page refresh is not enough.

Set your provider's API key under **Settings → Models** in DSH. Nothing else to configure.

<details>
<summary>Other ways to install (and which one to pick)</summary>

**Recommended: the npm command above.** It is the only install method that lets the built-in update reminder hand you a working update command — see [Updating](#updating).

**From a local checkout** (for development, or to run unreleased code):

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
dsh plugin --profile web add /path/to/dsh-bottom-info-bar/plugin
```

This creates a `link:` install. It tracks your checkout rather than npm, so updates are `git pull` instead of a package install — see [Updating](#updating).

**One-command script** — clone and install in one step:

```bash
git clone https://github.com/songoao25/dsh-bottom-info-bar.git
cd dsh-bottom-info-bar
./install.sh                # installs into the "web" profile; --profile <name> to override
```

Like the local-checkout option, this produces a `link:` install.

Detailed instructions and troubleshooting: [docs/INSTALL.md](docs/INSTALL.md).
</details>

## Billing modes

The bar follows the active session in DSH and picks the display from the provider — no manual mode selection.

### Balance mode (DeepSeek, Kimi, OpenRouter, StepFun, Xiaomi MiMo, OpenAI reference)

Shows the **real balance** from the provider's `/user/balance` (or equivalent) API. It refetches the moment the bar opens, refreshes, or the provider changes, then polls every 60 seconds. The last known snapshot is kept on failure so the row never goes blank.

When the balance drops below ¥20, the amount and a `Low` label turn red.

### Subscription mode (ChatGPT / Codex, OpenCode Go, Zhipu, Xiaomi MiMo Token Plan)

Shows **quota remaining per window** (5-hour / weekly / monthly, where remaining = 100 − used) and a **countdown to the next reset**. Quota and countdown always come from the same window, so they can never disagree.

- **ChatGPT / Codex** — decoded **locally** from `~/.codex/auth.json`, showing the real plan tier and expiry date (for example `ChatGPT · Plus | Expires 2026-09-16`). Zero network calls: the values come straight from OpenAI's own login token, never estimated. Not signed in → **Refresh failed** with a reauthorization hint. Binding, token refresh and the `openai-codex` model route belong to the companion plugin [dsh-chatgpt-subscription](https://github.com/songoao25) — this bar only reads the token, and never writes it back.
- **OpenCode Go** — reads quota from `opencode.ai/zen/go/v1/usage` using `OPENCODE_GO_API_KEY` (Settings → Models) or the opencode CLI login at `~/.local/share/opencode/auth.json`. Missing key → a "not configured" hint, not an error.
- **Zhipu** — GLM Coding Plan quota via `ZAI_CODING_CN_API_KEY` (fallback `ZAI_API_KEY`): plan tier plus the 5-hour window.
- **Xiaomi MiMo Token Plan** — monthly Credits quota via `XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY` per region (fallback `XIAOMI_API_KEY`): plan name plus the monthly window.

In compact mode the bar prefers the shortest window (5-hour > weekly > monthly), because it refreshes fastest; if the 5-hour window is unavailable it falls back to weekly, then monthly.

### Billing mode (Together, Fireworks, AWS Bedrock, Cloudflare)

Shows **this month's real spend** from the provider's official billing API, for example `Together | This month $12.34` or `AWS Bedrock | This month $45.60 · Budget 46%`. Cloudflare also shows daily free-quota remaining and a UTC-midnight reset countdown — but **only when the API actually reports a free allowance**; otherwise it shows real usage alone rather than inventing a quota. Missing keys → a "not configured" hint.

## Spend tracking

Every `llm/stream` request is recorded (usage × unit price) and aggregated four ways: **this conversation** (including subagents), **today**, **last 30 days**, and **all time**.

Subagents bill to the same provider account, so their records are folded into the current session. The billed price is fixed the moment a response completes, so later price-table updates never rewrite history. Models with no known price keep their token counts but are excluded from money totals, and are never given an invented cost.

Nothing is lost on restart: the journal is synchronously confirmed before the UI counts a new charge, and if that write fails the bar says **Spend not saved** instead of quietly dropping the amount. Ledger details auto-archive into summaries and stats are computed incrementally, so refreshing stays fast even after months of use.

## Updating

Once per full DSH startup the plugin checks npm for a newer version. If one exists, a red **Update available** label appears.

**Click the label** and the update command is copied to your clipboard — paste it into a terminal, run it, then restart `dsh web`. The label briefly confirms with "Update command copied".

Hovering the label explains both paths: ask an agent that has terminal access, or click to copy the command yourself.

The copied command matches how the plugin was installed:

| Installed via | Command you get |
|---|---|
| npm (`dsh plugin add dsh-bottom-info-bar`) | `dsh plugin --profile <profile> add dsh-bottom-info-bar@latest` |
| `link:` — local checkout or the one-command script | `git -C <your checkout> pull --ff-only` |

It is never applied automatically. The plugin only tells you a newer version exists; nothing on your machine changes until you run the command yourself.

## Supported providers

The bar detects the provider from DSH's current model list — **no configuration needed**. Set the key up in DSH (Settings → Models) and the bar recognises it. If DSH has not supplied a model yet, the bar waits rather than guessing.

### Balance-based

| Provider | Display name | Credential | Source |
|---|---|---|---|
| deepseek / deepseek-official | DeepSeek | `DEEPSEEK_API_KEY` | Official API |
| openai | OpenAI | `OPENAI_API_KEY` | Reference estimate (no public API) |
| moonshotai / moonshotai-cn / kimi-coding | Kimi | `MOONSHOT_API_KEY` (fallback `KIMI_API_KEY`) | Official API |
| openrouter | OpenRouter | `OPENROUTER_API_KEY` | Official API |
| stepfun | StepFun | `STEPFUN_API_KEY` | Official API |
| xiaomi | Xiaomi MiMo | `XIAOMI_API_KEY` | Official API |

### Subscription-based (quota windows)

| Provider | Display name | Token source |
|---|---|---|
| codex / chatgpt / openai-codex | ChatGPT / Codex | `~/.codex/auth.json` (read-only; decoded locally) |
| opencode-go / opencode | OpenCode Go | `OPENCODE_GO_API_KEY` or the opencode auth file |
| zai / zai-coding-cn | Zhipu | `ZAI_CODING_CN_API_KEY` (fallback `ZAI_API_KEY`) |
| xiaomi-token-plan-cn / -sgp / -ams | Xiaomi MiMo | `XIAOMI_TOKEN_PLAN_CN/SGP/AMS_API_KEY` (fallback `XIAOMI_API_KEY`) |

### Cloud-billing (real monthly bill)

| Provider | Display name | Credential | Source |
|---|---|---|---|
| together | Together | `TOGETHER_API_KEY` | Official Usage API (month spend) |
| fireworks | Fireworks | `FIREWORKS_API_KEY` | Official Billing API (period spend) |
| amazon-bedrock | AWS Bedrock | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` | Cost Explorer + Budgets (spend + budget %) |
| cloudflare-ai-gateway / cloudflare-workers-ai | Cloudflare | `CLOUDFLARE_API_KEY` + `CLOUDFLARE_ACCOUNT_ID` (token needs Billing read) | Billable Usage API (real usage) |

**Anything else** shows a **Not supported** hint instead of borrowing another provider's numbers.

## Interface language

The plugin follows **Settings → General → Language** in DSH. Switching languages updates the bar without a reload, and there is no separate plugin language selector. Host-side messages use DSH's saved preference; a remote browser's unsaved choice cannot change host-only text, and external provider messages keep their original wording. See [localization notes](docs/LOCALIZATION.md).

## Data storage

Everything the plugin records lives in its own directory, isolated from other plugins and from DSH configuration:

```
~/.dsh/dsh-bottom-info-bar/
├── usage-records.json           # the complete, human-readable ledger
├── usage-records.journal.jsonl  # recovery journal — do not edit by hand
└── usage-records.json.bak       # previous complete snapshot, for recovery
```

- **Permissions** — directory `0700`, files `0600`, hardened automatically at startup: readable only by your user.
- **Relocate** — set `DSH_BOTTOM_INFO_BAR_DATA_DIR` to move the whole directory (external drive, synced folder, …).
- **Inspect or migrate** — open `usage-records.json` in any editor. To move machines, copy the directory while DSH is closed.
- **Contents** — one entry per model response (`id / ts / model / provider / sessionId / input / cacheRead / cacheWrite / output / currency / cost / status`), where `status` is `completed` or `interrupted`. **No conversation content, prompts, or API keys are ever stored.**
- **Retention** — there is no silent entry cap; keep the directory in your normal backups if you need history beyond this machine.
- **Manage** — **Settings → Info Bar → Billing data** can export CSV/JSON or clear the plugin's records after confirmation. Settings, sign-in information and pricing data are untouched, and **uninstalling does not delete your data**.

> Pricing notes: money is aggregated only in the active provider's currency (CNY for DeepSeek, USD for the OpenAI reference prices) — currencies are never mixed. DeepSeek peak hours are weekdays 09:00–12:00 and 14:00–18:00 Beijing time; weekends are off-peak all day.
>
> On model names: DSH's catalogue calls the newest Flash model `DeepSeek-V41-Flash` (model id `deepseek-flash`), while DeepSeek's own release name is **V4.1 Flash** — the missing dot is DSH's spelling, not a typo, and the bar deliberately shows exactly what DSH shows. `DeepSeek-V4-Flash` is a *different*, older model id.

## Uninstall

```bash
cd dsh-bottom-info-bar
./uninstall.sh
# or: dsh plugin --profile web remove dsh-bottom-info-bar
```

After a restart the native stats row returns with no residue. Your usage records stay in `~/.dsh/dsh-bottom-info-bar/` — export or clear them from Settings → Info Bar → Billing data if you want a clean slate.

ChatGPT binding and token maintenance belong to the separate plugin `dsh-chatgpt-subscription`; removing this info bar does not touch it.

## FAQ

| Symptom | What to do |
|---|---|
| Bar does not appear after refreshing the page | **Restart** `dsh web` — the host composes plugins at startup |
| Balance says **Not configured: DEEPSEEK_API_KEY** | Add the key under Settings → Models |
| Balance shows **Refresh failed** but a figure is still visible | Transient network or key issue; it retries automatically after 60 s and keeps the last known value. **Hover the warning** for details. |
| OpenCode Go shows **Refresh failed** with a missing-credentials tooltip | Add `OPENCODE_GO_API_KEY` under Settings → Models, or log in with the opencode CLI |
| ChatGPT shows **Not connected** | Install the companion plugin `dsh-chatgpt-subscription` and sign in |
| ChatGPT plan or expiry is blank | Sign in again or rebind. If the token genuinely lacks those fields the bar leaves them empty rather than guessing. |
| How do I update? | Click the red **Update available** label to copy the command, then restart `dsh web`. See [Updating](#updating). |
| Compact mode shows a different quota window than full mode | Intentional: compact prefers the shortest window (5-hour > weekly > monthly). Quota and countdown still come from the same window. |
| Why is the model's reasoning not shown? | DSH does not render internal reasoning — a DSH interface limitation, not this plugin |
| I want the original stats row back | Uninstall and restart |

## Development

- **Source** — `plugin/src/host.js` (host) and `plugin/src/client-bundle.js` (client)
- **Build** — `cd plugin && npm run build` (generates `lib/`)
- **Test** — `node tests/run-all.mjs` (builds first, then runs every suite)
- **Contributing** — [CONTRIBUTING.md](CONTRIBUTING.md); day-to-day workflow and release process: [docs/WORKFLOW.md](docs/WORKFLOW.md)

## License

[MIT](LICENSE) © 2026 songoao25
