import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type { Signal } from "../types.js";

interface PackageJsonShape {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const DEP_BUCKETS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const satisfies ReadonlyArray<keyof PackageJsonShape>;

/**
 * Scans the consumer's package.json and produces signals for every @shopify/*
 * dependency and a coarse "shopify-cli-version" signal when the Shopify CLI
 * is pinned via @shopify/cli or shopify.
 */
export async function scanSharedSignals(rootDir: string): Promise<Signal[]> {
  const pkgPath = join(rootDir, "package.json");
  const pkg = await readPackageJson(pkgPath);
  if (!pkg) return [];

  const source = relative(rootDir, pkgPath) || "package.json";
  const signals: Signal[] = [];

  for (const bucket of DEP_BUCKETS) {
    const deps = pkg[bucket];
    if (!deps) continue;
    for (const [name, rawVersion] of Object.entries(deps)) {
      if (!name.startsWith("@shopify/")) continue;
      signals.push({
        kind: "package",
        value: name,
        source,
        weight: 20,
      });
      const version = coerceVersion(rawVersion);
      if (version) {
        signals.push({
          kind: "package",
          value: `${name}@${version}`,
          source,
          weight: 15,
        });
      }
    }
  }

  const cliVersion = detectShopifyCliVersion(pkg);
  if (cliVersion) {
    signals.push({
      kind: "theme-cli-version",
      value: cliVersion,
      source,
      weight: 10,
    });
  }

  return signals;
}

async function readPackageJson(
  path: string,
): Promise<PackageJsonShape | null> {
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as PackageJsonShape;
  } catch {
    return null;
  }
}

function coerceVersion(raw: string): string | null {
  const trimmed = raw.trim();
  const match = trimmed.match(/\d+\.\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function detectShopifyCliVersion(pkg: PackageJsonShape): string | null {
  for (const bucket of DEP_BUCKETS) {
    const deps = pkg[bucket];
    if (!deps) continue;
    const raw = deps["@shopify/cli"] ?? deps["shopify"];
    if (raw) return coerceVersion(raw) ?? raw.trim();
  }
  return null;
}
