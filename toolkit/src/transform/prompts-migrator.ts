import { ArtifactFamily } from "../domain/artifact-family";
import { Frontmatter, ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { appendOpenCodeNotes, MigratedFile, OpenCodeNote } from "../domain/opencode-artifact";
import { DEFAULT_PROMPT_PATTERN, PromptPattern } from "../domain/prompt-pattern";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { directoriesForScope, TargetScope } from "../domain/target-scope";
import { buildModelNotes } from "../model/model-notes";
import { modelResultRows } from "../model/model-report";
import { getString } from "../parse/frontmatter-values";
import { serializeFrontmatter } from "../parse/frontmatter-serializer";
import { Migrator, TransformContext, TransformResult } from "./migrator";
import { rewriteAgentReference } from "./reference-index";
import { namespaceOf, toModelValue, withNamespace } from "./transform-helpers";

const PROMPT_SUFFIX = ".prompt.md";
const DESCRIPTION_KEY = "description";
const AGENT_KEY = "agent";
const MODEL_KEY = "model";
const ARGUMENT_HINT_KEY = "argument-hint";
const SUBTASK_KEY = "subtask";
const USAGE_HEADING = "## Usage";
const DELEGATION_HEADING = "## Delegation";

interface ModelOutcome {
  readonly resolved?: string;
  readonly notes: readonly OpenCodeNote[];
  readonly rows: readonly ReportRow[];
  readonly warnings: readonly string[];
}

interface PromptRender {
  readonly outputName: string;
  readonly content: string;
  readonly rows: readonly ReportRow[];
  readonly warnings: readonly string[];
}

function outputNameOf(relativePath: string): string {
  const basename = relativePath.slice(relativePath.lastIndexOf("/") + 1);
  return basename.endsWith(PROMPT_SUFFIX) ? basename.slice(0, -PROMPT_SUFFIX.length) : basename;
}

function buildFrontmatter(
  description: string | undefined,
  agent: string | undefined,
  pattern: PromptPattern,
  resolvedModel: string | undefined,
): Frontmatter {
  const frontmatter: Frontmatter = {};
  if (description !== undefined) {
    frontmatter[DESCRIPTION_KEY] = description;
  }
  if (agent !== undefined) {
    frontmatter[AGENT_KEY] = agent;
  }
  if (pattern === PromptPattern.PatternA && agent !== undefined) {
    frontmatter[SUBTASK_KEY] = true;
  }
  if (resolvedModel !== undefined) {
    frontmatter[MODEL_KEY] = resolvedModel;
  }
  return frontmatter;
}

function buildUsageSection(outputName: string, argumentHint: string): string {
  return ["", USAGE_HEADING, "", "```", `/${outputName} ${argumentHint}`, "```", ""].join("\n");
}

function buildDelegationSection(agent: string): string {
  return [
    "",
    DELEGATION_HEADING,
    "",
    "Explicit orchestrated delegation to the owning agent:",
    "",
    "```",
    "task(",
    `  agent="${agent}",`,
    '  prompt="$ARGUMENTS"',
    ")",
    "```",
    "",
  ].join("\n");
}

function buildNotes(
  artifact: ParsedCopilotArtifact,
  pattern: PromptPattern,
  agent: string | undefined,
  argumentHint: string | undefined,
  modelNotes: readonly OpenCodeNote[],
): OpenCodeNote[] {
  const notes: OpenCodeNote[] = [
    { label: "Source", value: `\`${artifact.inventory.relativePath}\`` },
    {
      label: "Delegation pattern",
      value: pattern === PromptPattern.PatternA ? "A (`subtask: true`)" : "B (explicit `task(agent=...)`)",
    },
  ];
  if (agent !== undefined) {
    notes.push({ label: "Owning agent", value: `\`${agent}\`` });
  }
  if (argumentHint !== undefined) {
    notes.push({ label: "argument-hint", value: `converted to the \`${USAGE_HEADING}\` block` });
  }
  return [...notes, ...modelNotes];
}

async function resolvePromptModel(
  artifact: ParsedCopilotArtifact,
  context: TransformContext,
): Promise<ModelOutcome> {
  const value = toModelValue(artifact.frontmatter[MODEL_KEY]);
  if (context.models === undefined || value === undefined) {
    return { notes: [], rows: [], warnings: [] };
  }

  const result = await context.models.resolveValue(value);
  return {
    resolved: result.resolved,
    notes: buildModelNotes(result),
    rows: modelResultRows(result, ArtifactFamily.Prompt, artifact.inventory.relativePath),
    warnings: result.warnings,
  };
}

async function renderPrompt(artifact: ParsedCopilotArtifact, context: TransformContext): Promise<PromptRender> {
  const pattern = context.promptPattern ?? DEFAULT_PROMPT_PATTERN;
  const outputName = outputNameOf(artifact.inventory.relativePath);
  const source = artifact.inventory.relativePath;
  const agent = getString(artifact.frontmatter, AGENT_KEY);
  const agentRewrite =
    agent === undefined
      ? undefined
      : rewriteAgentReference(context.agentReferences, agent, ArtifactFamily.Prompt, source);
  const agentId = agentRewrite?.reference;
  const argumentHint = getString(artifact.frontmatter, ARGUMENT_HINT_KEY);
  const description = getString(artifact.frontmatter, DESCRIPTION_KEY);
  const model = await resolvePromptModel(artifact, context);
  const warnings: string[] = [...model.warnings];

  if (agent === undefined) {
    warnings.push(`Prompt \`${source}\` has no owning agent; no delegation block was emitted.`);
  }
  if (pattern === PromptPattern.PatternA && agent === undefined) {
    warnings.push(`Prompt \`${source}\` cannot use pattern A without an owning agent.`);
  }

  const frontmatter = buildFrontmatter(description, agentId, pattern, model.resolved);
  const sections = [artifact.body];
  if (argumentHint !== undefined) {
    sections.push(buildUsageSection(outputName, argumentHint));
  }
  if (pattern === PromptPattern.PatternB && agentId !== undefined) {
    sections.push(buildDelegationSection(agentId));
  }

  const notes = buildNotes(artifact, pattern, agentId, argumentHint, model.notes);
  const content = `${serializeFrontmatter(frontmatter)}${appendOpenCodeNotes(sections.join("\n"), notes)}`;
  return { outputName, content, rows: [...model.rows, ...(agentRewrite?.rows ?? [])], warnings };
}

export class PromptsMigrator implements Migrator {
  readonly family = ArtifactFamily.Prompt;

  async transform(artifact: ParsedCopilotArtifact, context: TransformContext): Promise<TransformResult> {
    const rendered = await renderPrompt(artifact, context);
    const commandsDir = directoriesForScope(context.scope ?? TargetScope.Project).commands;
    const namespace = namespaceOf(artifact.inventory.relativePath);
    const relativePath = `${withNamespace(commandsDir, namespace)}/${rendered.outputName}.md`;
    const files: MigratedFile[] = [{ relativePath, content: rendered.content }];
    const rows: ReportRow[] = [
      {
        code: ReportCode.Migrated,
        severity: ReportSeverity.Info,
        family: this.family,
        source: artifact.inventory.relativePath,
        dest: relativePath,
        message: "Migrated prompt to an OpenCode command.",
      },
      ...rendered.rows,
    ];

    return { files, rows, warnings: rendered.warnings };
  }
}
