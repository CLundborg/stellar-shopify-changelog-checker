import type { ChangelogEntry, MatchResult, Signal } from "./types.js";

export interface MatchOptions {
  candidateThreshold: number;
  definiteThreshold: number;
}

export const DEFAULT_MATCH_OPTIONS: MatchOptions = {
  candidateThreshold: 40,
  definiteThreshold: 70,
};

export function matchEntries(
  _entries: ChangelogEntry[],
  _signals: Signal[],
  _options: MatchOptions = DEFAULT_MATCH_OPTIONS,
): MatchResult[] {
  throw new Error("matchEntries not implemented yet; lands in M7");
}
