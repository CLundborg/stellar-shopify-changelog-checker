import type {
  ChangelogEntry,
  MatchResult,
  Severity,
  Signal,
} from "./types.js";

export interface MatchOptions {
  candidateThreshold: number;
  definiteThreshold: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  candidateThreshold: 40,
  definiteThreshold: 70,
};

interface ScoreDetail {
  delta: number;
  reason: string;
  matched: Signal[];
}

const DEPRECATION_RE =
  /\b(deprecate[ds]?|deprecating|removed?|removing|breaking|will\s+stop|no\s+longer)\b/i;

const ADMIN_GQL_TAGS = new Set([
  "admin graphql api",
  "api",
]);
const EXTENSION_TAGS = new Set([
  "admin extensions",
  "checkout ui",
  "customer accounts",
  "pos extensions",
  "functions",
  "shop minis",
  "app bridge",
]);
const LIQUID_TAGS_RE = /\b(liquid|theme|storefront)\b/i;

export function matchEntries(
  entries: ChangelogEntry[],
  signals: Signal[],
  options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchResult[] {
  const results: MatchResult[] = [];
  const signalsByKind = groupByKind(signals);

  for (const entry of entries) {
    const { score, details } = scoreEntry(entry, signalsByKind);

    const severity = classifySeverity(entry);
    const include = entry.actionRequired
      ? true
      : score >= options.candidateThreshold;

    if (!include) continue;

    const matchedSignals = dedupeSignals(details.flatMap((d) => d.matched));
    const reasons = details
      .filter((d) => d.delta > 0)
      .map((d) => `${d.reason} (+${d.delta})`);

    const finalScore = entry.actionRequired
      ? Math.max(score, options.candidateThreshold)
      : score;

    results.push({
      entry,
      score: finalScore,
      matchedSignals,
      reasons,
      severity,
    });
  }

  return results.sort((a, b) => {
    const severityOrder: Record<Severity, number> = {
      action: 0,
      breaking: 1,
      feature: 2,
      info: 3,
    };
    const sev = severityOrder[a.severity] - severityOrder[b.severity];
    if (sev !== 0) return sev;
    const sc = b.score - a.score;
    if (sc !== 0) return sc;
    return (
      Date.parse(b.entry.publishedAt) - Date.parse(a.entry.publishedAt)
    );
  });
}

function scoreEntry(
  entry: ChangelogEntry,
  signalsByKind: Map<Signal["kind"], Signal[]>,
): { score: number; details: ScoreDetail[] } {
  const body = entry.body.toLowerCase();
  const titleAndBody = `${entry.title}\n${entry.body}`.toLowerCase();
  const tagsLc = entry.tags.map((t) => t.toLowerCase());
  const details: ScoreDetail[] = [];

  const apiVersionSignals = signalsByKind.get("api-version") ?? [];
  if (apiVersionSignals.length > 0 && entry.apiVersions.length > 0) {
    const matched = apiVersionSignals.filter((s) =>
      entry.apiVersions.some((v) => versionGte(v, s.value)),
    );
    if (matched.length > 0) {
      details.push({
        delta: 40,
        reason: `Entry targets API ${entry.apiVersions.join(", ")} and project pins ${matched.map((s) => s.value).join(", ")}`,
        matched,
      });
    }
  }

  const scopeSignals = signalsByKind.get("scope") ?? [];
  const matchedScopes = scopeSignals.filter((s) =>
    containsWord(body, s.value.toLowerCase()),
  );
  if (matchedScopes.length > 0) {
    details.push({
      delta: 30,
      reason: `Mentions scope(s) used by project: ${matchedScopes.map((s) => s.value).join(", ")}`,
      matched: matchedScopes,
    });
  }

  const targetSignals = signalsByKind.get("extension-target") ?? [];
  const matchedTargets = targetSignals.filter((s) =>
    body.includes(s.value.toLowerCase()),
  );
  if (matchedTargets.length > 0) {
    details.push({
      delta: 40,
      reason: `Mentions extension target(s) used by project: ${matchedTargets.map((s) => s.value).join(", ")}`,
      matched: matchedTargets,
    });
  }

  const packageSignals = signalsByKind.get("package") ?? [];
  const packagesNamesOnly = packageSignals.filter(
    (s) => !s.value.includes("@", 1),
  );
  const matchedPackages = packagesNamesOnly.filter((s) =>
    titleAndBody.includes(s.value.toLowerCase()),
  );
  if (matchedPackages.length > 0) {
    details.push({
      delta: 20,
      reason: `References @shopify package(s) in project: ${matchedPackages.map((s) => s.value).join(", ")}`,
      matched: matchedPackages,
    });
  }

  const filterSignals = signalsByKind.get("liquid-filter") ?? [];
  const matchedFilters = filterSignals.filter((s) =>
    bodyMentionsLiquidToken(titleAndBody, s.value),
  );
  if (matchedFilters.length > 0) {
    details.push({
      delta: 30,
      reason: `Mentions Liquid filter(s) used in theme: ${matchedFilters
        .slice(0, 5)
        .map((s) => s.value)
        .join(", ")}`,
      matched: matchedFilters,
    });
  }

  const tagSignals = signalsByKind.get("liquid-tag") ?? [];
  const matchedLiquidTags = tagSignals.filter((s) =>
    s.value.startsWith("metafield:")
      ? body.includes(s.value.replace("metafield:", "").toLowerCase())
      : bodyMentionsLiquidToken(titleAndBody, s.value),
  );
  if (matchedLiquidTags.length > 0) {
    details.push({
      delta: 20,
      reason: `Mentions Liquid construct(s) used in theme: ${matchedLiquidTags
        .slice(0, 5)
        .map((s) => s.value)
        .join(", ")}`,
      matched: matchedLiquidTags,
    });
  }

  const gqlOpSignals = signalsByKind.get("graphql-operation") ?? [];
  const matchedOps = gqlOpSignals.filter((s) =>
    containsWord(titleAndBody, s.value.toLowerCase()),
  );
  if (matchedOps.length > 0) {
    details.push({
      delta: 25,
      reason: `References GraphQL operation(s) used by project: ${matchedOps.map((s) => s.value).join(", ")}`,
      matched: matchedOps,
    });
  }

  // Tag-based affinity: if project uses Admin GraphQL / extensions / liquid and
  // the entry is in that category, surface it as contextual relevance.
  if (tagsLc.some((t) => ADMIN_GQL_TAGS.has(t))) {
    const hasGqlCode =
      (signalsByKind.get("graphql-operation") ?? []).length > 0 ||
      apiVersionSignals.length > 0;
    if (hasGqlCode) {
      details.push({
        delta: 15,
        reason: `Tagged as Admin GraphQL API and project uses Admin GraphQL`,
        matched: [],
      });
    }
  }
  if (tagsLc.some((t) => EXTENSION_TAGS.has(t))) {
    if ((signalsByKind.get("extension-target") ?? []).length > 0) {
      details.push({
        delta: 15,
        reason: `Tagged as extension-related and project ships extensions`,
        matched: [],
      });
    }
  }
  if (LIQUID_TAGS_RE.test(entry.title) || tagsLc.includes("themes")) {
    if (filterSignals.length > 0 || tagSignals.length > 0) {
      details.push({
        delta: 15,
        reason: `Theme-related entry and project is a theme`,
        matched: [],
      });
    }
  }

  if (entry.actionRequired) {
    details.push({
      delta: 20,
      reason: `Flagged as Action Required by Shopify`,
      matched: [],
    });
  }

  if (DEPRECATION_RE.test(entry.body) || DEPRECATION_RE.test(entry.title)) {
    details.push({
      delta: 15,
      reason: `Deprecation/removal keywords present`,
      matched: [],
    });
  }

  const score = details.reduce((s, d) => s + d.delta, 0);
  return { score: Math.min(score, 100), details };
}

function classifySeverity(entry: ChangelogEntry): Severity {
  if (entry.actionRequired) return "action";
  const titleLc = entry.title.toLowerCase();
  const bodyLc = entry.body.toLowerCase();
  const tagsLc = entry.tags.map((t) => t.toLowerCase());
  if (tagsLc.some((t) => t.includes("deprecat"))) return "breaking";
  if (DEPRECATION_RE.test(titleLc) || /\bremoved?\s+in\s+\d{4}-\d{2}/i.test(bodyLc)) {
    return "breaking";
  }
  if (tagsLc.includes("new") || titleLc.startsWith("add ")) {
    return "feature";
  }
  return "info";
}

function groupByKind(signals: Signal[]): Map<Signal["kind"], Signal[]> {
  const map = new Map<Signal["kind"], Signal[]>();
  for (const s of signals) {
    const arr = map.get(s.kind);
    if (arr) arr.push(s);
    else map.set(s.kind, [s]);
  }
  return map;
}

function dedupeSignals(signals: Signal[]): Signal[] {
  const seen = new Set<string>();
  const out: Signal[] = [];
  for (const s of signals) {
    const k = `${s.kind}::${s.value}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(haystack);
}

/**
 * Matches `needle` in `haystack` either inside backticks (``money``),
 * inside `{% ... %}` / `{{ ... }}` blocks, or after a pipe `|`.
 * Avoids false positives on common English words.
 */
function bodyMentionsLiquidToken(haystack: string, needle: string): boolean {
  if (!needle || needle.length < 3) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\`${escaped}\``, "i"),
    new RegExp(`\\|\\s*${escaped}\\b`, "i"),
    new RegExp(`\\{\\%\\s*${escaped}\\b`, "i"),
    new RegExp(`\\{\\{\\s*${escaped}\\b`, "i"),
  ];
  return patterns.some((re) => re.test(haystack));
}

function versionGte(a: string, b: string): boolean {
  const parseVer = (v: string): [number, number] => {
    const parts = v.split("-");
    const year = Number(parts[0] ?? 0);
    const month = Number(parts[1] ?? 0);
    return [year, month];
  };
  const [ay, am] = parseVer(a);
  const [by, bm] = parseVer(b);
  if (ay !== by) return ay >= by;
  return am >= bm;
}
