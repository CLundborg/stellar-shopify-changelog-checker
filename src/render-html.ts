import type {
  ChangelogEntry,
  MatchResult,
  Severity,
  WorkspaceProjectResult,
  WorkspaceRunResult,
} from "./types.js";

interface AggregatedEntry {
  entry: ChangelogEntry;
  /** Per-project records that matched this entry */
  hits: Array<{
    project: string;
    match: MatchResult;
  }>;
  worstSeverity: Severity;
}

const SEVERITY_ORDER: Record<Severity, number> = {
  action: 0,
  breaking: 1,
  feature: 2,
  info: 3,
};

const SEVERITY_LABEL: Record<Severity, string> = {
  action: "Action Required",
  breaking: "Breaking / Deprecation",
  feature: "New capability",
  info: "Informational",
};

export function renderHtmlDashboard(run: WorkspaceRunResult): string {
  const aggregated = aggregate(run);
  const totals = totalCountsAcross(run);
  const projectCounts = run.results.map((r) => ({
    name: r.spec.name,
    counts: countsBySeverity(r.matches),
    total: r.matches.length,
    error: r.error,
  }));

  const dataJson = JSON.stringify({
    generatedAt: run.generatedAt.toISOString(),
    sinceDate: run.sinceDate.toISOString(),
    usedLlm: run.usedLlm,
    feedUrl: run.feedUrl,
    totalEntries: run.totalEntries,
    projects: projectCounts,
    entries: aggregated.map((a) => ({
      id: a.entry.id,
      title: a.entry.title,
      link: a.entry.link,
      publishedAt: a.entry.publishedAt,
      tags: a.entry.tags,
      apiVersions: a.entry.apiVersions,
      actionRequired: a.entry.actionRequired,
      body: a.entry.body,
      severity: a.worstSeverity,
      hits: a.hits.map((h) => ({
        project: h.project,
        severity: h.match.severity,
        score: h.match.score,
        reasons: h.match.reasons,
        matchedSignals: h.match.matchedSignals.map((s) => ({
          kind: s.kind,
          value: s.value,
        })),
        llm: h.match.llmAssessed
          ? {
              impacts: h.match.llmAssessed.impacts,
              severity: h.match.llmAssessed.severity,
              reason: h.match.llmAssessed.reason,
            }
          : null,
      })),
    })),
    totals,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Shopify Changelog Impact — Fiskars Workspace</title>
<style>${CSS}</style>
</head>
<body>
<header class="top">
  <div class="wrap">
    <h1>Shopify Changelog Impact</h1>
    <p class="meta">
      <span>Generated <strong>${fmtDate(run.generatedAt)}</strong></span>
      <span>·</span>
      <span>Window since <strong>${fmtDate(run.sinceDate)}</strong></span>
      <span>·</span>
      <span><strong>${run.totalEntries}</strong> entries scanned</span>
      <span>·</span>
      <span>LLM re-rank ${run.usedLlm ? "<strong>on</strong>" : "<strong>off</strong>"}</span>
      <span>·</span>
      <a href="${escapeHtml(run.feedUrl)}" target="_blank" rel="noopener">feed ↗</a>
    </p>

    <div class="totals">
      ${totalBadge("action", totals.action, "Action Required")}
      ${totalBadge("breaking", totals.breaking, "Breaking / Deprecation")}
      ${totalBadge("feature", totals.feature, "New capabilities")}
      ${totalBadge("info", totals.info, "Informational")}
      <div class="total-unique">${aggregated.length} unique entries</div>
    </div>
  </div>
</header>

<section class="wrap filters">
  <div class="filter-group">
    <span class="filter-label">Severity:</span>
    <button class="chip chip-sev" data-sev="all" aria-pressed="true">All</button>
    <button class="chip chip-sev sev-action" data-sev="action">Action</button>
    <button class="chip chip-sev sev-breaking" data-sev="breaking">Breaking</button>
    <button class="chip chip-sev sev-feature" data-sev="feature">Feature</button>
    <button class="chip chip-sev sev-info" data-sev="info">Info</button>
  </div>
  <div class="filter-group">
    <span class="filter-label">Project:</span>
    <button class="chip chip-proj" data-proj="all" aria-pressed="true">All</button>
    ${projectCounts
      .map(
        (p) =>
          `<button class="chip chip-proj" data-proj="${escapeHtml(p.name)}" title="${p.total} match${p.total === 1 ? "" : "es"}">${escapeHtml(shortenProjectName(p.name))}<span class="chip-count">${p.total}</span></button>`,
      )
      .join("")}
  </div>
  <div class="filter-group">
    <input type="search" id="search" placeholder="Search title, body, tag…" />
  </div>
</section>

<section class="wrap project-grid">
  <h2 class="section-title">Per-project summary</h2>
  <div class="grid">
    ${projectCounts
      .map((p) =>
        p.error
          ? `<div class="proj proj-error"><div class="proj-name">${escapeHtml(p.name)}</div><div class="proj-error-msg">${escapeHtml(p.error)}</div></div>`
          : `<div class="proj" data-proj="${escapeHtml(p.name)}">
               <div class="proj-name">${escapeHtml(p.name)}</div>
               <div class="proj-total">${p.total}</div>
               <div class="proj-counts">
                 <span class="mini-badge sev-action" title="Action Required">${p.counts.action}</span>
                 <span class="mini-badge sev-breaking" title="Breaking">${p.counts.breaking}</span>
                 <span class="mini-badge sev-feature" title="Feature">${p.counts.feature}</span>
                 <span class="mini-badge sev-info" title="Info">${p.counts.info}</span>
               </div>
             </div>`,
      )
      .join("")}
  </div>
</section>

<main class="wrap" id="entries"></main>

<footer class="wrap footer">
  <p>Data from <a href="${escapeHtml(run.feedUrl)}" target="_blank" rel="noopener">${escapeHtml(run.feedUrl)}</a>. Re-run the checker for updates.</p>
</footer>

<script id="__data__" type="application/json">${dataJson.replace(/</g, "\\u003c")}</script>
<script>${JS}</script>
</body>
</html>
`;
}

function aggregate(run: WorkspaceRunResult): AggregatedEntry[] {
  const byKey = new Map<string, AggregatedEntry>();
  for (const r of run.results) {
    for (const m of r.matches) {
      const key = m.entry.id || m.entry.link || m.entry.title;
      let agg = byKey.get(key);
      if (!agg) {
        agg = { entry: m.entry, hits: [], worstSeverity: m.severity };
        byKey.set(key, agg);
      }
      agg.hits.push({ project: r.spec.name, match: m });
      if (SEVERITY_ORDER[m.severity] < SEVERITY_ORDER[agg.worstSeverity]) {
        agg.worstSeverity = m.severity;
      }
    }
  }
  return [...byKey.values()].sort((a, b) => {
    const sevDelta =
      SEVERITY_ORDER[a.worstSeverity] - SEVERITY_ORDER[b.worstSeverity];
    if (sevDelta !== 0) return sevDelta;
    return (
      Date.parse(b.entry.publishedAt) - Date.parse(a.entry.publishedAt)
    );
  });
}

function totalCountsAcross(run: WorkspaceRunResult): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    action: 0,
    breaking: 0,
    feature: 0,
    info: 0,
  };
  const seen = new Set<string>();
  for (const r of run.results) {
    for (const m of r.matches) {
      const key = (m.entry.id || m.entry.link || m.entry.title) + "|" + m.severity;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[m.severity] += 1;
    }
  }
  return counts;
}

function countsBySeverity(
  matches: WorkspaceProjectResult["matches"],
): Record<Severity, number> {
  const c: Record<Severity, number> = {
    action: 0,
    breaking: 0,
    feature: 0,
    info: 0,
  };
  for (const m of matches) c[m.severity] += 1;
  return c;
}

function totalBadge(sev: Severity, count: number, label: string): string {
  return `<div class="total sev-${sev}">
    <div class="total-count">${count}</div>
    <div class="total-label">${escapeHtml(label)}</div>
  </div>`;
}

function shortenProjectName(name: string): string {
  return name.replace(/^stellar-shopify-app-/, "").replace(/^stellar-app-/, "");
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const CSS = `
:root {
  color-scheme: light dark;
  --bg: #f7f8fa;
  --surface: #fff;
  --surface-alt: #f0f2f5;
  --border: #e3e6eb;
  --text: #1c1f24;
  --text-muted: #60646c;
  --accent: #2563eb;
  --shadow: 0 1px 2px rgba(0,0,0,.04), 0 4px 12px rgba(0,0,0,.04);

  --sev-action-bg: #fef2f2;
  --sev-action-fg: #991b1b;
  --sev-action-accent: #dc2626;

  --sev-breaking-bg: #fff7ed;
  --sev-breaking-fg: #9a3412;
  --sev-breaking-accent: #ea580c;

  --sev-feature-bg: #ecfdf5;
  --sev-feature-fg: #065f46;
  --sev-feature-accent: #059669;

  --sev-info-bg: #eff6ff;
  --sev-info-fg: #1e3a8a;
  --sev-info-accent: #2563eb;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1014;
    --surface: #151820;
    --surface-alt: #1c2028;
    --border: #242832;
    --text: #e6e7ea;
    --text-muted: #8b909a;

    --sev-action-bg: #2a1515;
    --sev-action-fg: #fca5a5;
    --sev-action-accent: #ef4444;

    --sev-breaking-bg: #2a1d14;
    --sev-breaking-fg: #fdba74;
    --sev-breaking-accent: #f97316;

    --sev-feature-bg: #102820;
    --sev-feature-fg: #86efac;
    --sev-feature-accent: #10b981;

    --sev-info-bg: #151f38;
    --sev-info-fg: #93c5fd;
    --sev-info-accent: #3b82f6;
  }
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 1100px; margin: 0 auto; padding: 0 20px; }
.top { background: var(--surface); border-bottom: 1px solid var(--border); padding: 24px 0 20px; }
.top h1 { margin: 0 0 8px; font-size: 20px; font-weight: 600; }
.meta { color: var(--text-muted); margin: 0 0 18px; font-size: 13px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.meta a { color: var(--accent); text-decoration: none; }
.meta a:hover { text-decoration: underline; }

.totals { display: flex; gap: 10px; flex-wrap: wrap; align-items: stretch; }
.total { flex: 1 1 140px; padding: 12px 14px; border-radius: 8px; background: var(--surface-alt); border: 1px solid var(--border); }
.total.sev-action { background: var(--sev-action-bg); border-color: var(--sev-action-accent); }
.total.sev-breaking { background: var(--sev-breaking-bg); border-color: var(--sev-breaking-accent); }
.total.sev-feature { background: var(--sev-feature-bg); border-color: var(--sev-feature-accent); }
.total.sev-info { background: var(--sev-info-bg); border-color: var(--sev-info-accent); }
.total-count { font-size: 22px; font-weight: 700; line-height: 1; }
.total-label { font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.sev-action .total-count { color: var(--sev-action-fg); }
.sev-breaking .total-count { color: var(--sev-breaking-fg); }
.sev-feature .total-count { color: var(--sev-feature-fg); }
.sev-info .total-count { color: var(--sev-info-fg); }
.total-unique { flex: 0 0 auto; align-self: center; color: var(--text-muted); font-size: 12px; padding: 8px 12px; border-left: 1px solid var(--border); margin-left: 8px; }

.filters { padding: 16px 20px; display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
.filter-group { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.filter-label { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; margin-right: 4px; }
.chip {
  font: inherit; font-size: 12px;
  padding: 5px 10px; border-radius: 999px;
  background: var(--surface); color: var(--text);
  border: 1px solid var(--border); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
}
.chip:hover { background: var(--surface-alt); }
.chip[aria-pressed="true"] { background: var(--accent); color: #fff; border-color: var(--accent); }
.chip-sev.sev-action[aria-pressed="true"] { background: var(--sev-action-accent); border-color: var(--sev-action-accent); }
.chip-sev.sev-breaking[aria-pressed="true"] { background: var(--sev-breaking-accent); border-color: var(--sev-breaking-accent); }
.chip-sev.sev-feature[aria-pressed="true"] { background: var(--sev-feature-accent); border-color: var(--sev-feature-accent); }
.chip-sev.sev-info[aria-pressed="true"] { background: var(--sev-info-accent); border-color: var(--sev-info-accent); }
.chip-count { font-size: 10px; background: rgba(0,0,0,.1); padding: 1px 6px; border-radius: 999px; }
@media (prefers-color-scheme: dark) { .chip-count { background: rgba(255,255,255,.1); } }

input[type="search"] {
  font: inherit; font-size: 13px;
  padding: 6px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--text);
  min-width: 220px;
}

.project-grid { padding: 8px 20px 4px; }
.section-title { font-size: 14px; font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .04em; margin: 16px 0 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; }
.proj { padding: 12px; background: var(--surface); border: 1px solid var(--border); border-radius: 8px; }
.proj-name { font-size: 12px; font-weight: 500; color: var(--text-muted); word-break: break-all; margin-bottom: 4px; }
.proj-total { font-size: 20px; font-weight: 700; }
.proj-counts { display: flex; gap: 4px; margin-top: 6px; }
.mini-badge { font-size: 11px; padding: 1px 6px; border-radius: 4px; }
.mini-badge.sev-action { background: var(--sev-action-bg); color: var(--sev-action-fg); }
.mini-badge.sev-breaking { background: var(--sev-breaking-bg); color: var(--sev-breaking-fg); }
.mini-badge.sev-feature { background: var(--sev-feature-bg); color: var(--sev-feature-fg); }
.mini-badge.sev-info { background: var(--sev-info-bg); color: var(--sev-info-fg); }
.proj-error { padding: 12px; background: var(--sev-action-bg); border: 1px solid var(--sev-action-accent); border-radius: 8px; }
.proj-error-msg { font-size: 11px; color: var(--sev-action-fg); margin-top: 4px; }

#entries { padding: 8px 20px 40px; }

.entry {
  background: var(--surface); border: 1px solid var(--border);
  border-radius: 10px; padding: 14px 16px; margin: 10px 0;
  box-shadow: var(--shadow);
}
.entry.sev-action { border-left: 4px solid var(--sev-action-accent); }
.entry.sev-breaking { border-left: 4px solid var(--sev-breaking-accent); }
.entry.sev-feature { border-left: 4px solid var(--sev-feature-accent); }
.entry.sev-info { border-left: 4px solid var(--sev-info-accent); }
.entry-head { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
.sev-badge {
  font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em;
  padding: 3px 8px; border-radius: 4px;
}
.sev-badge.sev-action { background: var(--sev-action-bg); color: var(--sev-action-fg); }
.sev-badge.sev-breaking { background: var(--sev-breaking-bg); color: var(--sev-breaking-fg); }
.sev-badge.sev-feature { background: var(--sev-feature-bg); color: var(--sev-feature-fg); }
.sev-badge.sev-info { background: var(--sev-info-bg); color: var(--sev-info-fg); }
.entry-date { font-size: 12px; color: var(--text-muted); }
.entry-title { font-size: 15px; font-weight: 600; flex: 1 1 280px; }
.entry-title a { color: var(--text); text-decoration: none; }
.entry-title a:hover { color: var(--accent); text-decoration: underline; }
.entry-projects { display: flex; gap: 4px; flex-wrap: wrap; margin: 8px 0 6px; }
.project-tag { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }
.entry-body { color: var(--text-muted); font-size: 13px; margin: 6px 0; }
.entry-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 8px; }
.tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--surface-alt); color: var(--text-muted); border: 1px solid var(--border); }
.api-tag { background: var(--sev-info-bg); color: var(--sev-info-fg); border-color: transparent; }

details.entry-detail { margin-top: 8px; font-size: 12px; }
details.entry-detail summary { cursor: pointer; color: var(--text-muted); font-weight: 500; list-style: none; padding: 4px 0; }
details.entry-detail summary::-webkit-details-marker { display: none; }
details.entry-detail summary::before { content: "▸"; display: inline-block; margin-right: 6px; transition: transform .15s; }
details.entry-detail[open] summary::before { transform: rotate(90deg); }
.detail-grid { display: grid; grid-template-columns: 1fr; gap: 12px; padding: 8px 0 4px 18px; }
.detail-proj { border-left: 2px solid var(--border); padding-left: 10px; }
.detail-proj-name { font-weight: 600; font-size: 12px; margin-bottom: 4px; }
.detail-proj-score { color: var(--text-muted); font-weight: 400; font-size: 11px; margin-left: 6px; }
.detail-reasons { list-style: none; padding: 0; margin: 2px 0 4px; }
.detail-reasons li { padding: 2px 0; color: var(--text-muted); }
.detail-reasons li::before { content: "+"; color: var(--accent); margin-right: 6px; }
.detail-signals { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.signal-tag { font-size: 10px; padding: 1px 6px; border-radius: 4px; background: var(--sev-feature-bg); color: var(--sev-feature-fg); border: 1px solid transparent; }
.detail-llm { margin-top: 6px; padding: 6px 8px; background: var(--surface-alt); border-radius: 4px; font-size: 11px; color: var(--text-muted); }
.detail-llm strong { color: var(--text); }

.empty {
  padding: 40px; text-align: center; color: var(--text-muted);
  background: var(--surface); border: 1px dashed var(--border); border-radius: 10px;
}
.footer { padding: 16px 20px 32px; color: var(--text-muted); font-size: 12px; }
.footer a { color: var(--accent); }
`;

const JS = `
(function(){
  const dataEl = document.getElementById("__data__");
  const data = JSON.parse(dataEl.textContent);
  const container = document.getElementById("entries");
  const state = { severity: "all", project: "all", search: "" };

  function escapeHtml(s){return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
  function fmt(d){return new Date(d).toISOString().slice(0,10);}
  function shortenProj(n){return n.replace(/^stellar-shopify-app-/,"").replace(/^stellar-app-/,"");}

  function matches(e) {
    if (state.severity !== "all" && e.severity !== state.severity) return false;
    if (state.project !== "all" && !e.hits.some(h => h.project === state.project)) return false;
    if (state.search) {
      const q = state.search.toLowerCase();
      const hay = (e.title + " " + e.body + " " + e.tags.join(" ") + " " + e.hits.map(h=>h.project).join(" ")).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }

  function render() {
    const filtered = data.entries.filter(matches);
    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty">No entries match the current filters.</div>';
      return;
    }
    container.innerHTML = filtered.map(renderEntry).join("");
  }

  function renderEntry(e) {
    const hitsFiltered = state.project === "all" ? e.hits : e.hits.filter(h => h.project === state.project);
    const bodyExcerpt = (e.body || "").slice(0, 280);
    return (
      '<article class="entry sev-' + e.severity + '">' +
        '<div class="entry-head">' +
          '<span class="sev-badge sev-' + e.severity + '">' + escapeHtml(sevLabel(e.severity)) + '</span>' +
          '<span class="entry-date">' + fmt(e.publishedAt) + '</span>' +
          '<h3 class="entry-title"><a href="' + escapeHtml(e.link) + '" target="_blank" rel="noopener">' + escapeHtml(e.title) + ' ↗</a></h3>' +
        '</div>' +
        '<div class="entry-projects">' +
          e.hits.map(h => '<span class="project-tag" title="' + escapeHtml(h.project) + '">' + escapeHtml(shortenProj(h.project)) + '</span>').join("") +
        '</div>' +
        (bodyExcerpt ? '<p class="entry-body">' + escapeHtml(bodyExcerpt) + (e.body.length > 280 ? "…" : "") + '</p>' : "") +
        '<div class="entry-tags">' +
          e.apiVersions.map(v => '<span class="tag api-tag">API ' + escapeHtml(v) + '</span>').join("") +
          e.tags.map(t => '<span class="tag">' + escapeHtml(t) + '</span>').join("") +
        '</div>' +
        '<details class="entry-detail"><summary>Why it matched (' + hitsFiltered.length + ' project' + (hitsFiltered.length === 1 ? "" : "s") + ')</summary>' +
          '<div class="detail-grid">' +
            hitsFiltered.map(renderHit).join("") +
          '</div>' +
        '</details>' +
      '</article>'
    );
  }

  function renderHit(h) {
    return (
      '<div class="detail-proj">' +
        '<div class="detail-proj-name">' + escapeHtml(h.project) + '<span class="detail-proj-score">score ' + h.score + '/100</span></div>' +
        '<ul class="detail-reasons">' + h.reasons.map(r => '<li>' + escapeHtml(r) + '</li>').join("") + '</ul>' +
        (h.matchedSignals.length ? '<div class="detail-signals">' + h.matchedSignals.map(s => '<span class="signal-tag">' + escapeHtml(s.kind) + ': ' + escapeHtml(s.value) + '</span>').join("") + '</div>' : "") +
        (h.llm ? '<div class="detail-llm"><strong>LLM:</strong> ' + (h.llm.impacts ? "impacts" : "skipped") + ' — ' + escapeHtml(h.llm.reason) + '</div>' : "") +
      '</div>'
    );
  }

  function sevLabel(s) {
    return { action: "Action Required", breaking: "Breaking", feature: "Feature", info: "Info" }[s] || s;
  }

  function bindChips(selector, key) {
    document.querySelectorAll(selector).forEach(btn => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(selector).forEach(b => b.setAttribute("aria-pressed", "false"));
        btn.setAttribute("aria-pressed", "true");
        state[key] = btn.getAttribute("data-" + (key === "severity" ? "sev" : "proj"));
        render();
      });
    });
  }

  bindChips(".chip-sev", "severity");
  bindChips(".chip-proj", "project");

  const searchEl = document.getElementById("search");
  let timer;
  searchEl.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = searchEl.value.trim();
      render();
    }, 150);
  });

  document.querySelectorAll(".proj[data-proj]").forEach(el => {
    el.addEventListener("click", () => {
      const name = el.getAttribute("data-proj");
      const btn = document.querySelector('.chip-proj[data-proj="' + CSS.escape(name) + '"]');
      if (btn) btn.click();
    });
  });

  render();
})();
`;
