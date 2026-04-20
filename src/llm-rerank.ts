import type { MatchResult, Signal } from "./types.js";

export interface LlmRerankOptions {
  apiKey?: string;
  model?: string;
}

export async function llmRerank(
  matches: MatchResult[],
  _signals: Signal[],
  options: LlmRerankOptions,
): Promise<MatchResult[]> {
  if (!options.apiKey) {
    return matches;
  }
  throw new Error("llmRerank not implemented yet; lands in M8");
}
