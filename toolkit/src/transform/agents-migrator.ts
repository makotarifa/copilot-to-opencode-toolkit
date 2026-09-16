import { ArtifactFamily } from "../domain/artifact-family";
import { Frontmatter, ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { appendOpenCodeNotes, MigratedFile, OpenCodeNote } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { directoriesForScope, TargetScope } from "../domain/target-scope";
import { buildModelNotes } from "../model/model-notes";
import { modelResultRows } from "../model/model-report";
import { getBoolean, getString, getStringArray } from "../parse/frontmatter-values";
import { serializeFrontmatter } from "../parse/frontmatter-serializer";
import { buildHandoffsSection } from "./agent-handoffs";
import { Migrator, TransformContext, TransformResult } from "./migrator";
import { agentBasenameOf, namespaceOf, toModelValue, withNamespace } from "./transform-helpers";

const CHATMODE_SUFFIX = ".chatmode.md";
const DESCRIPTION_KEY = "description";
const MODEL_KEY = "model";
const MODE_KEY = "mode";
const USER_INVOCABLE_KEY = "user-invocable";
const DISABLE_MODEL_INVOCATION_KEY = "disable-model-invocation";
const INFER_KEY = "infer";
const TOOLS_KEY = "tools";
const SUBAGENTS_KEY = "agents";
const FRICTION_KEYS = ["target", "mcp-servers"];
const MODE_PRIMARY = "primary";
const MODE_SUBAGENT = "subagent";

interface Friction {
  readonly notes: OpenCodeNote[];
  readonly rows: ReportRow[];
}

interface AgentRender {
  readonly outputName: string;
  readonly content: string;
  readonly rows: ReportRow[];
  readonly warnings: string[];
}

function resolveMode(frontmatter: Frontmatter): string {
  return getBoolean(frontmatter, USER_INVOCABLE_KEY) === false ? MODE_SUBAGENT : MODE_PRIMARY;
}

function describeMode(frontmatter: Frontmatter): string {
  const userInvocable = getBoolean(frontmatter, USER_INVOCABLE_KEY);
  if (userInvocable === undefined) {
    return `\`${MODE_PRIMARY}\` (default; \`${USER_INVOCABLE_KEY}\` absent in source)`;
  }
  return `\`${resolveMode(frontmatter)}\` (from \`${USER_INVOCABLE_KEY}: ${userInvocable}\`)`;
}

function legacyFieldNotes(frontmatter: Frontmatter): OpenCodeNote[] {
  const notes: OpenCodeNote[] = [];
  const disableModelInvocation = getBoolean(frontmatter, DISABLE_MODEL_INVOCATION_KEY);
  if (disableModelInvocation !== undefined) {
    notes.push({
      label: DISABLE_MODEL_INVOCATION_KEY,
      value: `\`${disableModelInvocation}\` — no OpenCode equivalent; preserved for manual review`,
    });
  }
  const infer = getBoolean(frontmatter, INFER_KEY);
  if (infer !== undefined) {
    notes.push({ label: INFER_KEY, value: `\`${infer}\` — legacy Copilot field; no OpenCode equivalent` });
  }
  return notes;
}

function collectFrictions(frontmatter: Frontmatter, source: string): Friction {
  const notes: OpenCodeNote[] = [];
  const rows: ReportRow[] = [];
  const tools = getStringArray(frontmatter, TOOLS_KEY);
  const subAgents = getStringArray(frontmatter, SUBAGENTS_KEY);

  if (tools.length > 0) {
    notes.push({
      label: "Tools",
      value: `${tools.map((tool) => `\`${tool}\``).join(", ")} — map to OpenCode \`permission\`/\`tools\` after /review`,
    });
  }
  if (subAgents.length > 0) {
    notes.push({ label: "Subagents", value: `${subAgents.length} declared; OpenCode has no declarative subagents — use \`task()\`` });
  }
  for (const key of FRICTION_KEYS) {
    if (frontmatter[key] !== undefined) {
      notes.push({ label: key, value: `no OpenCode equivalent; preserved for manual review` });
      rows.push({
        code: ReportCode.ManualReview,
        severity: ReportSeverity.Warning,
        family: ArtifactFamily.Agent,
        source,
        message: `Field \`${key}\` has no OpenCode equivalent and needs manual review.`,
      });
    }
  }
  return { notes, rows };
}

async function resolveModel(frontmatter: Frontmatter, context: TransformContext, source: string) {
  const value = toModelValue(frontmatter[MODEL_KEY]);
  if (context.models === undefined || value === undefined) {
    return { resolved: undefined, notes: [] as OpenCodeNote[], rows: [] as ReportRow[], warnings: [] as string[] };
  }

  const result = await context.models.resolveValue(value);
  return {
    resolved: result.resolved,
    notes: buildModelNotes(result),
    rows: modelResultRows(result, ArtifactFamily.Agent, source),
    warnings: [...result.warnings],
  };
}

async function renderAgent(artifact: ParsedCopilotArtifact, context: TransformContext): Promise<AgentRender> {
  const source = artifact.inventory.relativePath;
  const description = getString(artifact.frontmatter, DESCRIPTION_KEY);
  const mode = resolveMode(artifact.frontmatter);
  const model = await resolveModel(artifact.frontmatter, context, source);
  const friction = collectFrictions(artifact.frontmatter, source);

  const frontmatter: Frontmatter = { [MODE_KEY]: mode };
  if (description !== undefined) {
    frontmatter[DESCRIPTION_KEY] = description;
  }
  if (model.resolved !== undefined) {
    frontmatter[MODEL_KEY] = model.resolved;
  }

  const notes: OpenCodeNote[] = [
    { label: "Source", value: `\`${source}\`` },
    { label: "Mode", value: describeMode(artifact.frontmatter) },
    ...legacyFieldNotes(artifact.frontmatter),
    ...model.notes,
    ...friction.notes,
  ];
  if (source.endsWith(CHATMODE_SUFFIX)) {
    notes.push({ label: "Legacy", value: "`*.chatmode.md` aliased to an OpenCode agent" });
  }

  const handoffs = buildHandoffsSection(artifact.frontmatter, context.agentReferences, source);
  const body = [artifact.body, handoffs.section].join("\n");
  const content = `${serializeFrontmatter(frontmatter)}${appendOpenCodeNotes(body, notes)}`;
  const warnings = [...model.warnings];
  if (description === undefined) {
    warnings.push(`Agent \`${source}\` has no description; OpenCode agents require one.`);
  }

  return {
    outputName: agentBasenameOf(source),
    content,
    rows: [...model.rows, ...friction.rows, ...handoffs.rows],
    warnings,
  };
}

export class AgentsMigrator implements Migrator {
  readonly family = ArtifactFamily.Agent;

  async transform(artifact: ParsedCopilotArtifact, context: TransformContext): Promise<TransformResult> {
    const rendered = await renderAgent(artifact, context);
    const agentsDir = directoriesForScope(context.scope ?? TargetScope.Project).agents;
    const namespace = namespaceOf(artifact.inventory.relativePath);
    const relativePath = `${withNamespace(agentsDir, namespace)}/${rendered.outputName}.md`;
    const files: MigratedFile[] = [{ relativePath, content: rendered.content }];
    const rows: ReportRow[] = [
      {
        code: ReportCode.Migrated,
        severity: ReportSeverity.Info,
        family: this.family,
        source: artifact.inventory.relativePath,
        dest: relativePath,
        message: "Migrated custom agent to OpenCode.",
      },
      ...rendered.rows,
    ];

    return { files, rows, warnings: rendered.warnings };
  }
}
