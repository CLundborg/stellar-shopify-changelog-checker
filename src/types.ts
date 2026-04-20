export type ProjectType = "theme" | "remix-app" | "extension-only";

export interface CheckerConfig {
  projectType: ProjectType;
  rootDir: string;
  outputPath: string;
  sinceDays?: number;
  llm?: {
    enabled?: boolean;
    provider?: "anthropic";
    model?: string;
  };
}

export interface ChangelogEntry {
  id: string;
  title: string;
  link: string;
  publishedAt: string;
  tags: string[];
  body: string;
  apiVersions: string[];
  actionRequired: boolean;
}

export type SignalKind =
  | "api-version"
  | "scope"
  | "extension-target"
  | "liquid-tag"
  | "liquid-filter"
  | "package"
  | "graphql-operation"
  | "theme-cli-version";

export interface Signal {
  kind: SignalKind;
  value: string;
  source: string;
  weight: number;
}

export type Severity = "action" | "breaking" | "feature" | "info";

export interface MatchResult {
  entry: ChangelogEntry;
  score: number;
  matchedSignals: Signal[];
  reasons: string[];
  severity: Severity;
  llmAssessed?: {
    impacts: boolean;
    reason: string;
    severity: Severity;
  };
}
