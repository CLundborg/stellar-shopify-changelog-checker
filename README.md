# @stellar/shopify-changelog-checker

Scans a Stellar Shopify project (theme, Remix app, or UI extensions package) and reports which entries in the [Shopify developer changelog](https://shopify.dev/changelog) directly impact its code.

Runs locally via `npm run changelog:check` in each consumer repo and writes a `CHANGELOG_IMPACT.md` summary grouped by severity (Action Required / Breaking / New features / Informational).

## How it works

1. Fetches the Shopify changelog RSS feed (`https://shopify.dev/changelog/feed.xml`).
2. Scans the current project and extracts "signals" (Admin API version in use, access scopes, extension targets, Liquid tags/filters, `@shopify/*` package versions, ...).
3. Scores each changelog entry against those signals using a deterministic rule engine.
4. Optionally re-ranks ambiguous candidates with Claude (Anthropic) when `ANTHROPIC_API_KEY` is set.
5. Renders a markdown report into the consumer repo.

## Installing in a consumer repo

### Phase 1 — local `file:` link (dev mode)

From each consumer repo's root:

```bash
npm install --save-dev "file:../stellar-shopify-changelog-checker"
```

### Phase 2 — install from GitHub (once stable)

```bash
npm install --save-dev "github:<org>/stellar-shopify-changelog-checker#v0.1.0"
```

### Configure and wire up

Add to the consumer's `package.json`:

```json
{
  "scripts": {
    "changelog:check": "shopify-changelog-check"
  },
  "shopify-changelog-checker": {
    "projectType": "remix-app",
    "rootDir": ".",
    "outputPath": "CHANGELOG_IMPACT.md",
    "sinceDays": 30
  }
}
```

`projectType` must be one of `"theme"`, `"remix-app"`, or `"extension-only"`.

All of the above can be overridden via CLI flags:

```bash
npx shopify-changelog-check --project-type theme --since-days 60
```

Add `.changelog-cache/` to the consumer's `.gitignore`.

Then run:

```bash
npm run changelog:check
```

### Optional: LLM re-rank with Claude

Set `ANTHROPIC_API_KEY` in the environment to have Claude re-rank ambiguous matches (scores 40-69). Disable per-run with `--no-llm`, or project-wide with:

```json
{
  "shopify-changelog-checker": {
    "llm": { "enabled": false }
  }
}
```

## Local development of this tool

```bash
git clone <this-repo>
cd stellar-shopify-changelog-checker
npm install
npm run build       # one-shot compile to dist/
npm run dev         # watch mode
```

Consumers using `file:../stellar-shopify-changelog-checker` pick up rebuilds immediately.

## Layout

```
src/
  cli.ts            CLI entrypoint (bin target)
  config.ts         Loads changelog-checker.config.ts from consumer cwd
  fetch.ts          RSS fetch + last-seen cache
  scan/
    index.ts        Dispatches by projectType
    shared.ts       @shopify/* package detection
    theme.ts        Liquid tags/filters, theme config
    remix-app.ts    shopify.app.toml, GraphQL queries
    extension.ts    shopify.extension.toml targets
  match-rules.ts    Deterministic scoring engine
  llm-rerank.ts     Optional Claude re-rank (env-gated)
  render-md.ts      Markdown report writer
  signals.ts        Signal type + helpers
  types.ts          Shared types (ChangelogEntry, MatchResult, ...)
```

## Status

Early scaffold. Pipeline stubs in place; rule engine and renderers land in subsequent milestones.
