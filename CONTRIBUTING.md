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

Release Please manages versions and release notes. Do not manually change package or manifest version fields outside the established release process. Owner code PRs may auto-merge after required checks; release PRs are excluded and need maintainer confirmation. Tags trigger npm publication. Verify the public registry, `latest` tag, downloadable archive and integrity after publication; a successful workflow alone does not establish availability.

README.md is the English entry point; README.zh-CN.md mirrors it in Chinese. Keep installation claims aligned with published packages and DSH's actual supported installation paths. Public repository files are for users and contributors; exclude private instructions, session records, account data and internal audits.

## Conduct and license

Follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Contributions are licensed under [MIT](LICENSE).
