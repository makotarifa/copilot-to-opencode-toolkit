import { ArtifactFamily } from "./artifact-family";

export enum ReportSeverity {
  Info = "info",
  Warning = "warning",
  Error = "error",
}

export enum ReportCode {
  Migrated = "MIGRATED",
  Defaults = "DEFAULTS",
  ModelMapped = "MODEL_MAPPED",
  ModelFallback = "MODEL_FALLBACK",
  UnmappedModel = "UNMAPPED_MODEL",
  StaleModelId = "STALE_MODEL_ID",
  SecretNormalized = "SECRET_NORMALIZED",
  ManualReview = "MANUAL_REVIEW",
  ManualRewrite = "MANUAL_REWRITE",
  ParseFallback = "PARSE_FALLBACK",
  BudgetExceeded = "BUDGET_EXCEEDED",
  ExcludedAgent = "EXCLUDED_AGENT",
  ProviderMigrated = "PROVIDER_MIGRATED",
  MultiTeam = "MULTI_TEAM",
  TeamSelection = "TEAM_SELECTION",
  PluginRecommendations = "ERR_PLUGIN_RECOMMENDATIONS",
  Skipped = "SKIPPED",
  Overwritten = "OVERWRITTEN",
  ConfigOverwrite = "INFO_CONFIG_OVERWRITE",
  ConfigInvalid = "ERR_CONFIG_INVALID",
}

export interface ReportRow {
  readonly code: ReportCode;
  readonly severity: ReportSeverity;
  readonly family: ArtifactFamily;
  readonly source: string;
  readonly dest?: string;
  readonly message: string;
}

export function makeRow(row: ReportRow): ReportRow {
  return row;
}
