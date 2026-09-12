import { ArtifactFamily } from "../domain/artifact-family";
import { EnvVarReference } from "../domain/env-var";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportRow } from "../domain/report";
import { TargetScope } from "../domain/target-scope";
import {
  ENV_EXAMPLE_FILE,
  REPORT_JSON_FILE,
  REPORT_MARKDOWN_FILE,
} from "../constants";
import { scanSource } from "../discovery/source-scanner";
import { mergeMigratedFiles } from "../write/file-merge";
import { preflightOutputs } from "../write/output-preflight";
import { mergeEnvVars, renderEnvExample } from "../write/env-example";
import { renderReportJson, renderReportMarkdown, MigrationReport } from "../report/migration-report";
import { detectConflicts } from "../safety/conflict-detector";
import { buildDefaultRegistry } from "../transform/registry";
import { interactivePrompts } from "./prompts";
import { buildModels } from "./session-models";
import { computeExitCode, writeOutputs } from "./session-output";
import {
  conflictRow,
  parseArtifact,
  parseNoticeRows,
  transformInstructions,
  transformOthers,
} from "./session-transform";
import { SessionInput, SessionResult } from "./session-types";

export type { SessionDependencies, SessionInput, SessionResult } from "./session-types";

export async function runSession(input: SessionInput): Promise<SessionResult> {
  const prompts = input.dependencies?.prompts ?? interactivePrompts;
  const registry = input.dependencies?.registry ?? buildDefaultRegistry();
  const scan = await scanSource({ sourceRoot: input.paths.source, cliHomeRoot: input.paths.cliHome });
  const models = input.dependencies?.models ?? (await buildModels(input, prompts));
  const parsed = await Promise.all(scan.items.map(parseArtifact));
  const unknownArtifacts = await Promise.all(scan.unknown.map(parseArtifact));
  const known = input.options.family === undefined
    ? parsed
    : parsed.filter((artifact) => artifact.inventory.family === input.options.family);
  const selected = [...known, ...unknownArtifacts];

  const rows: ReportRow[] = [];
  const warnings: string[] = [];
  const files: MigratedFile[] = [];
  const envVarGroups: (readonly EnvVarReference[])[] = [];
  const notices = parseNoticeRows(selected);
  rows.push(...notices.rows);
  warnings.push(...notices.warnings);
  const instructions = selected.filter((artifact) => artifact.inventory.family === ArtifactFamily.Instructions);
  const others = selected.filter((artifact) => artifact.inventory.family !== ArtifactFamily.Instructions);

  if (instructions.length > 0) {
    const aggregate = await transformInstructions(instructions, input, prompts);
    files.push(...aggregate.files);
    rows.push(...aggregate.rows);
    warnings.push(...aggregate.warnings);
  }
  const othersAggregate = await transformOthers(others, registry, { ...input, dependencies: { ...input.dependencies, models } });
  files.push(...othersAggregate.files);
  rows.push(...othersAggregate.rows);
  warnings.push(...othersAggregate.warnings);
  envVarGroups.push(...othersAggregate.envVarGroups);

  for (const preview of othersAggregate.providerPreviews) {
    if (!input.options.yes) {
      prompts.showPanel(`Resolved provider: ${preview.providerId}`, [
        `baseURL: ${preview.baseURL ?? "(none)"}`,
        `apiKey: ${preview.apiKeyEnv ? `{env:${preview.apiKeyEnv}}` : "(none)"}`,
        `models: ${preview.models.join(", ") || "(none)"}`,
      ]);
    }
  }

  const envVars = mergeEnvVars(envVarGroups);
  if (envVars.length > 0) {
    files.push({ relativePath: ENV_EXAMPLE_FILE, content: renderEnvExample(envVars) });
  }
  for (const conflict of detectConflicts(files)) {
    rows.push(conflictRow(conflict));
  }

  const contentFiles = mergeMigratedFiles(files);
  const preflight = await preflightOutputs({
    destRoot: input.paths.dest,
    files: contentFiles,
    scope: input.options.scope ?? TargetScope.Project,
    isYes: input.options.yes,
    dryRun: input.options.dryRun,
    allowOverwrite: input.options.allowOverwrite,
  });
  rows.push(...preflight.rows);

  const report: MigrationReport = { rows, warnings };
  const outputFiles = mergeMigratedFiles([
    ...contentFiles,
    { relativePath: REPORT_JSON_FILE, content: renderReportJson(report) },
    { relativePath: REPORT_MARKDOWN_FILE, content: renderReportMarkdown(report) },
  ]);

  const outcome = preflight.blocked
    ? { written: [], refused: [] }
    : await writeOutputs(outputFiles, input, prompts);
  return {
    exitCode: preflight.blocked ? 1 : computeExitCode(input.options, rows),
    report,
    written: outcome.written,
    refused: outcome.refused,
    dryRun: input.options.dryRun,
    blocked: preflight.blocked,
    blockers: preflight.blockers,
  };
}
