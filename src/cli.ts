#!/usr/bin/env node
import process from "node:process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import pc from "picocolors";
import { fetchChangelog } from "./fetch.js";
import { scanProject } from "./scan/index.js";
import { matchEntries } from "./match-rules.js";
import { llmRerank } from "./llm-rerank.js";
import { renderMarkdown } from "./render-md.js";
import {
  ConfigError,
  guessRepoName,
  loadConsumerConfig,
} from "./config.js";

interface CliFlags {
  projectType?: string;
  rootDir?: string;
  outputPath?: string;
  sinceDays?: number;
  feedUrl?: string;
  cacheDir?: string;
  raw: boolean;
  noLlm: boolean;
  help: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = { raw: false, noLlm: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--project-type":
        flags.projectType = argv[++i];
        break;
      case "--root-dir":
        flags.rootDir = argv[++i];
        break;
      case "--output":
      case "--output-path":
        flags.outputPath = argv[++i];
        break;
      case "--since-days":
        flags.sinceDays = Number(argv[++i]);
        break;
      case "--feed-url":
        flags.feedUrl = argv[++i];
        break;
      case "--cache-dir":
        flags.cacheDir = argv[++i];
        break;
      case "--raw":
        flags.raw = true;
        break;
      case "--no-llm":
        flags.noLlm = true;
        break;
      case "-h":
      case "--help":
        flags.help = true;
        break;
    }
  }
  return flags;
}

function printHelp(): void {
  console.log(`shopify-changelog-check [options]

Scans the current project and writes a markdown report of Shopify changelog
entries that impact its code. Reads config from "shopify-changelog-checker"
in package.json; CLI flags override it.

Options:
  --project-type TYPE    "theme" | "remix-app" | "extension-only"
  --root-dir PATH        Directory to scan (default: .)
  --output PATH          Report output path (default: CHANGELOG_IMPACT.md)
  --since-days N         Include entries from the last N days (default: 30)
  --feed-url URL         Override the RSS feed URL
  --cache-dir PATH       Cache directory (default: .changelog-cache)
  --no-llm               Skip the LLM re-rank step even if ANTHROPIC_API_KEY is set
  --raw                  Preview mode: print parsed RSS entries as JSON and exit
  -h, --help             Show this help

Environment:
  ANTHROPIC_API_KEY      Enables Claude re-rank of ambiguous matches.
`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    return;
  }

  if (flags.raw) {
    const entries = await fetchChangelog({
      sinceDays: flags.sinceDays ?? 30,
      cacheDir: flags.cacheDir ?? join(process.cwd(), ".changelog-cache"),
      feedUrl: flags.feedUrl,
    });
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  const cwd = process.cwd();
  const config = await loadConsumerConfig(cwd, {
    projectType: flags.projectType,
    rootDir: flags.rootDir,
    outputPath: flags.outputPath,
    sinceDays: flags.sinceDays,
    llmEnabled: flags.noLlm ? false : undefined,
  });

  const cacheDir = flags.cacheDir ?? join(config.rootDir, ".changelog-cache");
  const feedUrl =
    flags.feedUrl ?? "https://shopify.dev/changelog/feed.xml";

  log(pc.dim(`[1/4] fetching RSS (since ${config.sinceDays}d)...`));
  const entries = await fetchChangelog({
    sinceDays: config.sinceDays ?? 30,
    cacheDir,
    feedUrl,
  });
  log(pc.dim(`     → ${entries.length} entries`));

  log(pc.dim(`[2/4] scanning project signals (${config.projectType})...`));
  const signals = await scanProject(config);
  log(pc.dim(`     → ${signals.length} signals`));

  log(pc.dim(`[3/4] scoring entries against signals...`));
  let matches = matchEntries(entries, signals);
  log(pc.dim(`     → ${matches.length} candidate matches`));

  const apiKey = process.env["ANTHROPIC_API_KEY"];
  const llmEnabled =
    config.llm?.enabled !== false && !!apiKey && !flags.noLlm;
  let usedLlm = false;
  if (llmEnabled) {
    log(pc.dim(`[4/4] re-ranking ambiguous matches with Claude...`));
    const before = matches.length;
    matches = await llmRerank(matches, signals, {
      apiKey,
      model: config.llm?.model,
      verbose: true,
    });
    usedLlm = true;
    log(pc.dim(`     → ${matches.length} matches (was ${before})`));
  } else {
    log(
      pc.dim(
        `[4/4] skipping LLM re-rank (${apiKey ? "disabled via config/flag" : "ANTHROPIC_API_KEY not set"})`,
      ),
    );
  }

  const now = new Date();
  const sinceDate = new Date(
    now.getTime() - (config.sinceDays ?? 30) * 86_400_000,
  );
  const md = renderMarkdown(matches, {
    repoName: guessRepoName(cwd),
    generatedAt: now,
    sinceDate,
    usedLlm,
    feedUrl,
    totalEntries: entries.length,
  });

  await mkdir(dirname(config.outputPath), { recursive: true });
  await writeFile(config.outputPath, md);

  log(
    pc.green(
      `\nWrote ${matches.length} matches to ${config.outputPath}`,
    ),
  );
}

function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

main().catch((err) => {
  if (err instanceof ConfigError) {
    process.stderr.write(pc.red(`Config error: ${err.message}\n`));
    process.exit(2);
  }
  process.stderr.write(pc.red(String(err)) + "\n");
  if (err instanceof Error && err.stack) {
    process.stderr.write(pc.dim(err.stack) + "\n");
  }
  process.exit(1);
});
