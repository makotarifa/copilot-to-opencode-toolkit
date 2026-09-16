import { ArtifactFamily } from "../domain/artifact-family";
import { ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { agentBasenameOf, agentIdOf } from "./transform-helpers";

export enum AgentReferenceResolution {
  Resolved = "resolved",
  Ambiguous = "ambiguous",
  Unknown = "unknown",
}

export interface AgentReferenceResult {
  readonly resolution: AgentReferenceResolution;
  readonly id: string;
  readonly candidates: readonly string[];
}

export interface AgentReferenceRewrite {
  readonly reference: string;
  readonly rows: readonly ReportRow[];
}

const AMBIGUOUS_AGENT_REF_PREFIX = "AMBIGUOUS_AGENT_REF:";
const UNKNOWN_AGENT_REF_PREFIX = "UNKNOWN_AGENT_REF:";

function referenceWarning(reference: string, result: AgentReferenceResult): string {
  if (result.resolution === AgentReferenceResolution.Ambiguous) {
    const candidates = result.candidates.join(", ");
    return `${AMBIGUOUS_AGENT_REF_PREFIX} \`${reference}\` matches ${result.candidates.length} agents (${candidates}); left verbatim.`;
  }
  return `${UNKNOWN_AGENT_REF_PREFIX} \`${reference}\` matches no migrated agent; left verbatim.`;
}

function manualReviewRow(
  reference: string,
  result: AgentReferenceResult,
  family: ArtifactFamily,
  source: string,
  dest?: string,
): ReportRow | undefined {
  if (result.resolution === AgentReferenceResolution.Resolved) {
    return undefined;
  }
  return {
    code: ReportCode.ManualReview,
    severity: ReportSeverity.Warning,
    family,
    source,
    dest,
    message: referenceWarning(reference, result),
  };
}

export class AgentReferenceIndex {
  private readonly idsByBasename: ReadonlyMap<string, ReadonlySet<string>>;

  constructor(agents: readonly ParsedCopilotArtifact[]) {
    const idsByBasename = new Map<string, Set<string>>();
    for (const agent of agents) {
      const relativePath = agent.inventory.relativePath;
      const basename = agentBasenameOf(relativePath);
      const ids = idsByBasename.get(basename) ?? new Set<string>();
      ids.add(agentIdOf(relativePath));
      idsByBasename.set(basename, ids);
    }
    this.idsByBasename = idsByBasename;
  }

  resolve(reference: string): AgentReferenceResult {
    const ids = this.idsByBasename.get(reference);
    if (ids === undefined || ids.size === 0) {
      return { resolution: AgentReferenceResolution.Unknown, id: reference, candidates: [] };
    }
    const candidates = [...ids].sort();
    if (candidates.length === 1) {
      const [only] = candidates;
      return { resolution: AgentReferenceResolution.Resolved, id: only ?? reference, candidates: [] };
    }
    return { resolution: AgentReferenceResolution.Ambiguous, id: reference, candidates };
  }
}

export function rewriteAgentReferences(
  index: AgentReferenceIndex | undefined,
  references: readonly string[],
  family: ArtifactFamily,
  source: string,
  dest?: string,
): readonly AgentReferenceRewrite[] {
  return references.map((reference) => {
    const result = index?.resolve(reference);
    if (result === undefined) {
      return { reference, rows: [] };
    }
    const row = manualReviewRow(reference, result, family, source, dest);
    return { reference: result.id, rows: row === undefined ? [] : [row] };
  });
}

export function rewriteAgentReference(
  index: AgentReferenceIndex | undefined,
  reference: string,
  family: ArtifactFamily,
  source: string,
  dest?: string,
): AgentReferenceRewrite {
  const [rewrite] = rewriteAgentReferences(index, [reference], family, source, dest);
  return rewrite ?? { reference, rows: [] };
}
