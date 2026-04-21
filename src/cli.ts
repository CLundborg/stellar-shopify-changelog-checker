#!/usr/bin/env node
import process from "node:process";
import { join } from "node:path";
import pc from "picocolors";
import { fetchChangelog } from "./fetch.js";

interface CliFlags {
  sinceDays: number;
  cacheDir: string;
  feedUrl?: string;
  raw: boolean;
}

function parseFlags(argv: string[]): CliFlags {
  const flags: CliFlags = {
    sinceDays: 30,
    cacheDir: join(process.cwd(), ".changelog-cache"),
    raw: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since-days" && argv[i + 1]) {
      flags.sinceDays = Number(argv[++i]);
    } else if (a === "--cache-dir" && argv[i + 1]) {
      flags.cacheDir = argv[++i]!;
    } else if (a === "--feed-url" && argv[i + 1]) {
      flags.feedUrl = argv[++i];
    } else if (a === "--raw") {
      flags.raw = true;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return flags;
}

function printHelp(): void {
  console.log(`shopify-changelog-check [options]

Options:
  --since-days N     Only include entries from the last N days (default: 30)
  --cache-dir PATH   Cache directory (default: <cwd>/.changelog-cache)
  --feed-url URL     Override the RSS feed URL
  --raw              Print the parsed RSS entries as JSON (M2 preview mode)
  -h, --help         Show this help
`);
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv.slice(2));

  process.stderr.write(
    pc.dim(
      `[shopify-changelog-check] fetching RSS (since ${flags.sinceDays}d)...\n`,
    ),
  );

  const entries = await fetchChangelog({
    sinceDays: flags.sinceDays,
    cacheDir: flags.cacheDir,
    feedUrl: flags.feedUrl,
  });

  if (flags.raw) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  console.log(pc.green(`Fetched ${entries.length} entries:`));
  for (const e of entries.slice(0, 20)) {
    const flags = [
      e.actionRequired ? pc.red("[ACTION]") : "",
      ...e.apiVersions.map((v) => pc.cyan(`[${v}]`)),
    ]
      .filter(Boolean)
      .join(" ");
    console.log(
      `  ${pc.dim(e.publishedAt.slice(0, 10))}  ${flags}${flags ? " " : ""}${e.title}`,
    );
  }
  if (entries.length > 20) {
    console.log(pc.dim(`  ... and ${entries.length - 20} more`));
  }
  console.log(
    pc.dim(`\nNote: scoring/report pipeline lands in M7+. This is M2 preview.`),
  );
}

main().catch((err) => {
  console.error(pc.red(String(err)));
  if (err instanceof Error && err.stack) console.error(pc.dim(err.stack));
  process.exit(1);
});
