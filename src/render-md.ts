import type { MatchResult } from "./types.js";

export interface RenderOptions {
  repoName: string;
  generatedAt: Date;
  sinceDate: Date;
  usedLlm: boolean;
}

export function renderMarkdown(
  _matches: MatchResult[],
  _options: RenderOptions,
): string {
  throw new Error("renderMarkdown not implemented yet; lands in M9");
}
