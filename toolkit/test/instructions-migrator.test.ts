import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ParsedCopilotArtifact } from "../src/domain/copilot-artifact";
import { ReportCode } from "../src/domain/report";
import { buildInstructionsBundle } from "../src/transform/instructions-fragments";
import { InstructionsMigrator } from "../src/transform/instructions-migrator";
import { loadMarkdownArtifact } from "./helpers/artifact";

const FIXTURES = join(import.meta.dirname, "fixtures");
const WORKSPACE = join(FIXTURES, "copilot");
const BUDGET_WORKSPACE = join(FIXTURES, "copilot-budget");
const DEST_ROOT = join(import.meta.dirname, "tmp-dest");
const INSTRUCTIONS_DIR = ".opencode/instructions";

function makeArtifact(relativePath: string, applyTo: string, body: string): ParsedCopilotArtifact {
  return {
    inventory: { family: ArtifactFamily.Instructions, absolutePath: relativePath, relativePath, sha: "x" },
    frontmatter: { applyTo },
    body,
  };
}

async function loadWorkspaceInstructions(): Promise<ParsedCopilotArtifact[]> {
  return Promise.all([
    loadMarkdownArtifact(WORKSPACE, ".github/instructions/typescript.instructions.md", ArtifactFamily.Instructions),
    loadMarkdownArtifact(WORKSPACE, ".github/instructions/api.instructions.md", ArtifactFamily.Instructions),
    loadMarkdownArtifact(WORKSPACE, ".github/instructions/global.instructions.md", ArtifactFamily.Instructions),
    loadMarkdownArtifact(WORKSPACE, ".github/copilot-instructions.md", ArtifactFamily.Instructions),
  ]);
}

describe("InstructionsMigrator (per file)", () => {
  test("emits one file with an advisory scope header, verbatim body and notes", async () => {
    const artifact = await loadMarkdownArtifact(
      WORKSPACE,
      ".github/instructions/api.instructions.md",
      ArtifactFamily.Instructions,
    );

    const result = await new InstructionsMigrator().transform(artifact, { destRoot: DEST_ROOT });
    const content = result.files[0]?.content ?? "";

    expect(result.files[0]?.relativePath).toBe("instructions/api.md");
    expect(content).toContain("> Scope: applies when editing files matching `src/api/**`");
    expect(content).toContain("(ported from Copilot applyTo; advisory, not enforced)");
    expect(content).toContain("Keep API handlers thin and delegate to services.");
    expect(content).toContain("## OpenCode notes");
    expect(content).toContain("docs-writer");
    expect(result.rows.some((row) => row.code === ReportCode.ExcludedAgent)).toBe(true);
  });
});

describe("buildInstructionsBundle", () => {
  test("emits a single instructions[] glob by default and never writes AGENTS.md or .opencode", async () => {
    const artifacts = await loadWorkspaceInstructions();

    const bundle = buildInstructionsBundle(artifacts, {});
    const snippet = bundle.files.find((file) => file.relativePath === "fragments/instructions-snippet.json");
    const excluded = bundle.files.find((file) => file.relativePath === "fragments/excluded-agents.md");

    expect(JSON.parse(snippet?.content ?? "[]")).toEqual([`${INSTRUCTIONS_DIR}/*.md`]);
    expect(excluded?.content).toContain("docs-writer");
    expect(bundle.files.some((file) => file.relativePath.endsWith("AGENTS.md"))).toBe(false);
    expect(bundle.files.some((file) => file.relativePath.startsWith(".opencode/"))).toBe(false);
    expect(bundle.files.some((file) => file.relativePath === "fragments/agents-index-snippet.md")).toBe(false);
    expect(
      bundle.files
        .filter((file) => file.relativePath.startsWith("instructions/"))
        .every((file) => file.content.includes("## OpenCode notes")),
    ).toBe(true);
  });

  test("narrows per prefix only when every applyTo shares one static directory", () => {
    const artifacts = [
      makeArtifact(".github/instructions/a.instructions.md", "src/api/v1/**", "A"),
      makeArtifact(".github/instructions/b.instructions.md", "src/api/v2/**", "B"),
    ];

    const bundle = buildInstructionsBundle(artifacts, {});
    const snippet = bundle.files.find((file) => file.relativePath === "fragments/instructions-snippet.json");
    const instructionPaths = bundle.files
      .filter((file) => file.relativePath.startsWith("instructions/"))
      .map((file) => file.relativePath);

    expect(JSON.parse(snippet?.content ?? "[]")).toEqual([`${INSTRUCTIONS_DIR}/api-*.md`]);
    expect(instructionPaths).toEqual(["instructions/api-a.md", "instructions/api-b.md"]);
  });

  test("demotes over-budget instructions to a lazy-load index and drops them from the snippet", async () => {
    const names = ["one", "two", "three", "four", "five", "six"];
    const artifacts = await Promise.all(
      names.map((name) =>
        loadMarkdownArtifact(
          BUDGET_WORKSPACE,
          `.github/instructions/${name}.instructions.md`,
          ArtifactFamily.Instructions,
        ),
      ),
    );

    const bundle = buildInstructionsBundle(artifacts, {});
    const snippet = bundle.files.find((file) => file.relativePath === "fragments/instructions-snippet.json");
    const index = bundle.files.find((file) => file.relativePath === "fragments/agents-index-snippet.md");
    const entries = JSON.parse(snippet?.content ?? "[]") as string[];

    expect(entries).toHaveLength(5);
    expect(entries.every((entry) => !entry.includes("*"))).toBe(true);
    expect(index?.content).toContain("CRITICAL: use your Read tool");
    expect(index?.content).toContain("read `.opencode/instructions/");
    expect(index?.content).not.toContain("read `instructions/");
    expect(bundle.files.filter((file) => file.relativePath.startsWith("instructions/"))).toHaveLength(6);
    expect(bundle.rows.some((row) => row.code === ReportCode.BudgetExceeded)).toBe(true);
  });

  test("honours an interactive budget override", async () => {
    const names = ["one", "two", "three", "four", "five", "six"];
    const artifacts = await Promise.all(
      names.map((name) =>
        loadMarkdownArtifact(
          BUDGET_WORKSPACE,
          `.github/instructions/${name}.instructions.md`,
          ArtifactFamily.Instructions,
        ),
      ),
    );

    const bundle = buildInstructionsBundle(artifacts, { overrideBudget: true });
    const snippet = bundle.files.find((file) => file.relativePath === "fragments/instructions-snippet.json");

    expect(JSON.parse(snippet?.content ?? "[]")).toEqual([`${INSTRUCTIONS_DIR}/src-*.md`]);
    expect(bundle.files.some((file) => file.relativePath === "fragments/agents-index-snippet.md")).toBe(false);
  });
});
