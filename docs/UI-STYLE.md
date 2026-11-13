# Plugin settings page style

Both this plugin and its sibling [dsh-chatgpt-sub](https://github.com/songoao25/dsh-chatgpt-sub)
render their settings page inside the host's plugin detail page. This note records the shared
grammar so the two pages cannot drift apart again, and so a change here is a deliberate change
of the contract rather than a local tweak.

The numbers below were read from the installed host bundle, not from either plugin:
`@deepseek-ai/dsh-client-ui-plugin-manager` ships its stylesheet as CSS Modules, so the class
prefix changes with the host version (it was `X_2TxG` in 0.1.7, `ZVcBiW` in 0.2.x, `w6M7KW`
in 0.2.2) — match the declarations, never the class names.

## 2026-11-12: settings-card migration (DSH 0.2.2)

The host's own settings forms (`@deepseek-ai/dsh-client-ui` settings-form, module `tUAPGa`
in 0.2.2-rc.1) have moved to **card surfaces with no separator lines**:

| Element | Host rule | Value |
| --- | --- | --- |
| Settings card | `rowCard` | `.5px solid var(--dsw-alias-settings-card-stroke)` (= border-l4), `background: var(--dsw-alias-settings-card-fill)` (= bg-layer-2), `border-radius: var(--dsw-radius-xl)` = 20px, padding `12px 14px`, column gap 12px |
| Card list | `rows` | column, `gap: 8px` — **no separator lines** |
| Section | `section` | column, `gap: 12px` |
| Input | `input` | height 32px, radius `var(--dsw-radius-md)` = 12px, `.5px` border-l4, `background: bg-layer-1`, padding `0 10px`, font 14px |
| Hover fill | — | `var(--dsw-alias-interactive-bg-hover)` (≈6% ink) |

The plugin follows this grammar: every top-level block (`.bib-set-card--panel`) is a settings
card, rows keep the two-column grammar (text left, control right) with 8px/10px padding,
8px radius and an interactive hover fill, and **no row draws a separator line** — layering
comes from the card surface and whitespace only. The old hairline token (`--bib-rule`) and
the host detail-page row metrics (`.5px border-l2` rows) are retired on this page.

Deliberate deviation, recorded: the host *detail page* rows (plugin manager `w6M7KW_row`)
still use `.5px` hairlines. The settings page intentionally follows the *settings-form*
grammar instead, per user decision 2026-11-12 ("删掉廉价的分隔线，改用留白划分").

## Where the page lands

```
detailSections      { display: flex; flex-direction: column; gap: 32px; margin-top: 32px }
  detailSection     { display: flex; flex-direction: column; gap: 12px }   ← the plugin's page
    plugins.item view=page  ← renderSlot: our root element
```

## Blocks

| Element | Host rule | Value |
| --- | --- | --- |
| Between blocks | `detailSections` | 32px, **no rule line** |
| Inside a block | `detailSection` | 12px |
| Block title | `sectionTitle` | 14px / 500 / 20px, label-primary |
| Block description | `cardDesc` / `pageIntro` | 13px / 18px, label-secondary |
| No in-page title | — | the host already renders the plugin name (20/500/28) and description (14/22) |

## Rows

> 2026-11-12: the settings page no longer copies these detail-page rows — see
> "2026-11-12: settings-card migration" above. The table below stays as the
> detail-page baseline it documents.

| Element | Host rule | Value |
| --- | --- | --- |
| Row box | `row` | padding 12px 2px, `border-bottom: .5px solid var(--dsw-alias-border-l2)` |
| Last row | `row:last-child` | no bottom rule (there is **no** first-child override) |
| Row line | `rowLine` | `display: flex; align-items: center; gap: 16px; min-width: 0` |
| Text column | `rowMain` | `flex: 1` (this is what pushes the control to the right), column, gap 2px |
| Row title | `rowId` | 13.5px / 500 / 20px, label-primary |
| Row description | `rowModule` metrics | 11.5px / 16px, label-tertiary |

