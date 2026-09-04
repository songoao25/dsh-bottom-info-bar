# Localization

The original Chinese copy and English translations live together in
`plugin/src/locales.js`. The plugin follows DSH's Settings → General language
preference; it has no separate selector or persisted language state.

## Framework integration

The client loads `@deepseek-ai/dsh-client-locale`, injects `locale`, registers
`ctx.locale.register('dsh-bottom-info-bar', { zh, en })` as an owned effect, and
uses `ctx.locale.bind('dsh-bottom-info-bar')`. Both the composer and settings slots
declare this namespace. DSH's locale revision refreshes those slots without
re-registering them. The navigation label is a thunk; feedback translates during
rendering so an existing error or reset notice also follows a language switch.

The field registry keeps its original IDs, modes, grouping and behavior. Its
display labels/notes and group labels reference dictionary keys. Turn/step counts
select singular or plural keys; Chinese retains its original count wording.
Quota-window labels use existing machine-readable window IDs.

The APIs were checked against DSH's
[`dsh-v0.1.2-alpha.4` locale implementation](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.1.2-alpha.4/packages/client/locale)
and current upstream, including actual register/bind/subscribe/setLocale checks.

## Host presentation and exceptions

Host text uses the supported `ctx.settings.get('locale').preference`; absent or
unsupported values keep the original Chinese default. Existing snapshots carry
display strings rather than translation metadata. A narrow presentation adapter
recognizes dictionary-owned strings/templates at serialization and rendering so
cached labels/messages can switch language without another provider request.
It changes no payload shapes, provider IDs, persistence keys, amounts, quota
calculations, refresh schedules or network requests.

DSH does not persist non-loopback browsers' language choices. Host-only consumers
therefore follow the saved host preference; plugin UI translates known display
text using its own DSH binding. Provider-supplied plan/model names and error
details, operating-system errors, technical HTTP diagnostics, brand names and
units retain their source wording. These are external/protocol data rather than
plugin-authored UI copy.

Chinese provider-response recognition regexes remain intact. Bilingual recognition
of the plugin's missing-credential prefix and billing-permission hint preserves
the existing presentation branches across either host language. The no-key
subscription branch remains the same reauthorization hint in both languages.

## Verification

`tests/test-localization.mjs` checks equal key sets and interpolation parameters,
both locales, settings descriptions and punctuation, failed-save rollback and
feedback switching, all three modes in full/compact density, singular/plural
counts, host preference normalization, and unchanged machine fields. The
unmodified static host checker is also exercised with a regex quote followed by
an undefined executable call to ensure that executable code cannot be hidden.

The coverage audit separates dictionary-owned copy from CSS, technical names,
console-only diagnostics, comments/docs and provider parsing expressions. Chinese
rendered settings and info-bar copy was also compared with upstream Chinese
fixtures. Intentionally Chinese documentation and historical changelogs remain
unchanged.

From `plugin/`, run `npm run build` and `npm test`. The latter includes all 22
original test/check groups plus localization regressions. The build copies the
shared locale source and embeds it in the client alongside shared constants.
`plugin/lib/` remains generated and ignored. These automated checks do not
constitute manual DSH runtime testing.
