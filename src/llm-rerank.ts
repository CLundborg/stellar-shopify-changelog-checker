import Anthropic from "@anthropic-ai/sdk";
import type {
  ChangelogEntry,
  MatchResult,
  Severity,
  Signal,
} from "./types.js";

export interface LlmRerankOptions {
  apiKey?: string;
  model?: string;
  lowerBound?: number;
  upperBound?: number;
  verbose?: boolean;
}

interface LlmJudgment {
  impacts: boolean;
  reason: string;
  severity: Severity;
}

const DEFAULT_MODEL = "claude-sonnet-4-5";
const DEFAULT_LOWER = 40;
const DEFAULT_UPPER = 69;

/**
 * Sends ambiguous matches (score in [lowerBound, upperBound]) to Claude with a
 * compact project summary and returns the matches annotated with the LLM's
 * judgment. Non-impacting matches are dropped unless they're already above the
 * definite threshold. Returns the input unchanged if no API key is set.
 */
export async function llmRerank(
  matches: MatchResult[],
  signals: Signal[],
  options: LlmRerankOptions,
): Promise<MatchResult[]> {
  if (!options.apiKey) return matches;

  const lower = options.lowerBound ?? DEFAULT_LOWER;
  const upper = options.upperBound ?? DEFAULT_UPPER;

  const ambiguous = matches
    .map((m, i) => ({ index: i, match: m }))
    .filter(
      ({ match }) =>
        !match.entry.actionRequired &&
        match.score >= lower &&
        match.score <= upper,
    );

  if (ambiguous.length === 0) return matches;

  const client = new Anthropic({ apiKey: options.apiKey });
  const summary = buildProjectSummary(signals);
  const prompt = buildPrompt(
    ambiguous.map((a) => a.match.entry),
    summary,
  );

  const response = await client.messages.create({
    model: options.model ?? DEFAULT_MODEL,
    max_tokens: 4000,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter(
      (b): b is { type: "text"; text: string; citations: null } =>
        b.type === "text",
    )
    .map((b) => b.text)
    .join("");

  const judgments = parseJudgments(text, ambiguous.length);
  if (!judgments) {
    if (options.verbose) {
      process.stderr.write(
        `[llm-rerank] failed to parse JSON from model response; skipping rerank\n`,
      );
    }
    return matches;
  }

  const result = [...matches];
  ambiguous.forEach(({ index, match }, i) => {
    const j = judgments[i];
    if (!j) return;
    result[index] = {
      ...match,
      llmAssessed: j,
      severity: j.severity,
    };
  });

  return result.filter((m) => {
    if (!m.llmAssessed) return true;
    if (m.score >= upper + 1) return true;
    if (m.entry.actionRequired) return true;
    return m.llmAssessed.impacts;
  });
}

function buildProjectSummary(signals: Signal[]): string {
  const byKind = new Map<Signal["kind"], string[]>();
  for (const s of signals) {
    const arr = byKind.get(s.kind) ?? [];
    arr.push(s.value);
    byKind.set(s.kind, arr);
  }
  const lines: string[] = [];
  for (const [kind, values] of byKind) {
    const unique = Array.from(new Set(values));
    const shown = unique.slice(0, 40);
    const more = unique.length > shown.length ? ` (+${unique.length - shown.length} more)` : "";
    lines.push(`- ${kind}: ${shown.join(", ")}${more}`);
  }
  return lines.join("\n");
}

function buildPrompt(entries: ChangelogEntry[], summary: string): string {
  const serialized = entries
    .map((e, i) => {
      const body = e.body.slice(0, 900);
      return `[${i}] ${e.title}
  tags: ${e.tags.join(", ")}
  apiVersions: ${e.apiVersions.join(", ") || "(none)"}
  body: ${body}`;
    })
    .join("\n\n");

  return `You are triaging entries from the Shopify developer changelog for a specific
Stellar project. For each entry, decide whether it DIRECTLY impacts THIS
project's current code.

Bias toward "impacts: true" only when the entry references an API version,
scope, extension target, Liquid construct, @shopify package, or GraphQL
operation that the project actually uses. Generic "nice to know" announcements
should be "impacts: false" unless they're marked Action Required or are
obvious breaking changes on a surface the project uses.

Project signals (what this project actually uses):
${summary}

Changelog entries to evaluate:
${serialized}

Reply with ONLY a JSON array (no prose, no markdown fences) with one object
per entry in the SAME ORDER as above. Each object must have:
  - "impacts": boolean
  - "reason": short string (<= 140 chars) citing the specific signal(s) that matched, or briefly why not
  - "severity": one of "action" | "breaking" | "feature" | "info"

Example for two entries:
[{"impacts":true,"reason":"Project uses @shopify/app-bridge-react; affects TitleBar actions","severity":"action"},{"impacts":false,"reason":"Payments Apps API not used by this project","severity":"info"}]`;
}

function parseJudgments(
  text: string,
  expected: number,
): LlmJudgment[] | null {
  const trimmed = text.trim();
  const firstBracket = trimmed.indexOf("[");
  const lastBracket = trimmed.lastIndexOf("]");
  if (firstBracket === -1 || lastBracket === -1 || lastBracket <= firstBracket) {
    return null;
  }
  const slice = trimmed.slice(firstBracket, lastBracket + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(slice);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  if (parsed.length !== expected) {
    // Accept partial alignment: pad/truncate
  }
  const out: LlmJudgment[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const rec = item as Record<string, unknown>;
    const impacts = rec.impacts === true;
    const reason = typeof rec.reason === "string" ? rec.reason : "";
    const severity = normalizeSeverity(rec.severity);
    out.push({ impacts, reason, severity });
  }
  return out;
}

function normalizeSeverity(value: unknown): Severity {
  const v = typeof value === "string" ? value.toLowerCase() : "";
  if (v === "action" || v === "breaking" || v === "feature" || v === "info") {
    return v;
  }
  return "info";
}
