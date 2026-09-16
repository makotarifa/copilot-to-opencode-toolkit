import { ArtifactFamily } from "../domain/artifact-family";
import { ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { appendOpenCodeNotes, MigratedFile, OpenCodeNote } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { ADVISORY_SCOPE_PREFIX } from "../constants";
import { getString } from "../parse/frontmatter-values";
import { Migrator, TransformContext, TransformResult } from "./migrator";
import { AgentReferenceIndex, AgentReferenceRewrite, rewriteAgentReference } from "./reference-index";
import { namespaceOf, withNamespace } from "./transform-helpers";

const INSTRUCTIONS_DIR_NAME = "instructions";
const INSTRUCTIONS_SUFFIX = ".instructions.md";
const COPILOT_INSTRUCTIONS_BASENAME = "copilot-instructions.md";
const MARKDOWN_SUFFIX = ".md";
const APPLY_TO_KEY = "applyTo";
const EXCLUDE_AGENT_KEY = "excludeAgent";

export interface InstructionRecord {
  readonly source: string;
  readonly baseName: string;
  readonly namespace: string;
  readonly applyTo?: string;
  readonly excludeAgent?: string;
}

export function instructionBaseName(relativePath: string): string {
  const basename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  if (basename === COPILOT_INSTRUCTIONS_BASENAME) {
    return basename;
  }
  if (basename.endsWith(INSTRUCTIONS_SUFFIX)) {
    return `${basename.slice(0, -INSTRUCTIONS_SUFFIX.length)}${MARKDOWN_SUFFIX}`;
  }
  return basename;
}

export function toInstructionRecord(artifact: ParsedCopilotArtifact): InstructionRecord {
  const applyTo = getString(artifact.frontmatter, APPLY_TO_KEY);
  const excludeAgent = getString(artifact.frontmatter, EXCLUDE_AGENT_KEY);
  return {
    source: artifact.inventory.relativePath,
    baseName: instructionBaseName(artifact.inventory.relativePath),
    namespace: namespaceOf(artifact.inventory.relativePath),
    applyTo,
    excludeAgent,
  };
}

export function instructionOutputPath(
  record: InstructionRecord,
  directory: string,
  fileBase: string = record.baseName,
): string {
  return `${withNamespace(directory, record.namespace)}/${fileBase}`;
}

export function buildScopeHeader(applyTo: string | undefined): string {
  if (applyTo === undefined || applyTo.trim().length === 0) {
    return "> Scope: global (no Copilot `applyTo`; always-on in OpenCode)";
  }
  return `${ADVISORY_SCOPE_PREFIX} \`${applyTo}\` (ported from Copilot applyTo; advisory, not enforced)`;
}

export function resolveExcludeAgent(
  record: InstructionRecord,
  agentReferences: AgentReferenceIndex | undefined,
  relativePath?: string,
): AgentReferenceRewrite | undefined {
  if (record.excludeAgent === undefined) {
    return undefined;
  }
  return rewriteAgentReference(agentReferences, record.excludeAgent, ArtifactFamily.Instructions, record.source, relativePath);
}

export function buildInstructionNotes(
  record: InstructionRecord,
  agentReferences?: AgentReferenceIndex,
): OpenCodeNote[] {
  const notes: OpenCodeNote[] = [
    { label: "Source", value: `\`${record.source}\`` },
    { label: "Body", value: "preserved verbatim; Copilot frontmatter stripped" },
  ];
  if (record.applyTo !== undefined) {
    notes.push({
      label: "applyTo",
      value: `\`${record.applyTo}\` kept as an advisory Scope header; OpenCode \`instructions[]\` is always-on with no deterministic glob matching`,
    });
  }
  const excludeAgent = resolveExcludeAgent(record, agentReferences);
  if (excludeAgent !== undefined) {
    notes.push({
      label: "excludeAgent",
      value: `\`${excludeAgent.reference}\` recorded in \`fragments/excluded-agents.md\`; OpenCode has no native excludeAgent enforcement`,
    });
  }
  return notes;
}

export function renderInstructionContent(
  artifact: ParsedCopilotArtifact,
  agentReferences?: AgentReferenceIndex,
): string {
  const record = toInstructionRecord(artifact);
  const withHeader = `${buildScopeHeader(record.applyTo)}\n\n${artifact.body}`;
  return appendOpenCodeNotes(withHeader, buildInstructionNotes(record, agentReferences));
}

export function buildInstructionRows(
  record: InstructionRecord,
  relativePath: string,
  agentReferences?: AgentReferenceIndex,
): ReportRow[] {
  const rows: ReportRow[] = [
    {
      code: ReportCode.Migrated,
      severity: ReportSeverity.Info,
      family: ArtifactFamily.Instructions,
      source: record.source,
      dest: relativePath,
      message: "Migrated instruction file; body preserved verbatim.",
    },
  ];
  const excludeAgent = resolveExcludeAgent(record, agentReferences, relativePath);
  if (excludeAgent !== undefined) {
    rows.push({
      code: ReportCode.ExcludedAgent,
      severity: ReportSeverity.Warning,
      family: ArtifactFamily.Instructions,
      source: record.source,
      dest: relativePath,
      message: `excludeAgent \`${excludeAgent.reference}\` has no native OpenCode enforcement; recorded for manual review.`,
    });
    rows.push(...excludeAgent.rows);
  }
  return rows;
}

export class InstructionsMigrator implements Migrator {
  readonly family = ArtifactFamily.Instructions;

  async transform(artifact: ParsedCopilotArtifact, context: TransformContext): Promise<TransformResult> {
    const record = toInstructionRecord(artifact);
    const relativePath = instructionOutputPath(record, INSTRUCTIONS_DIR_NAME);
    const files: MigratedFile[] = [
      { relativePath, content: renderInstructionContent(artifact, context.agentReferences) },
    ];
    return { files, rows: buildInstructionRows(record, relativePath, context.agentReferences), warnings: [] };
  }
}
