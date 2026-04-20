import type { CheckerConfig } from "./types.js";

export function defineConfig(config: CheckerConfig): CheckerConfig {
  return config;
}

export async function loadConsumerConfig(
  _cwd: string,
): Promise<CheckerConfig> {
  throw new Error(
    "loadConsumerConfig not implemented yet; will be wired up in M9",
  );
}
