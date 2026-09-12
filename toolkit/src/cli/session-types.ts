import { EnvVarReference } from "../domain/env-var";
import { MigratedFile } from "../domain/opencode-artifact";
import { ProviderPreview } from "../domain/provider-preview";
import { ReportRow } from "../domain/report";
import { ModelResolverPort } from "../model/index";
import { MigrationReport } from "../report/migration-report";
import { ResolvedPaths } from "../safety/path-validator";
import { MigratorRegistry } from "../transform/registry";
import { CliOptions } from "./flag-parser";
import { InteractivePrompts } from "./prompts";

export interface SessionDependencies {
  readonly registry?: MigratorRegistry;
  readonly prompts?: InteractivePrompts;
  readonly models?: ModelResolverPort;
}

export interface SessionInput {
  readonly options: CliOptions;
  readonly paths: ResolvedPaths;
  readonly modelMapPath: string;
  readonly baseModelMapPath: string;
  readonly dependencies?: SessionDependencies;
}

export interface SessionResult {
  readonly exitCode: number;
  readonly report: MigrationReport;
  readonly written: readonly string[];
  readonly refused: readonly string[];
  readonly dryRun: boolean;
  readonly blocked: boolean;
  readonly blockers: readonly ReportRow[];
}

export interface Aggregate {
  readonly files: MigratedFile[];
  readonly rows: ReportRow[];
  readonly warnings: string[];
  readonly envVarGroups: (readonly EnvVarReference[])[];
  readonly providerPreviews: ProviderPreview[];
}
