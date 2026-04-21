import { readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import type { CheckerConfig, ProjectType } from "./types.js";

export function defineConfig(config: CheckerConfig): CheckerConfig {
  return config;
}

const VALID_PROJECT_TYPES: ProjectType[] = [
  "theme",
  "remix-app",
  "extension-only",
];

export interface LoadConfigOverrides {
  projectType?: string;
  rootDir?: string;
  outputPath?: string;
  sinceDays?: number;
  llmEnabled?: boolean;
}

/**
 * Loads config from the consumer repo. Looks up (in order):
 *   1. CLI overrides
 *   2. "shopify-changelog-checker" key in <cwd>/package.json
 *
 * We intentionally don't support .ts config files yet to avoid pulling in a TS
 * loader (jiti/tsx) as a runtime dep. The package.json-key form is enough for
 * v0.1 and keeps consumer install footprint minimal.
 */
export async function loadConsumerConfig(
  cwd: string,
  overrides: LoadConfigOverrides = {},
): Promise<CheckerConfig> {
  const fromPkg = await readPackageJsonConfig(cwd);

  const projectTypeRaw = overrides.projectType ?? fromPkg?.projectType;
  if (!projectTypeRaw) {
    throw new ConfigError(
      `Missing projectType. Set "shopify-changelog-checker.projectType" in package.json or pass --project-type. ` +
        `Valid values: ${VALID_PROJECT_TYPES.join(", ")}.`,
    );
  }
  if (!VALID_PROJECT_TYPES.includes(projectTypeRaw as ProjectType)) {
    throw new ConfigError(
      `Invalid projectType "${projectTypeRaw}". Valid values: ${VALID_PROJECT_TYPES.join(", ")}.`,
    );
  }
  const projectType = projectTypeRaw as ProjectType;

  const rootDirRaw = overrides.rootDir ?? fromPkg?.rootDir ?? ".";
  const rootDir = resolve(cwd, rootDirRaw);

  const outputPathRaw =
    overrides.outputPath ?? fromPkg?.outputPath ?? "CHANGELOG_IMPACT.md";
  const outputPath = resolve(cwd, outputPathRaw);

  const sinceDays =
    overrides.sinceDays ?? (typeof fromPkg?.sinceDays === "number" ? fromPkg.sinceDays : 30);

  const llmEnabled =
    overrides.llmEnabled ??
    (typeof fromPkg?.llm?.enabled === "boolean"
      ? fromPkg.llm.enabled
      : undefined);

  return {
    projectType,
    rootDir,
    outputPath,
    sinceDays,
    llm: {
      enabled: llmEnabled,
      provider: fromPkg?.llm?.provider ?? "anthropic",
      model: fromPkg?.llm?.model,
    },
  };
}

export function guessRepoName(cwd: string): string {
  return basename(resolve(cwd));
}

interface PartialConfig {
  projectType?: string;
  rootDir?: string;
  outputPath?: string;
  sinceDays?: number;
  llm?: {
    enabled?: boolean;
    provider?: "anthropic";
    model?: string;
  };
}

async function readPackageJsonConfig(
  cwd: string,
): Promise<PartialConfig | null> {
  const path = join(cwd, "package.json");
  try {
    const raw = await readFile(path, "utf8");
    const pkg = JSON.parse(raw) as {
      "shopify-changelog-checker"?: PartialConfig;
    };
    return pkg["shopify-changelog-checker"] ?? null;
  } catch {
    return null;
  }
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}
