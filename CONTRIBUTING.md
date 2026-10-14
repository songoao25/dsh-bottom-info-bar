# Contributing

Report reproducible bugs in [Issues](https://github.com/songoao25/dsh-bottom-info-bar/issues). Include DSH and plugin versions, operating system, installation method, steps, expected behavior and actual behavior. Discuss substantial features before implementing them.

For security vulnerabilities, follow [SECURITY.md](SECURITY.md) rather than opening a public issue. Never attach credentials, sign-in files, conversation content or personal account data.

## Structure

- `src/host.js`: provider data, usage accounting and RPC.
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
