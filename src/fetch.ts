import type { ChangelogEntry } from "./types.js";

export interface FetchOptions {
  cacheDir: string;
  sinceDays: number;
}

export async function fetchChangelog(
  _options: FetchOptions,
): Promise<ChangelogEntry[]> {
  throw new Error("fetchChangelog not implemented yet; lands in M2");
}
