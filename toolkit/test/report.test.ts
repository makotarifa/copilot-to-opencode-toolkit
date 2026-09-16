import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { MigratedFile } from "../src/domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../src/domain/report";
import { countRows, hasBlockingRows, renderReportJson, renderReportMarkdown } from "../src/report/migration-report";
import { ConflictKind, detectConflicts } from "../src/safety/conflict-detector";
import { buildDefaultRegistry } from "../src/transform/registry";

function file(relativePath: string): MigratedFile {
  return { relativePath, content: relativePath };
}

const ROW: ReportRow = {
  code: ReportCode.Migrated,
  severity: ReportSeverity.Info,
  family: ArtifactFamily.Agent,
  source: "a",
  dest: "b",
  message: "done",
};

describe("detectConflicts", () => {
  test("flags duplicate output paths", () => {
    const conflicts = detectConflicts([file("agents/x.md"), file("agents/x.md")]);
    expect(conflicts[0]?.kind).toBe(ConflictKind.DuplicatePath);
  });

  test("flags duplicate skill names with a dedicated kind", () => {
    const conflicts = detectConflicts([file("skills/x/SKILL.md"), file("skills/x/SKILL.md")]);
    expect(conflicts[0]?.kind).toBe(ConflictKind.DuplicateSkill);
  });

  test("flags duplicate skill names at any nesting depth", () => {
    const conflicts = detectConflicts([
      file("skills/common/foo/SKILL.md"),
      file("skills/common/foo/SKILL.md"),
    ]);
    expect(conflicts[0]?.kind).toBe(ConflictKind.DuplicateSkill);
  });

  test("still flags duplicate nested instruction paths as plain duplicates", () => {
    const conflicts = detectConflicts([
      file("instructions/common/generic.md"),
      file("instructions/common/generic.md"),
    ]);
    expect(conflicts[0]?.kind).toBe(ConflictKind.DuplicatePath);
  });

  test("returns no conflicts for unique paths", () => {
    expect(detectConflicts([file("agents/x.md"), file("agents/y.md")])).toEqual([]);
  });
});

describe("migration report", () => {
  test("renders JSON with a summary and counts rows", () => {
    const parsed = JSON.parse(renderReportJson({ rows: [ROW], warnings: ["W"] })) as {
      summary: {
        rows: number;
        warnings: number;
        counts: Record<string, number>;
        manualSteps: { mechanical: number; decision: number };
      };
      rows: unknown[];
    };

    expect(parsed.summary).toEqual({
      rows: 1,
      warnings: 1,
      counts: { [ReportCode.Migrated]: 1 },
      manualSteps: { mechanical: 0, decision: 0 },
    });
    expect(parsed.rows).toHaveLength(1);
    expect(countRows([ROW])).toEqual({ [ReportCode.Migrated]: 1 });
  });

  test("renders a Manual steps required section listing manual rows", () => {
    const manualRows = [{ ...ROW, code: ReportCode.UnmappedModel }];
    const markdown = renderReportMarkdown({ rows: manualRows, warnings: [] });

    expect(markdown).toContain("## Manual steps required");
    expect(markdown).toContain("UNMAPPED_MODEL");
    expect(markdown).not.toContain("completed every step automatically");

    const parsed = JSON.parse(renderReportJson({ rows: manualRows, warnings: [] })) as {
      summary: { manualSteps: { mechanical: number; decision: number } };
      manualSteps: { codes: string[]; sources: string[] }[];
    };
    expect(parsed.summary.manualSteps).toEqual({ mechanical: 0, decision: 1 });
    expect(parsed.manualSteps[0]?.codes).toEqual([ReportCode.UnmappedModel]);
    expect(parsed.manualSteps[0]?.sources).toEqual(["a"]);
  });

  test("renders an explicit none line when no manual step is required", () => {
    const markdown = renderReportMarkdown({ rows: [ROW], warnings: [] });

    expect(markdown).toContain("## Manual steps required");
    expect(markdown).toContain("completed every step automatically");
  });

  test("renders Markdown and detects blocking error rows", () => {
    const markdown = renderReportMarkdown({ rows: [ROW], warnings: [] });
    expect(markdown).toContain("| MIGRATED | info | agent | a | b | done |");
    expect(markdown).toContain("- _(none)_");
    expect(hasBlockingRows([ROW])).toBe(false);
    expect(hasBlockingRows([{ ...ROW, severity: ReportSeverity.Error, code: ReportCode.UnmappedModel }])).toBe(true);
  });
});

describe("buildDefaultRegistry", () => {
  test("registers every migratable family except unknown", () => {
    const registry = buildDefaultRegistry();

    expect(registry.has(ArtifactFamily.Agent)).toBe(true);
    expect(registry.has(ArtifactFamily.Prompt)).toBe(true);
    expect(registry.has(ArtifactFamily.Instructions)).toBe(true);
    expect(registry.has(ArtifactFamily.Skill)).toBe(true);
    expect(registry.has(ArtifactFamily.Mcp)).toBe(true);
    expect(registry.has(ArtifactFamily.Provider)).toBe(true);
    expect(registry.has(ArtifactFamily.Hooks)).toBe(true);
    expect(registry.has(ArtifactFamily.Unknown)).toBe(false);
  });
});
