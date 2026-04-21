export { defineConfig, loadConsumerConfig, guessRepoName } from "./config.js";
export { fetchChangelog, parseFeed, stripHtml } from "./fetch.js";
export { scanProject } from "./scan/index.js";
export { matchEntries, DEFAULT_MATCH_OPTIONS } from "./match-rules.js";
export { llmRerank } from "./llm-rerank.js";
export { renderMarkdown } from "./render-md.js";
export {
  runWorkspace,
  writeWorkspaceReports,
  loadWorkspaceConfigFile,
} from "./workspace.js";
export { getPreset, PRESET_NAMES, type PresetName } from "./presets.js";
export type {
  CheckerConfig,
  ChangelogEntry,
  MatchResult,
  ProjectType,
  Severity,
  Signal,
  SignalKind,
  WorkspaceConfig,
  WorkspaceProjectResult,
  WorkspaceProjectSpec,
  WorkspaceRunResult,
} from "./types.js";
