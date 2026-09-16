import { DEFAULT_PROMPT_PATTERN } from "../domain/prompt-pattern";
import { InventoryItem, ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { TargetScope } from "../domain/target-scope";
import { INSTRUCTIONS_DIR_NAME } from "../constants";
import { classifyCopilotPath } from "../discovery/path-classifier";
import { parseFrontmatterFile } from "../parse/frontmatter-parser";
import { Conflict } from "../safety/conflict-detector";
import { buildInstructionsBundle } from "../transform/instructions-fragments";
import { AgentReferenceIndex } from "../transform/reference-index";
import { MigratorRegistry } from "../transform/registry";
import { InteractivePrompts } from "./prompts";
import { Aggregate, SessionInput } from "./session-types";

export async function parseArtifact(item: InventoryItem): Promise<ParsedCopilotArtifact> {
  const parsed = await parseFrontmatterFile(item.absolutePath);
  return {
    inventory: item,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    parseNotice: parsed.parseNotice,
  };
}

export function parseNoticeRows(
  artifacts: readonly ParsedCopilotArtifact[],
): { rows: ReportRow[]; warnings: string[] } {
  const rows: ReportRow[] = [];
  const warnings: string[] = [];
  for (const artifact of artifacts) {
    const notice = artifact.parseNotice;
    if (notice === undefined) {
      continue;
    }
    const detail =
      notice.droppedLines.length > 0
        ? `unparsed line(s): ${notice.droppedLines.join(" | ")}`
        : "no `key: value` lines were recovered";
    rows.push({
      code: ReportCode.ParseFallback,
      severity: ReportSeverity.Warning,
      family: artifact.inventory.family,
      source: artifact.inventory.relativePath,
      message: `Frontmatter parsed with the lenient line scan (${detail}); verify the file.`,
    });
    warnings.push(
      `PARSE_FALLBACK: \`${artifact.inventory.relativePath}\` used the lenient frontmatter scan (${detail}).`,
    );
  }
  return { rows, warnings };
}

export async function transformInstructions(
  artifacts: readonly ParsedCopilotArtifact[],
  input: SessionInput,
  prompts: InteractivePrompts,
  agentReferences?: AgentReferenceIndex,
): Promise<Aggregate> {
  const promotedInstructionsDir =
    (input.options.scope ?? TargetScope.Project) === TargetScope.User
      ? `${input.paths.dest}/${INSTRUCTIONS_DIR_NAME}`
      : undefined;
  let bundle = buildInstructionsBundle(artifacts, { promotedInstructionsDir, agentReferences });
  const overBudget = bundle.warnings.some((warning) => warning.startsWith("BUDGET_EXCEEDED"));
  if (!input.options.yes && overBudget) {
    const keepAll = await prompts.confirm("Instruction budget exceeded. Keep every instruction always-on?", false);
    if (keepAll) {
      bundle = buildInstructionsBundle(artifacts, { overrideBudget: true, promotedInstructionsDir, agentReferences });
    }
  }
  return { files: [...bundle.files], rows: [...bundle.rows], warnings: [...bundle.warnings], envVarGroups: [], providerPreviews: [] };
}

function unknownRow(item: InventoryItem): ReportRow {
  return {
    code: ReportCode.ManualReview,
    severity: ReportSeverity.Warning,
    family: item.family,
    source: item.relativePath,
    message: "No migrator handles this artifact; manual review required.",
  };
}

export async function transformOthers(
  artifacts: readonly ParsedCopilotArtifact[],
  registry: MigratorRegistry,
  input: SessionInput,
  agentReferences?: AgentReferenceIndex,
): Promise<Aggregate> {
  const aggregate: Aggregate = { files: [], rows: [], warnings: [], envVarGroups: [], providerPreviews: [] };
  const context = {
    destRoot: input.paths.dest,
    scope: input.options.scope ?? TargetScope.Project,
    promptPattern: DEFAULT_PROMPT_PATTERN,
    models: input.dependencies?.models,
    agentReferences,
  };

  for (const artifact of artifacts) {
    const migrator = registry.get(artifact.inventory.family);
    if (migrator === undefined) {
      aggregate.rows.push(unknownRow(artifact.inventory));
      continue;
    }
    const result = await migrator.transform(artifact, context);
    aggregate.files.push(...result.files);
    aggregate.rows.push(...result.rows);
    aggregate.warnings.push(...result.warnings);
    if (result.envVars !== undefined) {
      aggregate.envVarGroups.push(result.envVars);
    }
    if (result.providerPreview !== undefined) {
      aggregate.providerPreviews.push(result.providerPreview);
    }
  }
  return aggregate;
}

export function conflictRow(conflict: Conflict): ReportRow {
  return {
    code: ReportCode.ManualReview,
    severity: ReportSeverity.Warning,
    family: classifyCopilotPath(conflict.path),
    source: conflict.path,
    message: conflict.message,
  };
}
