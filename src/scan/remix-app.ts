import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { globby } from "globby";
import { parse as parseToml } from "smol-toml";
import type { Signal } from "../types.js";

const SHOPIFY_APP_TOML_GLOBS = [
  "shopify.app.toml",
  "shopify.app.*.toml",
];
const SOURCE_GLOBS = [
  "app/**/*.{ts,tsx,js,jsx}",
  "src/**/*.{ts,tsx,js,jsx}",
  "server/**/*.{ts,tsx,js,jsx}",
];
const SOURCE_IGNORES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/.turbo/**",
  "**/.cache/**",
  "**/*.d.ts",
  "**/*.generated.*",
];

interface ShopifyAppToml {
  webhooks?: { api_version?: string };
  access_scopes?: { scopes?: string };
}

export async function scanRemixAppSignals(rootDir: string): Promise<Signal[]> {
  const signals: Signal[] = [];

  const tomlFiles = await globby(SHOPIFY_APP_TOML_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
  });
  for (const file of tomlFiles) {
    const parsed = await readToml(file);
    if (!parsed) continue;
    const source = relative(rootDir, file);
    const apiVersion = parsed.webhooks?.api_version?.trim();
    if (apiVersion) {
      signals.push({
        kind: "api-version",
        value: apiVersion,
        source,
        weight: 40,
      });
    }
    const scopesRaw = parsed.access_scopes?.scopes ?? "";
    for (const scope of splitScopes(scopesRaw)) {
      signals.push({
        kind: "scope",
        value: scope,
        source,
        weight: 30,
      });
    }
  }

  const graphqlOps = await extractGraphqlOperations(rootDir);
  for (const op of graphqlOps) {
    signals.push({
      kind: "graphql-operation",
      value: op.name,
      source: op.source,
      weight: 20,
    });
  }

  return signals;
}

async function readToml(path: string): Promise<ShopifyAppToml | null> {
  try {
    const raw = await readFile(path, "utf8");
    return parseToml(raw) as ShopifyAppToml;
  } catch {
    return null;
  }
}

function splitScopes(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

interface GraphqlOp {
  name: string;
  source: string;
}

const GRAPHQL_OP_RE =
  /#graphql\s*\n?\s*(?:query|mutation|subscription)\s+(\w+)/gi;

async function extractGraphqlOperations(rootDir: string): Promise<GraphqlOp[]> {
  const files = await globby(SOURCE_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: SOURCE_IGNORES,
  });
  const ops: GraphqlOp[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = await readFile(file, "utf8");
    } catch {
      continue;
    }
    if (!content.includes("#graphql")) continue;
    const source = relative(rootDir, file);
    GRAPHQL_OP_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = GRAPHQL_OP_RE.exec(content)) !== null) {
      const name = match[1];
      if (name) ops.push({ name, source });
    }
  }
  return ops;
}
