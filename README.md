# @stellar/shopify-changelog-checker

A personal CLI tool that scans your local Stellar Shopify repos and tells you which entries in the [Shopify developer changelog](https://shopify.dev/changelog) directly impact your code.

- **No project changes.** Nothing gets committed to the theme or app repos — each dev installs the tool for themselves.
- **Workspace-aware.** One run scans all 7 Stellar repos (theme + 6 apps) and writes per-project reports, a combined markdown index, and an HTML dashboard.
- **Hybrid analysis.** Rule-based signal matching, optionally re-ranked by Claude when `ANTHROPIC_API_KEY` is set.

## Team onboarding (5 minutes)

### 1. Prerequisites

- **Node.js ≥ 20** — check with `node -v`. If missing on macOS: `brew install node`.
- **Cursor** (or VS Code).

### 2. Clone the repos

Pick a parent folder — we'll use `~/Projects/` in the examples. Clone the Stellar repos as **siblings** inside it:

```bash
cd ~/Projects
git clone git@github.com:<org>/stellar-shopify.git
git clone git@github.com:<org>/stellar-app-wishlist.git
git clone git@github.com:<org>/stellar-shopify-app-gift-purchase-discount.git
git clone git@github.com:<org>/stellar-shopify-app-print-invoice.git
git clone git@github.com:<org>/stellar-shopify-app-base-ui-extensions.git
git clone git@github.com:<org>/stellar-shopify-app-bloomreach-enhancements.git
git clone git@github.com:<org>/stellar-shopify-app-salesforce-notification.git
```

You only need the repos you work on — missing ones are skipped with a warning.

### 3. Generate reports (one command)

```bash
cd ~/Projects
npx -y github:CLundborg/stellar-shopify-changelog-checker workspace --preset fiskars
```

First run takes ~20-30s while `npx` compiles the tool. Subsequent runs are ~2-5s.

Everything lands under `~/Projects/fiskars-shopify-workspace/`:

```
CHANGELOG_IMPACT.html           ← double-click to browse the dashboard
CHANGELOG_IMPACT.md             ← markdown summary
changelog-reports/
  stellar-shopify.md
  stellar-app-*.md              ← one per app
```

Open the dashboard:

```bash
open ~/Projects/fiskars-shopify-workspace/CHANGELOG_IMPACT.html
```

### 4. Set up the Cursor workspace

Save this as `~/Projects/fiskars-shopify-workspace.code-workspace`:

```json
{
  "folders": [
    { "name": "📊 Shopify changelog reports", "path": "fiskars-shopify-workspace" },
    { "name": "stellar-shopify", "path": "stellar-shopify" },
    { "name": "stellar-app-wishlist", "path": "stellar-app-wishlist" },
    { "name": "stellar-shopify-app-gift-purchase-discount", "path": "stellar-shopify-app-gift-purchase-discount" },
    { "name": "stellar-shopify-app-print-invoice", "path": "stellar-shopify-app-print-invoice" },
    { "name": "stellar-shopify-app-base-ui-extensions", "path": "stellar-shopify-app-base-ui-extensions" },
    { "name": "stellar-shopify-app-bloomreach-enhancements", "path": "stellar-shopify-app-bloomreach-enhancements" },
    { "name": "stellar-shopify-app-salesforce-notification", "path": "stellar-shopify-app-salesforce-notification" }
  ]
}
```

Then open it:

```bash
cursor ~/Projects/fiskars-shopify-workspace.code-workspace
```

You'll see `📊 Shopify changelog reports` at the top of the sidebar alongside all the repos.

> If you already have a `fiskars-shopify-workspace.code-workspace`, just add the `"📊 Shopify changelog reports"` entry as the first item in `folders`.

### 5. Add a refresh alias

Append to `~/.zshrc` (or `~/.bashrc`):

```bash
alias fiskars-changelog='cd ~/Projects && npx -y github:CLundborg/stellar-shopify-changelog-checker workspace --preset fiskars'
```

Reload and refresh any time:

```bash
source ~/.zshrc
fiskars-changelog
```

### 6. Optional — smarter filtering with Claude

Rule-based scoring occasionally includes App Bridge posts that don't apply to a Liquid theme. An Anthropic API key enables a re-rank step that filters those out:

```bash
export ANTHROPIC_API_KEY=sk-ant-...    # add to ~/.zshrc to persist
fiskars-changelog
```

## What you get

Each run writes, under `<workspace-root>/fiskars-shopify-workspace/`:

- **`CHANGELOG_IMPACT.html`** — a self-contained dashboard (inline CSS + JS, no CDN). Filter by severity or project, free-text search, expand per-project scoring details, click through to Shopify's changelog posts. Auto light/dark theme.
- **`CHANGELOG_IMPACT.md`** — markdown summary with per-project counts table, cross-project Action Required roll-up, and Breaking / Deprecation roll-up.
- **`changelog-reports/<repo>.md`** — one detailed report per project, with scored entries, matched signals, reasons, excerpts, and LLM assessments (when enabled).

## Quick reference

| What | Command |
|---|---|
| First run / refresh | `fiskars-changelog` |
| Open dashboard | `open ~/Projects/fiskars-shopify-workspace/CHANGELOG_IMPACT.html` |
| Upgrade the tool | `npx -y github:CLundborg/stellar-shopify-changelog-checker@latest workspace --preset fiskars` |
| Skip HTML (only md) | add `--no-html` |
| Skip Claude re-rank | add `--no-llm` |
| Wider time window | add `--since-days 60` |
| Different parent folder | add `--root ~/path/to/repos` |

## Install options

### A — zero-install with npx (recommended)

What the onboarding above uses. `npx` caches the build after first run. To pin a version: `github:CLundborg/stellar-shopify-changelog-checker#v0.1.0`.

### B — global install

```bash
npm install -g github:CLundborg/stellar-shopify-changelog-checker
cd ~/Projects
shopify-changelog-check workspace --preset fiskars
```

### C — dedicated tool folder

If you prefer not to touch the global npm prefix:

```bash
mkdir -p ~/tools/shopify-changelog && cd ~/tools/shopify-changelog
npm init -y
npm install github:CLundborg/stellar-shopify-changelog-checker
npx shopify-changelog-check workspace --preset fiskars --root ~/Projects
```

## All CLI options

```bash
shopify-changelog-check workspace --preset fiskars [options]
```

| Flag | Default | Notes |
|---|---|---|
| `--preset <name>` | — | Built-in preset. One of: `fiskars`, `stellar` |
| `--config <path>` | — | Alternative: load a custom JSON/JSONC workspace config |
| `--root <path>` | `cwd` | Where the repo folders live |
| `--since-days <n>` | `30` | Window of changelog entries to evaluate |
| `--output-dir <path>` | preset-dependent | Per-project report directory |
| `--combined-output <path>` | preset-dependent | Workspace index path (md + html alongside) |
| `--no-combined` | off | Skip the combined index (also skips HTML) |
| `--no-html` | off | Skip just the HTML dashboard |
| `--no-llm` | off | Skip Claude re-rank even if `ANTHROPIC_API_KEY` is set |
| `--cache-dir <path>` | preset-dependent | RSS cache location |

**Preset defaults:**

- `fiskars` — everything under `<root>/fiskars-shopify-workspace/` (keeps your `~/Projects/` clean)
- `stellar` — outputs directly under `<root>/`

Both presets scan the same 7 repos.

### Optional LLM re-rank

Set `ANTHROPIC_API_KEY` to have Claude second-guess ambiguous matches (score 40-69). Pure rule-based results are usable as-is; the LLM just cleans up borderline noise.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
fiskars-changelog
```

## Single-project mode

Useful for ad-hoc checks inside a single repo:

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
shopify-changelog-check workspace --config ./my-workspace.jsonc
```

## Developing this tool

```bash
git clone https://github.com/CLundborg/stellar-shopify-changelog-checker.git
cd stellar-shopify-changelog-checker
npm install
npm run build       # one-shot
npm run dev         # watch mode
node dist/cli.js workspace --preset fiskars --root ~/Projects
```

## Layout

```
src/
  cli.ts            CLI entrypoint (bin target)
  config.ts         Loads single-project config from package.json
  presets.ts        Built-in workspace presets (fiskars, stellar)
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
  render-html.ts    Workspace HTML dashboard renderer
  types.ts          Shared types
```
