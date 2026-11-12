# Contributing

Report reproducible bugs in [Issues](https://github.com/songoao25/dsh-bottom-info-bar/issues). Include DSH and plugin versions, operating system, installation method, steps, expected behavior and actual behavior. Discuss substantial features before implementing them.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) rather than opening a public issue. Never attach credentials, sign-in files, conversation content or personal account data.

## Structure

- `src/host.js`: provider data, usage accounting and RPC.
- `src/accounting.js`: pricing table, peak/off-peak calendar, currency and account mapping shared by the host and the ledger worker.
- `src/ledger-client.js` / `src/ledger-worker.js`: the async bridge that keeps the synchronous SQLite ledger off the host main thread (issue #260).
- `src/client-bundle.js`: the info bar and plugin configuration page.
- `src/locales.js` and `src/host-locale.js`: translated copy and host presentation.
- `scripts/build.mjs`: generates the host and client bundles in `lib/`.
- `locale/`: plugin display-name and description dictionaries.
- `tests/`: behavior and packaging checks.
- `docs/INSTALL.md`: installation, updates and troubleshooting.
- `docs/UI-STYLE.md`: the settings-page style contract shared with [dsh-chatgpt-sub](https://github.com/songoao25/dsh-chatgpt-sub) (values read from the host's plugin-detail page).

The repository root is the installable package. Generated `lib/` files are committed so a repository-address installation requires no build approval. Edit source files and rebuild; do not edit generated files directly.

## Checks

```bash
npm run build
node tests/run-all.mjs
git diff --check
npm pack --dry-run
```

Use existing dependencies. Keep tests isolated from real accounts, credentials and user files. Declare host services through injection before reading them; unavailable services must not make the configuration page disappear. Keep `prepublishOnly` as the publishing hook; do not add installation lifecycle scripts such as `prepare`, `prepack` or `postinstall`.

Provider credentials belong in DSH settings or the existing local sign-in stores. Keep the info bar read-only with respect to subscription sign-in files. Stored usage records contain token counts and costs, not conversation content. Do not alter provider identifiers or historical costs while translating presentation text.

## Pull requests and releases

Use a focused branch and [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/). Describe the user-visible change, checks performed and remaining verification gaps. External contributions need maintainer review.

Release Please manages versions and release notes. Do not manually change package or manifest version fields outside the established release process. Owner PRs — release PRs included — auto-merge once the required checks pass, so the chain runs without a human step (2026-10-14: check, approval, merge and publish are all automatic, and branch protection requires no approving review). What used to be the maintainer's confirmation is now the machine guards in `tests/test-source-guards.mjs`: a normal PR cannot touch version metadata, and a release PR may only touch the four version files and must keep `package.json` and the manifest in agreement. Tags trigger npm publication. Verify the public registry, `latest` tag, downloadable archive and integrity after publication; a successful workflow alone does not establish availability.

README.md is the English entry point; README.zh-CN.md mirrors it in Chinese. Keep installation claims aligned with published packages and DSH's actual supported installation paths. Public repository files are for users and contributors; exclude private instructions, session records, account data and internal audits.

## Quota data source adapters

Every provider whose quota this plugin displays is described by one entry in
`CREDENTIAL_CATALOG` (`src/constants.js`). That table is the single source of truth: the host
derives the writable credential whitelist from it, the plugin settings page renders the
"Quota credentials" rows from it, and the tests lock it against drift. Adding or changing a
provider means changing that table plus a fetch/parse function — never adding another
credential name in a second place.

Pick the best channel in this order, and stop at the first one the provider actually documents:

1. **API-key data-plane endpoint** (read-only, same key used for inference or a subscription
   key). Cheapest for users and the most stable. Examples: Kimi For Coding, MiniMax.
2. **Official OpenAPI with AccessKey/secret** (signed, read-only). Requires the smallest
   documented RAM/IAM policy. Example: Alibaba Token Plan `GetSubscriptionStats`.
3. **Official CLI protocol** (for example exchanging an AccessKey for a short-lived console
   token, then calling the console gateway read-only API). User needs an extra permission;
   document it explicitly.
4. **Console session cookies** — do not ship this. It needs a pasted browser session, expires
   quickly, and turns a read-only display into a credential-retention problem. A provider
   without channels 1–3 stays in the explicit "no account data" column of
`docs/PROVIDER-COMPATIBILITY.md`.

Rules that are not negotiable:

- Read-only only. No provider quotas, seats, keys or balances are ever changed by this plugin.
- Credentials live in DSH's credential store (`$DSH_HOME/.credentials.yaml`, mode 0600) or in
  same-named environment variables. Plugin `settings.json` never stores secrets, and the settings
  page never echoes a stored value back.
- A missing credential, missing permission, missing subscription and an unrecognized payload are
  four different states with their own copy. Never render a fake `0%` or `0`.
- Failed refreshes keep the previous snapshot and show a degraded marker; they never clear data.
- Every new parser ships with unit tests, a sample payload, and an explicit `official` +
  `verification` value in the catalog (`live`, `third-party`, `unverified`). Docs must state the
  same verification level — do not upgrade a claim the tests cannot support.
- Region variants (China/international) get separate subscription sources so snapshots cannot
  cross-contaminate, and separate credential refs when the provider issues separate keys.

Checklist for a new adapter:

1. Add one `CREDENTIAL_CATALOG` entry (id, labelKey, mode, providers, credentials with `inline`
   flags, `official`, `verification`).
2. Add the parse function and the fetch function in `src/host.js`; register the source in
   `SUBSCRIPTION_SOURCES` / `BALANCE` / `BILLING` as appropriate.
3. Map the provider id(s) in `PROVIDER_IDENTITY` and `SUBSCRIPTION_PROVIDERS` if it is a
   subscription source.
4. Add the brand label to the client subscription/billing service-name switch.
5. Add dictionary keys in all bundled languages (`src/locales.js`).
6. Add a focused test file, register it in `tests/run-all.mjs`, and run the full suite plus
   `npm run build`.
7. Update `docs/PROVIDER-COMPATIBILITY.md` (move the provider out of the degraded row only when
   a real read-only channel exists) and, if user setup is needed, `docs/INSTALL.md`.

Update the catalog's `verification` field and the docs together whenever a real account has been
used end to end. Until then the docs say it has not.

## Repository framework status

This repository follows the personal GitHub project standard: one workflow per responsibility
(`ci`, `codeql`, `release-please`, `publish-npm`, `verify-npm-release`, `auto-merge-own`),
a seven-section README with a Chinese mirror, SemVer with tags created only by the release bot,
npm publishing through Trusted Publishing (OIDC) with no long-lived token, and a fully automatic
release chain — release PRs auto-merge, with the machine guards in `tests/test-source-guards.mjs`
standing in for the human confirmation the standard required before 2026-10-14.

Release secrets (GitHub shows no expiry through its API — read the date on the token page and
record the renewal here):

| Name | Purpose | Referenced by | Expires | Last renewed |
| --- | --- | --- | --- | --- |
| `RELEASE_PLEASE_TOKEN` | Let the release bot open release PRs, and let the tag it creates trigger publishing | `release-please.yml`, `auto-merge-own.yml` | see the GitHub token page | 2026-09-11 |

Known deviations (checked 2026-10-13):

- No `.github/ISSUE_TEMPLATE/` yet; issues stay free-form until a bug-report form is added.
- The read-back sentinel no longer repairs a stale `latest` dist-tag, because that needs
  credentials. If npm drops `latest` again (v1.20.10 did), the sentinel fails loudly and a
  maintainer runs `npm dist-tag add dsh-bottom-info-bar@<version> latest` by hand.
- Published versions once skipped numbers (`1.10.12` → `1.10.18`). That history is not rewritten;
  from here on versions increment one by one and are changed only by the release bot.

Any deviation from the standard belongs in this section with a reason and a date.

## Conduct and license

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributions are licensed under [MIT](LICENSE).
