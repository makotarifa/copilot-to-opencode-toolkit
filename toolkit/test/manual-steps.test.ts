import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ReportCode, ReportRow, ReportSeverity } from "../src/domain/report";
import {
  DECISION_STEP_CODES,
  deriveManualSteps,
  MANUAL_STEP_ACTIONS,
  MECHANICAL_STEP_CODES,
  ManualStepKind,
} from "../src/report/manual-steps";

function row(code: ReportCode, source: string): ReportRow {
  return {
    code,
    severity: ReportSeverity.Warning,
    family: ArtifactFamily.Unknown,
    source,
    message: `${code} at ${source}`,
  };
}

describe("deriveManualSteps", () => {
  test("returns no steps when every row is automatic", () => {
    const steps = deriveManualSteps([
      row(ReportCode.Migrated, "agents/a.md"),
      row(ReportCode.ModelMapped, "agents/b.md"),
    ]);

    expect(steps).toEqual([]);
  });

  test("groups rows that share a decision code into one step with every source", () => {
    const steps = deriveManualSteps([
      row(ReportCode.UnmappedModel, "agents/a.md"),
      row(ReportCode.UnmappedModel, "agents/b.md"),
      row(ReportCode.UnmappedModel, "agents/b.md"),
    ]);

    expect(steps).toHaveLength(1);
    expect(steps[0]?.kind).toBe(ManualStepKind.Decision);
    expect(steps[0]?.codes).toEqual([ReportCode.UnmappedModel]);
    expect(steps[0]?.sources).toEqual(["agents/a.md", "agents/b.md"]);
  });

  test("orders mechanical steps before decision steps", () => {
    const steps = deriveManualSteps([
      row(ReportCode.UnmappedModel, "agents/a.md"),
      row(ReportCode.SecretNormalized, "fragments/mcp-snippet.json"),
    ]);

    expect(steps.map((step) => step.kind)).toEqual([
      ManualStepKind.Mechanical,
      ManualStepKind.Decision,
    ]);
  });

  test("ignores unknown or reserved codes without throwing", () => {
    const steps = deriveManualSteps([row("RESERVED_CODE" as ReportCode, "x")]);

    expect(steps).toEqual([]);
  });

  test("keeps the action table exhaustive and the code sets aligned with it", () => {
    const codes = Object.values(ReportCode) as ReportCode[];

    for (const code of codes) {
      expect(MANUAL_STEP_ACTIONS[code].action.length).toBeGreaterThan(0);
    }
    expect(MECHANICAL_STEP_CODES.size).toBeGreaterThan(0);
    expect(DECISION_STEP_CODES.size).toBeGreaterThan(0);
    expect([...MECHANICAL_STEP_CODES].every((code) => MANUAL_STEP_ACTIONS[code].kind === ManualStepKind.Mechanical)).toBe(true);
    expect([...DECISION_STEP_CODES].every((code) => MANUAL_STEP_ACTIONS[code].kind === ManualStepKind.Decision)).toBe(true);
    expect(MECHANICAL_STEP_CODES.size + DECISION_STEP_CODES.size).toBeLessThan(codes.length);
  });
});
