import type { MatchResult, Severity } from "./types.js";

export interface RenderOptions {
  repoName: string;
  generatedAt: Date;
  sinceDate: Date;
  usedLlm: boolean;
  feedUrl: string;
  totalEntries: number;
}

const SEVERITY_ORDER: Severity[] = ["action", "breaking", "feature", "info"];

const SEVERITY_LABEL: Record<Severity, string> = {
  action: "Action Required",
  breaking: "Breaking / Deprecations",
  feature: "New capabilities",
  info: "Informational",
};

export function renderMarkdown(
  matches: MatchResult[],
  options: RenderOptions,
): string {
  const groups = new Map<Severity, MatchResult[]>();
  for (const sev of SEVERITY_ORDER) groups.set(sev, []);
  for (const m of matches) {
    groups.get(m.severity)!.push(m);
  }

  const lines: string[] = [];
  lines.push(`# Shopify Changelog Impact — ${options.repoName}`);
  lines.push("");
  lines.push(
    `_Generated: ${formatDate(options.generatedAt)} — Covers entries since ${formatDate(options.sinceDate)}_`,
  );
  lines.push("");
  lines.push(
    `Scanned ${options.totalEntries} changelog entries, surfaced ${matches.length} relevant to this project. ` +
      (options.usedLlm
        ? `LLM re-rank: enabled (Anthropic).`
        : `LLM re-rank: disabled (no ANTHROPIC_API_KEY).`),
  );
  lines.push("");
  lines.push(`Source: [${options.feedUrl}](${options.feedUrl})`);
  lines.push("");

  lines.push(`## Summary`);
  for (const sev of SEVERITY_ORDER) {
    const count = groups.get(sev)!.length;
    lines.push(`- **${SEVERITY_LABEL[sev]}**: ${count}`);
  }
  lines.push("");

  for (const sev of SEVERITY_ORDER) {
    const bucket = groups.get(sev)!;
    if (bucket.length === 0) continue;
    lines.push(`## ${SEVERITY_LABEL[sev]} (${bucket.length})`);
    lines.push("");
    for (const m of bucket) {
      lines.push(renderMatch(m));
      lines.push("");
    }
  }

  return lines.join("\n").trimEnd() + "\n";
}

function renderMatch(m: MatchResult): string {
  const { entry, score, reasons, matchedSignals, llmAssessed } = m;
  const pub = formatDate(new Date(entry.publishedAt));
  const lines: string[] = [];
  lines.push(`### ${pub} — ${entry.title}`);
  lines.push("");
  lines.push(`- **Link**: [${entry.link}](${entry.link})`);
  if (entry.tags.length > 0) {
    lines.push(`- **Tags**: ${entry.tags.join(", ")}`);
  }
  if (entry.apiVersions.length > 0) {
    lines.push(`- **API versions**: ${entry.apiVersions.join(", ")}`);
  }
  lines.push(`- **Score**: ${score}/100`);

  if (matchedSignals.length > 0) {
    const byKind = new Map<string, string[]>();
    for (const s of matchedSignals) {
      const arr = byKind.get(s.kind) ?? [];
      arr.push(s.value);
      byKind.set(s.kind, arr);
    }
    const formatted = Array.from(byKind.entries())
      .map(
        ([kind, vals]) =>
          `\`${kind}\`: ${Array.from(new Set(vals)).map((v) => `\`${v}\``).join(", ")}`,
      )
      .join("; ");
    lines.push(`- **Matched signals**: ${formatted}`);
  }

  if (reasons.length > 0) {
    lines.push(`- **Why it matched**:`);
    for (const r of reasons) lines.push(`  - ${r}`);
  }

  if (llmAssessed) {
    lines.push(
      `- **LLM assessment**: ${llmAssessed.impacts ? "impacts project" : "low relevance"} — ${llmAssessed.reason}`,
    );
  }

  const excerpt = entry.body.slice(0, 400).trim();
  if (excerpt) {
    lines.push("");
    lines.push(`> ${excerpt}${entry.body.length > 400 ? "…" : ""}`);
  }

  return lines.join("\n");
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
