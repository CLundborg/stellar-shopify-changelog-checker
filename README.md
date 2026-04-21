# @stellar/shopify-changelog-checker

A personal CLI tool that scans your local Stellar Shopify repos and tells you which entries in the [Shopify developer changelog](https://shopify.dev/changelog) directly impact your code.

- **No project changes.** Nothing gets committed to the theme or app repos — each dev installs the tool for themselves.
- **Workspace-aware.** One run scans all 7 Stellar repos (theme + 6 apps) and writes a combined report.
- **Hybrid analysis.** Rule-based signal matching, optionally re-ranked by Claude when `ANTHROPIC_API_KEY` is set.

## Quick start for the team

Clone the Stellar repos so they all sit as siblings under one folder, e.g. `~/Projects/`:

```
~/Projects/
  stellar-shopify/
  stellar-app-wishlist/
  stellar-shopify-app-gift-purchase-discount/
  stellar-shopify-app-print-invoice/
  stellar-shopify-app-base-ui-extensions/
  stellar-shopify-app-bloomreach-enhancements/
  stellar-shopify-app-salesforce-notification/
```

### Option A — zero-install (recommended)

Requires Node.js ≥ 20. From the folder containing the repos:

```bash
cd ~/Projects
npx -y github:CLundborg/stellar-shopify-changelog-checker workspace --preset stellar
```

That's it. Reports land in `~/Projects/changelog-reports/` and a combined index at `~/Projects/CHANGELOG_IMPACT.md`. Re-run any time to refresh.

> `npx` caches the build after the first run, so subsequent invocations are fast. To upgrade, add `@latest` or pin a tag like `#v0.1.0`.

### Option B — global install

```bash
npm install -g github:CLundborg/stellar-shopify-changelog-checker
cd ~/Projects
shopify-changelog-check workspace --preset stellar
```

### Option C — dedicated tool folder

If you prefer not to touch the global npm prefix:

```bash
mkdir -p ~/tools/shopify-changelog && cd ~/tools/shopify-changelog
npm init -y
npm install github:CLundborg/stellar-shopify-changelog-checker
npx shopify-changelog-check workspace --preset stellar --root ~/Projects
```

## What you get

- `~/Projects/CHANGELOG_IMPACT.md` — a workspace-level index with:
  - Per-project summary table (Action / Breaking / Feature / Info counts)
  - "Action Required" items that hit multiple repos
  - Breaking / deprecation rollup across the workspace
- `~/Projects/changelog-reports/<repo>.md` — a detailed report per project with scored entries, matched signals, reasons, and excerpts.

## Options

```bash
shopify-changelog-check workspace --preset stellar [options]
```

| Flag | Default | Notes |
|---|---|---|
| `--preset <name>` | — | Built-in preset. Currently: `stellar` |
| `--config <path>` | — | Alternative: load a custom JSON/JSONC workspace config |
| `--root <path>` | `cwd` | Where the repo folders live |
| `--since-days <n>` | `30` | Window of changelog entries to evaluate |
| `--output-dir <path>` | `<root>/changelog-reports` | Per-project report directory |
| `--combined-output <path>` | `<root>/CHANGELOG_IMPACT.md` | Workspace index path |
| `--no-combined` | off | Skip the combined index |
| `--no-llm` | off | Skip Claude re-rank even if `ANTHROPIC_API_KEY` is set |
| `--cache-dir <path>` | `<root>/.changelog-cache` | RSS cache location |

If a repo folder is missing from `--root`, it's skipped with a warning — you don't need every repo cloned to get useful output.

### Optional LLM re-rank

Set `ANTHROPIC_API_KEY` in the environment to have Claude take a second look at ambiguous matches (score 40-69). Pure rule-based results are already usable; the LLM just cleans up borderline noise.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
shopify-changelog-check workspace --preset stellar
```

## Single-project mode

You can still run it inside a single repo — useful for ad-hoc checks without configuring the workspace layout:

```bash
cd stellar-shopify
npx -y github:CLundborg/stellar-shopify-changelog-checker --project-type theme
```

Valid `--project-type` values: `theme`, `remix-app`, `extension-only`.

## Custom workspace config

Prefer your own project list? Drop a JSONC file anywhere and point `--config` at it:

```jsonc
{
  "sinceDays": 60,
  "outputDir": "./changelog-reports",
  "combinedOutput": "./CHANGELOG_IMPACT.md",
  "projects": [
    { "name": "my-theme", "rootDir": "my-theme", "projectType": "theme" },
    { "name": "my-app",   "rootDir": "my-app",   "projectType": "remix-app" }
  ]
}
```

```bash
shopify-changelog-check workspace --config ./stellar-changelog-workspace.jsonc
```

## Developing this tool

```bash
git clone https://github.com/CLundborg/stellar-shopify-changelog-checker.git
cd stellar-shopify-changelog-checker
npm install
npm run build       # one-shot
npm run dev         # watch mode
node dist/cli.js workspace --preset stellar --root ~/Projects
```

## Layout

```
src/
  cli.ts            CLI entrypoint (bin target)
  config.ts         Loads single-project config from package.json
  presets.ts        Built-in workspace presets (stellar)
  workspace.ts      Multi-project orchestrator + combined index renderer
  fetch.ts          RSS fetch + last-seen cache
  scan/
    index.ts        Dispatches by projectType
    shared.ts       @shopify/* package detection
    theme.ts        Liquid tags/filters, theme config
    remix-app.ts    shopify.app.toml, GraphQL queries
    extension.ts    shopify.extension.toml targets
  match-rules.ts    Deterministic scoring engine
  llm-rerank.ts     Optional Claude re-rank (env-gated)
  render-md.ts      Per-project markdown renderer
  types.ts          Shared types
```
