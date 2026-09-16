import { ReportCode, ReportRow } from "../domain/report";

export enum ManualStepKind {
  Mechanical = "mechanical",
  Decision = "decision",
  Automatic = "automatic",
}

export interface ManualStepAction {
  readonly kind: ManualStepKind;
  readonly action: string;
}

export interface ManualStep {
  readonly kind: ManualStepKind;
  readonly title: string;
  readonly detail: string;
  readonly codes: readonly ReportCode[];
  readonly sources: readonly string[];
}

const AUTOMATIC_ACTION = "Nothing to do — the toolkit handled this automatically.";

export const MANUAL_STEP_ACTIONS: Record<ReportCode, ManualStepAction> = {
  [ReportCode.Migrated]: { kind: ManualStepKind.Automatic, action: AUTOMATIC_ACTION },
  [ReportCode.ModelMapped]: { kind: ManualStepKind.Automatic, action: AUTOMATIC_ACTION },
  [ReportCode.ModelFallback]: { kind: ManualStepKind.Automatic, action: AUTOMATIC_ACTION },
  [ReportCode.ProviderMigrated]: { kind: ManualStepKind.Automatic, action: AUTOMATIC_ACTION },
  [ReportCode.SecretNormalized]: {
    kind: ManualStepKind.Mechanical,
    action:
      "Put the real values for the emitted {env:VAR} names into your environment or .env (the placeholders are in .env.example).",
  },
  [ReportCode.Overwritten]: {
    kind: ManualStepKind.Mechanical,
    action: "Inspect the existing targets and re-run with --allow-overwrite to replace them.",
  },
  [ReportCode.ConfigOverwrite]: {
    kind: ManualStepKind.Mechanical,
    action: "Inspect the opencode.json collision and re-run with --allow-overwrite to apply the merge.",
  },
  [ReportCode.UnmappedModel]: {
    kind: ManualStepKind.Decision,
    action:
      "Map the model in toolkit/model-map.json (or --model-map) and re-run, or keep the original with --allow-unmapped-models.",
  },
  [ReportCode.StaleModelId]: {
    kind: ManualStepKind.Decision,
    action: "Point the map entry at an ID that exists in the destination catalog, then re-run.",
  },
  [ReportCode.ManualReview]: {
    kind: ManualStepKind.Decision,
    action:
      "Resolve each row by hand (disambiguate or add the referenced agent, fix the unknown artifact/team, complete the plugin step), then re-run.",
  },
  [ReportCode.ManualRewrite]: {
    kind: ManualStepKind.Decision,
    action: "Rewrite the hooks as an OpenCode plugin by hand; the toolkit migrates no hooks.",
  },
  [ReportCode.ParseFallback]: {
    kind: ManualStepKind.Decision,
    action: "Verify the source frontmatter parsed as intended; the lenient fallback may have misread it.",
  },
  [ReportCode.BudgetExceeded]: {
    kind: ManualStepKind.Decision,
    action: "Accept the demotion to lazy-load pointers, or shrink the instruction set and re-run.",
  },
  [ReportCode.ExcludedAgent]: {
    kind: ManualStepKind.Decision,
    action: "Enforce excludeAgent by hand; OpenCode has no native equivalent.",
  },
  [ReportCode.MultiTeam]: {
    kind: ManualStepKind.Decision,
    action: "Confirm the team selection, or re-run with an explicit --team <name>.",
  },
  [ReportCode.TeamSelection]: {
    kind: ManualStepKind.Decision,
    action: "Pass --team <name> (or --team all) and re-run; nothing was migrated.",
  },
  [ReportCode.PluginRecommendations]: {
    kind: ManualStepKind.Decision,
    action: "Fix toolkit/src/config/recommended-plugins.json (invalid JSONC or schema) and re-run.",
  },
  [ReportCode.ConfigInvalid]: {
    kind: ManualStepKind.Decision,
    action: "Fix the existing opencode.json (not valid JSONC), then re-run.",
  },
};

function codesWithKind(kind: ManualStepKind): ReadonlySet<ReportCode> {
  const entries = Object.entries(MANUAL_STEP_ACTIONS) as [ReportCode, ManualStepAction][];
  return new Set(entries.filter(([, entry]) => entry.kind === kind).map(([code]) => code));
}

export const MECHANICAL_STEP_CODES: ReadonlySet<ReportCode> = codesWithKind(ManualStepKind.Mechanical);
export const DECISION_STEP_CODES: ReadonlySet<ReportCode> = codesWithKind(ManualStepKind.Decision);

function isManualCode(code: ReportCode): boolean {
  return MECHANICAL_STEP_CODES.has(code) || DECISION_STEP_CODES.has(code);
}

function collectManualSources(rows: readonly ReportRow[]): Map<ReportCode, string[]> {
  const sourcesByCode = new Map<ReportCode, string[]>();
  for (const row of rows) {
    if (!isManualCode(row.code)) {
      continue;
    }
    const sources = sourcesByCode.get(row.code) ?? [];
    if (!sources.includes(row.source)) {
      sources.push(row.source);
    }
    sourcesByCode.set(row.code, sources);
  }
  return sourcesByCode;
}

function stepForCode(code: ReportCode, sources: readonly string[]): ManualStep {
  const entry = MANUAL_STEP_ACTIONS[code];
  return { kind: entry.kind, title: code, detail: entry.action, codes: [code], sources };
}

const KIND_ORDER: readonly ManualStepKind[] = [ManualStepKind.Mechanical, ManualStepKind.Decision];

function kindRank(kind: ManualStepKind): number {
  const index = KIND_ORDER.indexOf(kind);
  return index === -1 ? KIND_ORDER.length : index;
}

function compareSteps(left: ManualStep, right: ManualStep): number {
  const byKind = kindRank(left.kind) - kindRank(right.kind);
  return byKind !== 0 ? byKind : left.title.localeCompare(right.title);
}

export function deriveManualSteps(rows: readonly ReportRow[]): readonly ManualStep[] {
  return [...collectManualSources(rows).entries()]
    .map(([code, sources]) => stepForCode(code, sources))
    .sort(compareSteps);
}
