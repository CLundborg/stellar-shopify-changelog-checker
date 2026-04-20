import type { CheckerConfig, Signal } from "../types.js";

export async function scanProject(_config: CheckerConfig): Promise<Signal[]> {
  throw new Error(
    "scanProject dispatch not implemented yet; wires up in M3-M6",
  );
}
