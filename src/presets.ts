import type { WorkspaceConfig } from "./types.js";

export type PresetName = "stellar" | "fiskars";

/**
 * Returns a workspace config for a built-in preset, resolved against the
 * given `workspaceRoot`. Project `rootDir`s in the returned config are kept
 * relative to the workspace root so the runner can join them itself.
 */
export function getPreset(
  name: PresetName,
  options: { outputDir?: string; combinedOutput?: string; sinceDays?: number } = {},
): WorkspaceConfig {
  switch (name) {
    case "stellar":
      return stellarPreset(options);
    case "fiskars":
      return fiskarsPreset(options);
    default: {
      const _exhaustive: never = name;
      void _exhaustive;
      throw new Error(`Unknown preset: ${name as string}`);
    }
  }
}

function stellarPreset(options: {
  outputDir?: string;
  combinedOutput?: string;
  sinceDays?: number;
}): WorkspaceConfig {
  return {
    sinceDays: options.sinceDays ?? 30,
    outputDir: options.outputDir ?? "changelog-reports",
    combinedOutput: options.combinedOutput ?? "CHANGELOG_IMPACT.md",
    projects: [
      {
        name: "stellar-shopify",
        rootDir: "stellar-shopify",
        projectType: "theme",
      },
      {
        name: "stellar-app-wishlist",
        rootDir: "stellar-app-wishlist",
        projectType: "remix-app",
      },
      {
        name: "stellar-shopify-app-gift-purchase-discount",
        rootDir: "stellar-shopify-app-gift-purchase-discount",
        projectType: "remix-app",
      },
      {
        name: "stellar-shopify-app-print-invoice",
        rootDir: "stellar-shopify-app-print-invoice",
        projectType: "remix-app",
      },
      {
        name: "stellar-shopify-app-base-ui-extensions",
        rootDir: "stellar-shopify-app-base-ui-extensions",
        projectType: "remix-app",
      },
      {
        name: "stellar-shopify-app-bloomreach-enhancements",
        rootDir: "stellar-shopify-app-bloomreach-enhancements",
        projectType: "remix-app",
      },
      {
        name: "stellar-shopify-app-salesforce-notification",
        rootDir: "stellar-shopify-app-salesforce-notification",
        projectType: "remix-app",
      },
    ],
  };
}

/**
 * The Fiskars Shopify workspace: same project list as `stellar`, but with
 * output paths scoped under `fiskars-shopify-workspace/` so reports don't
 * clutter the workspace root (e.g. `~/Projects/`).
 */
function fiskarsPreset(options: {
  outputDir?: string;
  combinedOutput?: string;
  sinceDays?: number;
}): WorkspaceConfig {
  const base = stellarPreset(options);
  return {
    ...base,
    outputDir:
      options.outputDir ?? "fiskars-shopify-workspace/changelog-reports",
    combinedOutput:
      options.combinedOutput ??
      "fiskars-shopify-workspace/CHANGELOG_IMPACT.md",
    cacheDir: "fiskars-shopify-workspace/.changelog-cache",
  };
}

export const PRESET_NAMES: readonly PresetName[] = ["stellar", "fiskars"];
