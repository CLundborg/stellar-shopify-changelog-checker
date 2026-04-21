import type { CheckerConfig, Signal } from "../types.js";
import { uniqueSignals } from "../signals.js";
import { scanSharedSignals } from "./shared.js";
import { scanThemeSignals } from "./theme.js";
import { scanRemixAppSignals } from "./remix-app.js";
import { scanExtensionSignals } from "./extension.js";

export async function scanProject(config: CheckerConfig): Promise<Signal[]> {
  const collected: Signal[][] = [];

  collected.push(await scanSharedSignals(config.rootDir));

  switch (config.projectType) {
    case "theme":
      collected.push(await scanThemeSignals(config.rootDir));
      break;
    case "remix-app":
      collected.push(await scanRemixAppSignals(config.rootDir));
      collected.push(await scanExtensionSignals(config.rootDir));
      break;
    case "extension-only":
      collected.push(await scanExtensionSignals(config.rootDir));
      break;
    default: {
      const _exhaustive: never = config.projectType;
      void _exhaustive;
    }
  }

  return uniqueSignals(collected.flat());
}
