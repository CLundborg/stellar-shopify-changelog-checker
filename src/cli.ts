#!/usr/bin/env node
import process from "node:process";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
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
import {
  loadWorkspaceConfigFile,
  runWorkspace,
  writeWorkspaceReports,
} from "./workspace.js";
import { getPreset, PRESET_NAMES, type PresetName } from "./presets.js";

interface CommonFlags {
  feedUrl?: string;
  cacheDir?: string;
  noLlm: boolean;
  sinceDays?: number;
}

interface CheckFlags extends CommonFlags {
  projectType?: string;
  rootDir?: string;
  outputPath?: string;
  raw: boolean;
}

interface WorkspaceFlags extends CommonFlags {
  preset?: string;
  configPath?: string;
  root?: string;
  outputDir?: string;
  combinedOutput?: string;
  noCombined: boolean;
}

function log(msg: string): void {
  process.stderr.write(msg + "\n");
}

function printHelp(): void {
  console.log(`shopify-changelog-check [command] [options]

Commands:
  check                 (default) Scan the current project and write a report
  workspace             Scan multiple projects in one pass

Common options:
  --since-days N        Include entries from the last N days (default: 30)
  --feed-url URL        Override the RSS feed URL
  --cache-dir PATH      Cache directory (default: ./.changelog-cache)
  --no-llm              Skip the LLM re-rank step
  -h, --help            Show this help

Check options (default command):
  --project-type TYPE   "theme" | "remix-app" | "extension-only"
  --root-dir PATH       Directory to scan (default: .)
  --output PATH         Report output path (default: CHANGELOG_IMPACT.md)
  --raw                 Preview mode: print parsed RSS entries as JSON

Workspace options:
  --preset NAME         Built-in workspace preset (one of: ${PRESET_NAMES.join(", ")})
  --config PATH         Workspace config file (JSON or JSONC)
  --root PATH           Workspace root dir (default: current dir)
  --output-dir PATH     Per-project reports directory
                        (default: <root>/changelog-reports)
  --combined-output PATH Path for combined workspace index
                        (default: <root>/CHANGELOG_IMPACT.md)
  --no-combined         Don't write the combined workspace index

Environment:
  ANTHROPIC_API_KEY     Enables Claude re-rank of ambiguous matches.

Examples:
  # Single project (run from inside the repo)
  shopify-changelog-check --project-type remix-app

  # Scan all Stellar repos at once (from the folder that contains them)
  shopify-changelog-check workspace --preset stellar
`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    return;
  }

  const [first, ...rest] = argv;
  if (first === "workspace") {
    await runWorkspaceCommand(parseWorkspaceFlags(rest));
    return;
  }

  // Default command is "check". Also accept an explicit "check".
  const checkArgv = first === "check" ? rest : argv;
  await runCheckCommand(parseCheckFlags(checkArgv));
}

function parseCommon(
  argv: string[],
  flags: CommonFlags,
  i: number,
): number | null {
  const a = argv[i];
  switch (a) {
    case "--since-days":
      flags.sinceDays = Number(argv[++i]);
      return i;
    case "--feed-url":
      flags.feedUrl = argv[++i];
      return i;
    case "--cache-dir":
      flags.cacheDir = argv[++i];
      return i;
    case "--no-llm":
      flags.noLlm = true;
      return i;
  }
  return null;
}

function parseCheckFlags(argv: string[]): CheckFlags {
  const flags: CheckFlags = { noLlm: false, raw: false };
  for (let i = 0; i < argv.length; i++) {
    const consumed = parseCommon(argv, flags, i);
    if (consumed !== null) {
      i = consumed;
      continue;
    }
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
      case "--raw":
        flags.raw = true;
        break;
    }
  }
  return flags;
}

function parseWorkspaceFlags(argv: string[]): WorkspaceFlags {
  const flags: WorkspaceFlags = { noLlm: false, noCombined: false };
  for (let i = 0; i < argv.length; i++) {
    const consumed = parseCommon(argv, flags, i);
    if (consumed !== null) {
      i = consumed;
      continue;
    }
    const a = argv[i];
    switch (a) {
      case "--preset":
        flags.preset = argv[++i];
        break;
      case "--config":
        flags.configPath = argv[++i];
        break;
      case "--root":
        flags.root = argv[++i];
        break;
      case "--output-dir":
        flags.outputDir = argv[++i];
        break;
      case "--combined-output":
        flags.combinedOutput = argv[++i];
        break;
      case "--no-combined":
        flags.noCombined = true;
        break;
    }
  }
  return flags;
}

async function runCheckCommand(flags: CheckFlags): Promise<void> {
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

async function runWorkspaceCommand(flags: WorkspaceFlags): Promise<void> {
  if (!flags.preset && !flags.configPath) {
    throw new ConfigError(
      `workspace: pass either --preset <name> (one of: ${PRESET_NAMES.join(", ")}) or --config <path>.`,
    );
  }
  if (flags.preset && flags.configPath) {
    throw new ConfigError(
      `workspace: pass only one of --preset and --config.`,
    );
  }

  const workspaceRoot = resolve(flags.root ?? process.cwd());
  const apiKey = process.env["ANTHROPIC_API_KEY"];

  const config = flags.configPath
    ? await loadWorkspaceConfigFile(resolve(flags.configPath))
    : getPreset(flags.preset as PresetName, {
        sinceDays: flags.sinceDays,
        outputDir: flags.outputDir,
        combinedOutput: flags.noCombined
          ? undefined
          : flags.combinedOutput,
      });

  // CLI flags win over config file/preset defaults.
  if (flags.sinceDays !== undefined) config.sinceDays = flags.sinceDays;
  if (flags.outputDir) config.outputDir = flags.outputDir;
  if (flags.noCombined) config.combinedOutput = undefined;
  else if (flags.combinedOutput) config.combinedOutput = flags.combinedOutput;

  const cacheDir = flags.cacheDir
    ? resolve(flags.cacheDir)
    : config.cacheDir
      ? resolve(workspaceRoot, config.cacheDir)
      : join(workspaceRoot, ".changelog-cache");

  log(pc.bold(`\nShopify changelog impact check — workspace mode`));
  const run = await runWorkspace(config, {
    workspaceRoot,
    cacheDir,
    feedUrl: flags.feedUrl,
    llm: {
      apiKey,
      enabled: flags.noLlm ? false : undefined,
    },
    onLog: (m) => log(pc.dim(m)),
  });

  const written = await writeWorkspaceReports(run, config, workspaceRoot);
  log("");
  log(
    pc.green(
      `Wrote ${written.perProjectPaths.length} per-project report(s) to ${resolveDisplay(workspaceRoot, config.outputDir)}`,
    ),
  );
  if (written.combinedPath) {
    log(pc.green(`Combined index: ${written.combinedPath}`));
  }

  const skipped = run.results.filter((r) => r.error);
  if (skipped.length > 0) {
    log(
      pc.yellow(
        `\n${skipped.length} project(s) skipped:`,
      ),
    );
    for (const s of skipped) {
      log(pc.yellow(`  - ${s.spec.name}: ${s.error}`));
    }
  }
}

function resolveDisplay(root: string, p: string): string {
  return resolve(root, p);
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
