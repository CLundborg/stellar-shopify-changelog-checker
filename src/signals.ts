import type { Signal } from "./types.js";

export function uniqueSignals(signals: Signal[]): Signal[] {
  const seen = new Map<string, Signal>();
  for (const s of signals) {
    const key = `${s.kind}::${s.value}`;
    const existing = seen.get(key);
    if (!existing || existing.weight < s.weight) {
      seen.set(key, s);
    }
  }
  return Array.from(seen.values());
}