Deviation, deliberately: `rowModule` is monospace because the host uses it for identifiers
(module paths). Prose descriptions keep the same size and colour in a proportional face.

## Controls

Use the host primitives and give them layout classes only — never the plugin's own appearance
classes (`.button`/`.sm` and the plugin rules have the same specificity, and the plugin
stylesheet is injected later, so plugin geometry would win and stop following the host skin):
`Button` (`size="sm"`), `Switch`, `SegmentedControl`, `Input`, `Menu`, `Tag`, `StateDot`,
`RiskConfirmation`, `Toast`. A host without them falls back to the plugin's own controls; the
fallback `<select>` copies the host `.input` metrics (34px / radius md / .5px border-l4 /
bg-layer-3 / 13px).

A `SegmentedControl` is a tablist: every tab points its `aria-controls` at
`<id>-<value>-panel`, so render those panels. The panel is the row description itself (the
selected option stays visible, the others are `hidden`), which keeps the description in the
row's text column instead of adding an extra line.

## Other host pieces

| Element | Host rule | Value |
| --- | --- | --- |
| Expand/collapse toggle | `detailsToggle` | 13px, label-secondary, inline-flex, gap 4px; chevron `transition: transform .16s` |
| Error row | `failure` + `reason` | inline flex, gap 10px, state-error colour; description 12px / 18px |
| Danger button | `danger` | error colour, 30% error border, 8% error hover fill |

## Enforcement

Each plugin locks its half of the contract in its own test suite
(`tests/test-field-config-client.cjs` here, `tests/test-alpha4-client-contract.mjs` in the
sibling). Change the host, change both.

## Native statistics integration (measured 2026-10-17)

Installed macOS DSH `0.2.1-rc.1` keeps the settings geometry above: section gap
32px, inner gap 12px, row gap 16px, row title 13.5px/500/20px and description
11.5px/16px. These values were re-read from the installed plugin-manager bundle.

The composer now registers `activity` and `usage` in `conversation.composer.dock`
instead of the legacy `stats` entry. The plugin observes the public registry and
its change subscription. It leaves both native entries in their original outlet,
so their injected state, dialogs and native display preferences remain host-owned.
Only the duplicate legacy statistics row is suppressed. No native button classes,
colors, dialog implementations or hashed class names are overridden.

Visual order (user decision 2026-10-17): the native line sits **above** the plugin
account line. The host orders entries by registration priority, so the plugin's
full-width row is lifted to the second line with flex `order: 1` while the native
entries keep order 0. Do not "fix" this by re-registering: the priority value is
also what shadows the legacy `stats` entry on old hosts.

The plugin row is the **Full/Compact** switch again on these hosts. Clicking any
plugin field (or pressing Enter/Space on the focused row) toggles `data-density`
and persists through `setInfoDensity`, same as the old host. Full shows the native
line; Compact collapses it. Because the native buttons belong to the host and
cannot be wrapped by the plugin, the collapse is expressed on each
`[data-composer-stat]`: `max-height` 22px + font delta → 0, opacity 1 → 0 over the
same 160ms height / 120ms fade the legacy row uses, with `visibility` flipping to
hidden only after the height animation. The native buttons keep their own click
behavior and dialogs — the plugin root is a sibling, so their clicks never reach
the density handler.

The settings page offers one switch per native button (`nativeActivity` /
`nativeUsage`); the switch writes `data-bi-native-hidden` on `documentElement`
and CSS hides only the matching `[data-composer-stat]`. This is deliberately not a
React condition: the native entries are host-owned, and the marker must keep
working even when every plugin field is hidden and the bar roots to `null`. The
obsolete legacy statistics-row switches/colors stay hidden from search and enabled
counts on these hosts; saved values remain intact for old hosts. Hosts without
either native entry retain the old row, controls and density toggle.
Disabling/unloading the plugin removes the marker and leaves native entries alone.
