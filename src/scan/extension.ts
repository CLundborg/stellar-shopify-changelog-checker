import { readFile } from "node:fs/promises";
import { relative } from "node:path";
import { globby } from "globby";
import { parse as parseToml } from "smol-toml";
import type { Signal } from "../types.js";

const EXTENSION_TOML_GLOBS = [
  "extensions/**/shopify.extension.toml",
  "shopify.extension.toml",
];

interface ShopifyExtensionToml {
  api_version?: string;
  extensions?: Array<{
    type?: string;
    name?: string;
    handle?: string;
    targeting?: Array<{ target?: string; module?: string }>;
  }>;
}

export async function scanExtensionSignals(
  rootDir: string,
): Promise<Signal[]> {
  const files = await globby(EXTENSION_TOML_GLOBS, {
    cwd: rootDir,
    absolute: true,
    onlyFiles: true,
    ignore: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  });

  const signals: Signal[] = [];
  for (const file of files) {
    const parsed = await readToml(file);
    if (!parsed) continue;
    const source = relative(rootDir, file);

    if (parsed.api_version) {
      signals.push({
        kind: "api-version",
        value: parsed.api_version.trim(),
        source,
        weight: 40,
      });
    }

    for (const ext of parsed.extensions ?? []) {
      for (const t of ext.targeting ?? []) {
        const target = t.target?.trim();
        if (!target) continue;
        signals.push({
          kind: "extension-target",
          value: target,
          source,
          weight: 40,
        });
      }
    }
  }

  return signals;
}

async function readToml(path: string): Promise<ShopifyExtensionToml | null> {
  try {
    const raw = await readFile(path, "utf8");
    return parseToml(raw) as ShopifyExtensionToml;
  } catch {
    return null;
  }
}
