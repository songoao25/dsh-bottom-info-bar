# Plugin settings page style

Both this plugin and its sibling [dsh-chatgpt-sub](https://github.com/songoao25/dsh-chatgpt-sub)
render their settings page inside the host's plugin detail page. This note records the shared
grammar so the two pages cannot drift apart again, and so a change here is a deliberate change
of the contract rather than a local tweak.

The numbers below were read from the installed host bundle, not from either plugin:
`@deepseek-ai/dsh-client-ui-plugin-manager` ships its stylesheet as CSS Modules, so the class
prefix changes with the host version (it was `X_2TxG` in 0.1.7, `ZVcBiW` in 0.2.x) — match the
declarations, never the class names.

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
Only the duplicate legacy statistics row is suppressed. The plugin account row
occupies a full line; the native entries share a second line. No native button
classes, colors, dialog implementations or hashed class names are overridden.

On these hosts the plugin row is informational, not a density-toggle button.
Its existing context meter remains independently clickable. The settings page
replaces obsolete native per-field switches/colors with an ownership explanation;
search and enabled counts exclude those inactive fields. Saved legacy values
remain intact. Hosts without either native entry retain the old row, controls
and density toggle. Disabling/unloading the plugin leaves native entries alone.
