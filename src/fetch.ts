import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { XMLParser } from "fast-xml-parser";
import type { ChangelogEntry } from "./types.js";

const DEFAULT_FEED_URL = "https://shopify.dev/changelog/feed.xml";
const API_VERSION_RE = /^\d{4}-\d{2}$/;
const ACTION_REQUIRED_TAGS = new Set(["action required"]);

export interface FetchOptions {
  cacheDir: string;
  sinceDays: number;
  feedUrl?: string;
  userAgent?: string;
}

export interface CacheState {
  lastRunAt: string;
  lastSeenLink?: string;
  feedUrl: string;
}

export async function fetchChangelog(
  options: FetchOptions,
): Promise<ChangelogEntry[]> {
  const feedUrl = options.feedUrl ?? DEFAULT_FEED_URL;
  const res = await fetch(feedUrl, {
    headers: {
      "user-agent":
        options.userAgent ??
        "stellar-shopify-changelog-checker/0.1 (+https://github.com/CLundborg/stellar-shopify-changelog-checker)",
      accept: "application/rss+xml, application/xml, text/xml",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Failed to fetch ${feedUrl}: ${res.status} ${res.statusText}`,
    );
  }
  const xml = await res.text();

  const entries = parseFeed(xml);
  const cutoff = Date.now() - options.sinceDays * 86_400_000;
  const recent = entries
    .filter((e) => Date.parse(e.publishedAt) >= cutoff)
    .sort(
      (a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt),
    );

  await saveCache(options.cacheDir, {
    lastRunAt: new Date().toISOString(),
    lastSeenLink: recent[0]?.link,
    feedUrl,
  });

  return recent;
}

export function parseFeed(xml: string): ChangelogEntry[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    trimValues: true,
    cdataPropName: "__cdata",
    isArray: (name, jpath) => {
      if (name === "item" && jpath === "rss.channel.item") return true;
      if (name === "category") return true;
      return false;
    },
  });
  const parsed = parser.parse(xml) as {
    rss?: { channel?: { item?: RawItem[] } };
  };
  const rawItems = parsed.rss?.channel?.item ?? [];
  return rawItems.map(toEntry);
}

interface RawItem {
  title?: string | { __cdata?: string };
  link?: string;
  description?: string | { __cdata?: string };
  pubDate?: string;
  category?: Array<string | { "#text"?: string; __cdata?: string }>;
  guid?: string | { "#text"?: string; "@_isPermaLink"?: string };
}

function toEntry(item: RawItem): ChangelogEntry {
  const title = extractText(item.title).trim();
  const link = (typeof item.link === "string" ? item.link : "").trim();
  const rawDescription = extractText(item.description);
  const body = stripHtml(rawDescription);
  const pubDate = item.pubDate
    ? new Date(item.pubDate).toISOString()
    : new Date(0).toISOString();

  const categories = (item.category ?? []).map((c) =>
    typeof c === "string"
      ? c.trim()
      : String(c?.["#text"] ?? c?.__cdata ?? "").trim(),
  );

  const apiVersions = categories.filter((c) => API_VERSION_RE.test(c));
  const actionRequired = categories.some((c) =>
    ACTION_REQUIRED_TAGS.has(c.toLowerCase()),
  );

  const guidText =
    typeof item.guid === "string"
      ? item.guid
      : (item.guid?.["#text"] ?? "");
  const id = (guidText || link).trim();

  return {
    id,
    title,
    link,
    publishedAt: pubDate,
    tags: categories,
    body,
    apiVersions,
    actionRequired,
  };
}

function extractText(value: RawItem["title" | "description"]): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.__cdata ?? "";
}

export function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function loadCache(cacheDir: string): Promise<CacheState | null> {
  const path = join(cacheDir, "last-seen.json");
  try {
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as CacheState;
  } catch {
    return null;
  }
}

async function saveCache(cacheDir: string, state: CacheState): Promise<void> {
  const path = join(cacheDir, "last-seen.json");
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2));
}
