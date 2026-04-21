import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { globby } from "globby";
import type { Signal } from "../types.js";

const LIQUID_GLOBS = ["**/*.liquid"];
const LIQUID_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.shopify/**",
  "**/.git/**",
];

// `| filter_name` — captures filter names after a pipe. Excludes digits so
// things like `| money` match but `| 5` doesn't.
const FILTER_RE = /\|\s*([a-z_][a-z0-9_]*)/gi;
// `{% tag_name` at the start of a Liquid tag (assign, render, form, paginate, ...)
const TAG_RE = /\{%-?\s*([a-z_][a-z0-9_]*)/gi;
// `.metafields.<namespace>.<key>` — captures namespace + key pairs.
const METAFIELD_RE =
  /\.metafields\.([a-z_][a-z0-9_-]*)\.([a-z_][a-z0-9_-]*)/gi;

// Liquid built-in reserved words we don't want to surface as "signals" since
// every theme uses them and they'd drown the report.
const TRIVIAL_TAGS = new Set([
  "if",
  "unless",
  "else",
  "elsif",
  "endif",
  "endunless",
  "for",
  "endfor",
  "case",
  "when",
  "endcase",
  "assign",
  "capture",
  "endcapture",
  "comment",
  "endcomment",
  "break",
  "continue",
  "liquid",
  "echo",
]);

const TRIVIAL_FILTERS = new Set([
  "default",
  "upcase",
  "downcase",
  "capitalize",
  "size",
  "strip",
  "strip_html",
  "escape",
  "append",
  "prepend",
  "replace",
  "replace_first",
  "remove",
  "remove_first",
  "split",
  "join",
  "first",
  "last",
  "plus",
  "minus",
  "times",
  "divided_by",
  "modulo",
  "round",
  "ceil",
  "floor",
  "truncate",
  "truncatewords",
  "slice",
  "reverse",
  "sort",
  "uniq",
  "where",
  "map",
  "compact",
  "concat",
  "json",
  "date",
]);

export async function scanThemeSignals(rootDir: string): Promise<Signal[]> {
  const files = await globby(LIQUID_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: LIQUID_IGNORES,
  });

  const filterCounts = new Map<string, { count: number; source: string }>();
  const tagCounts = new Map<string, { count: number; source: string }>();
  const metafields = new Map<string, { source: string }>();

  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const source = relative(rootDir, file);

    bump(filterCounts, content, FILTER_RE, source, TRIVIAL_FILTERS);
    bump(tagCounts, content, TAG_RE, source, TRIVIAL_TAGS);

    METAFIELD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = METAFIELD_RE.exec(content)) !== null) {
      const ns = m[1];
      const key = m[2];
      if (!ns || !key) continue;
      const value = `${ns}.${key}`;
      if (!metafields.has(value)) {
        metafields.set(value, { source });
      }
    }
  }

  const signals: Signal[] = [];

  for (const [name, { source }] of filterCounts) {
    signals.push({
      kind: "liquid-filter",
      value: name,
      source,
      weight: 30,
    });
  }
  for (const [name, { source }] of tagCounts) {
    signals.push({
      kind: "liquid-tag",
      value: name,
      source,
      weight: 20,
    });
  }
  for (const [value, { source }] of metafields) {
    signals.push({
      kind: "liquid-tag",
      value: `metafield:${value}`,
      source,
      weight: 15,
    });
  }

  return signals;
}

function bump(
  bucket: Map<string, { count: number; source: string }>,
  content: string,
  re: RegExp,
  source: string,
  skip: ReadonlySet<string>,
): void {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const name = m[1]?.toLowerCase();
    if (!name || skip.has(name)) continue;
    const entry = bucket.get(name);
    if (entry) {
      entry.count += 1;
    } else {
      bucket.set(name, { count: 1, source });
    }
  }
}
