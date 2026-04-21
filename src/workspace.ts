import { mkdir, writeFile, readFile, access } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import type {
  MatchResult,
  WorkspaceConfig,
  WorkspaceProjectResult,
  WorkspaceRunResult,
  Severity,
} from "./types.js";
import { fetchChangelog } from "./fetch.js";
import { scanProject } from "./scan/index.js";
import { matchEntries } from "./match-rules.js";
import { llmRerank } from "./llm-rerank.js";
import { renderMarkdown } from "./render-md.js";
import { renderHtmlDashboard } from "./render-html.js";

export interface WorkspaceRunOptions {
  workspaceRoot: string;
  cacheDir: string;
  feedUrl?: string;
  llm?: {
    apiKey?: string;
    model?: string;
    enabled?: boolean;
  };
  onLog?: (msg: string) => void;
}

export async function runWorkspace(
  config: WorkspaceConfig,
  options: WorkspaceRunOptions,
): Promise<WorkspaceRunResult> {
  const log = options.onLog ?? (() => {});
  const sinceDays = config.sinceDays ?? 30;
  const feedUrl =
    options.feedUrl ?? "https://shopify.dev/changelog/feed.xml";

  log(`[workspace] root = ${options.workspaceRoot}`);
  log(`[workspace] fetching RSS (since ${sinceDays}d)...`);
  const entries = await fetchChangelog({
    sinceDays,
    cacheDir: options.cacheDir,
    feedUrl,
  });
  log(`[workspace] ${entries.length} entries in window`);

  const useLlm =
    options.llm?.enabled !== false && !!options.llm?.apiKey;

  const results: WorkspaceProjectResult[] = [];
  for (const spec of config.projects) {
    const rootDir = isAbsolute(spec.rootDir)
      ? spec.rootDir
      : resolve(options.workspaceRoot, spec.rootDir);

    try {
      await access(rootDir);
    } catch {
      log(`  ⚠ ${spec.name}: not found at ${rootDir} — skipping`);
      results.push({
        spec,
        matches: [],
        signalCount: 0,
        error: `Directory not found: ${rootDir}`,
      });
      continue;
    }

    log(`  → ${spec.name} (${spec.projectType})`);
    try {
      const signals = await scanProject({
        projectType: spec.projectType,
        rootDir,
        outputPath: "(unused in workspace mode)",
      });
      let matches = matchEntries(entries, signals);
      if (useLlm) {
        matches = await llmRerank(matches, signals, {
          apiKey: options.llm!.apiKey,
          model: options.llm?.model,
          verbose: true,
        });
      }
      log(
        `      signals=${signals.length} matches=${matches.length}${matches.length > 0 ? ` (${summaryCounts(matches)})` : ""}`,
      );
      results.push({ spec, matches, signalCount: signals.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log(`  ✖ ${spec.name}: ${msg}`);
      results.push({ spec, matches: [], signalCount: 0, error: msg });
    }
  }

  return {
    results,
    totalEntries: entries.length,
    usedLlm: useLlm,
    feedUrl,
    sinceDate: new Date(Date.now() - sinceDays * 86_400_000),
    generatedAt: new Date(),
  };
}

export async function writeWorkspaceReports(
  run: WorkspaceRunResult,
  config: WorkspaceConfig,
  workspaceRoot: string,
  options: { writeHtml?: boolean } = {},
): Promise<{
  perProjectPaths: string[];
  combinedPath?: string;
  htmlPath?: string;
}> {
  const outputDirAbs = isAbsolute(config.outputDir)
    ? config.outputDir
    : resolve(workspaceRoot, config.outputDir);
  await mkdir(outputDirAbs, { recursive: true });

  const perProjectPaths: string[] = [];

  for (const result of run.results) {
    if (result.error) continue;
    const fileName = slug(result.spec.name) + ".md";
    const outputPath = join(outputDirAbs, fileName);
    const md = renderMarkdown(result.matches, {
      repoName: result.spec.name,
      generatedAt: run.generatedAt,
      sinceDate: run.sinceDate,
      usedLlm: run.usedLlm,
      feedUrl: run.feedUrl,
      totalEntries: run.totalEntries,
    });
    await writeFile(outputPath, md);
    perProjectPaths.push(outputPath);
  }

  let combinedPath: string | undefined;
  if (config.combinedOutput) {
    combinedPath = isAbsolute(config.combinedOutput)
      ? config.combinedOutput
      : resolve(workspaceRoot, config.combinedOutput);
    await mkdir(dirname(combinedPath), { recursive: true });
    const combined = renderCombined(run, outputDirAbs, combinedPath);
    await writeFile(combinedPath, combined);
  }

  let htmlPath: string | undefined;
  if (options.writeHtml !== false && config.combinedOutput) {
    const base = isAbsolute(config.combinedOutput)
      ? config.combinedOutput
      : resolve(workspaceRoot, config.combinedOutput);
    htmlPath = base.replace(/\.md$/i, "") + ".html";
    if (htmlPath === base) htmlPath = base + ".html";
    await mkdir(dirname(htmlPath), { recursive: true });
    await writeFile(htmlPath, renderHtmlDashboard(run));
  }

  return { perProjectPaths, combinedPath, htmlPath };
}

function renderCombined(
  run: WorkspaceRunResult,
  outputDirAbs: string,
  combinedPathAbs: string,
): string {
  const lines: string[] = [];
  lines.push(`# Shopify Changelog Impact — Stellar Workspace`);
  lines.push("");
  lines.push(
    `_Generated: ${formatDate(run.generatedAt)} — Covers entries since ${formatDate(run.sinceDate)} — Scanned ${run.totalEntries} entries — LLM: ${run.usedLlm ? "enabled" : "disabled"}_`,
  );
  lines.push("");
  lines.push(`Feed: [${run.feedUrl}](${run.feedUrl})`);
  lines.push("");

  lines.push(`## Per-project summary`);
  lines.push("");
  lines.push(
    `| Project | Action | Breaking | Feature | Info | Total | Report |`,
  );
  lines.push(`|---|---:|---:|---:|---:|---:|---|`);
  const combinedDir = dirname(combinedPathAbs);
  for (const r of run.results) {
    const c = countsBySeverity(r.matches);
    const total = r.matches.length;
    const reportRel = relative(
      combinedDir,
      join(outputDirAbs, slug(r.spec.name) + ".md"),
    );
    const link = r.error ? `_(${r.error})_` : `[view](./${reportRel.replace(/\\/g, "/")})`;
    lines.push(
      `| \`${r.spec.name}\` | ${c.action} | ${c.breaking} | ${c.feature} | ${c.info} | **${total}** | ${link} |`,
    );
  }
  lines.push("");

  // Cross-project Action Required roll-up
  const actionItems = collectAcrossProjects(run, "action");
  if (actionItems.length > 0) {
    lines.push(`## Action Required across the workspace`);
    lines.push("");
    for (const { entry, projects } of actionItems) {
      lines.push(
        `### ${formatDate(new Date(entry.publishedAt))} — ${entry.title}`,
      );
      lines.push("");
      lines.push(`- [Shopify post](${entry.link})`);
      lines.push(`- Impacts: ${projects.map((p) => `\`${p}\``).join(", ")}`);
      if (entry.apiVersions.length > 0) {
        lines.push(`- API versions: ${entry.apiVersions.join(", ")}`);
      }
      const excerpt = entry.body.slice(0, 300).trim();
      if (excerpt) {
        lines.push("");
        lines.push(`> ${excerpt}${entry.body.length > 300 ? "…" : ""}`);
      }
      lines.push("");
    }
  }

  // Cross-project Breaking roll-up
  const breakingItems = collectAcrossProjects(run, "breaking");
  if (breakingItems.length > 0) {
    lines.push(`## Breaking / Deprecations across the workspace`);
    lines.push("");
    for (const { entry, projects } of breakingItems) {
      lines.push(
        `- **${formatDate(new Date(entry.publishedAt))}** — [${entry.title}](${entry.link}) — _${projects.length} project${projects.length === 1 ? "" : "s"}: ${projects.map((p) => `\`${p}\``).join(", ")}_`,
      );
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

function collectAcrossProjects(
  run: WorkspaceRunResult,
  severity: Severity,
): Array<{ entry: MatchResult["entry"]; projects: string[] }> {
  const byEntry = new Map<
    string,
    { entry: MatchResult["entry"]; projects: Set<string> }
  >();
  for (const r of run.results) {
    for (const m of r.matches) {
      if (m.severity !== severity) continue;
      const key = m.entry.id || m.entry.link || m.entry.title;
      const existing = byEntry.get(key);
      if (existing) {
        existing.projects.add(r.spec.name);
      } else {
        byEntry.set(key, {
          entry: m.entry,
          projects: new Set([r.spec.name]),
        });
      }
    }
  }
  return Array.from(byEntry.values())
    .map((v) => ({ entry: v.entry, projects: [...v.projects].sort() }))
    .sort(
      (a, b) =>
        Date.parse(b.entry.publishedAt) - Date.parse(a.entry.publishedAt),
    );
}

function countsBySeverity(matches: MatchResult[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    action: 0,
    breaking: 0,
    feature: 0,
    info: 0,
  };
  for (const m of matches) counts[m.severity] += 1;
  return counts;
}

function summaryCounts(matches: MatchResult[]): string {
  const c = countsBySeverity(matches);
  return `A:${c.action} B:${c.breaking} F:${c.feature} I:${c.info}`;
}

function slug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function loadWorkspaceConfigFile(
  path: string,
): Promise<WorkspaceConfig> {
  const raw = await readFile(path, "utf8");
  const stripped = stripJsonComments(raw);
  const parsed = JSON.parse(stripped) as WorkspaceConfig;
  if (!Array.isArray(parsed.projects) || parsed.projects.length === 0) {
    throw new Error(
      `Workspace config at ${path} must have a non-empty "projects" array`,
    );
  }
  return parsed;
}

function stripJsonComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
