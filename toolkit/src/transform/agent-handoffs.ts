import { ArtifactFamily } from "../domain/artifact-family";
import { Frontmatter } from "../domain/copilot-artifact";
import { ReportRow } from "../domain/report";
import { getRecordArray, getString } from "../parse/frontmatter-values";
import { AgentReferenceIndex, rewriteAgentReference } from "./reference-index";

const HANDOFFS_KEY = "handoffs";
const HANDOFF_AGENT_KEY = "agent";
const HANDOFF_LABEL_KEY = "label";
const HANDOFF_PROMPT_KEY = "prompt";
const HANDOFF_DEFAULT_LABEL = "handoff";
const HANDOFF_HEADER = ["", "## Handoffs", "", "OpenCode has no handoff UI; delegate explicitly with `task()`:", ""];
const HANDOFF_MISSING_AGENT_NOTE = "no `agent` in the source handoff; delegation omitted";

export interface HandoffSection {
  readonly section: string;
  readonly rows: readonly ReportRow[];
}

export function buildHandoffsSection(
  frontmatter: Frontmatter,
  agentReferences: AgentReferenceIndex | undefined,
  source: string,
): HandoffSection {
  const handoffs = getRecordArray(frontmatter, HANDOFFS_KEY);
  if (handoffs.length === 0) {
    return { section: "", rows: [] };
  }

  const rows: ReportRow[] = [];
  const lines = [...HANDOFF_HEADER];
  for (const handoff of handoffs) {
    const agent = getString(handoff, HANDOFF_AGENT_KEY);
    const label = getString(handoff, HANDOFF_LABEL_KEY);
    const prompt = getString(handoff, HANDOFF_PROMPT_KEY) ?? "";
    if (agent === undefined || agent.trim().length === 0) {
      lines.push(`- ${label ?? HANDOFF_DEFAULT_LABEL}: ${HANDOFF_MISSING_AGENT_NOTE}`, "", "```", prompt, "```", "");
      continue;
    }
    const resolution = rewriteAgentReference(agentReferences, agent, ArtifactFamily.Agent, source);
    rows.push(...resolution.rows);
    lines.push(
      `- ${label ?? resolution.reference}:`,
      "",
      "```",
      "task(",
      `  agent="${resolution.reference}",`,
      `  prompt="${prompt}",`,
      ")",
      "```",
      "",
    );
  }
  return { section: lines.join("\n"), rows };
}
