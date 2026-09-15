import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ReportCode } from "../src/domain/report";
import { SkillsMigrator } from "../src/transform/skills-migrator";
import { loadMarkdownArtifact } from "./helpers/artifact";

const FIXTURES = join(import.meta.dirname, "fixtures");
const TEAMS_WORKSPACE = join(FIXTURES, "copilot-teams");
const CONTEXT = { destRoot: join(import.meta.dirname, "tmp-dest") };

describe("SkillsMigrator", () => {
  test("migrates a workspace skill near-literally and moves extra fields to metadata", async () => {
    const artifact = await loadMarkdownArtifact(
      join(FIXTURES, "copilot"),
      ".github/skills/example-skill/SKILL.md",
      ArtifactFamily.Skill,
    );

    const result = await new SkillsMigrator().transform(artifact, CONTEXT);
    const file = result.files[0];

    expect(file?.relativePath).toBe("skills/example-skill/SKILL.md");
    expect(file?.content).toContain("name: example-skill");
    expect(file?.content).toContain("description: An example skill showing allowed-tools migration");
    expect(file?.content).toContain("metadata:");
    expect(file?.content).toContain("allowed-tools: Read, Write, Bash");
    expect(file?.content).toContain("Use this skill when the user asks");
    expect(file?.content).toContain("## OpenCode notes");
    expect(file?.content).toContain("check-duplicates");
    expect(result.rows[0]?.code).toBe(ReportCode.Migrated);
  });

  test("namespaces a skill by its source team", async () => {
    const artifact = await loadMarkdownArtifact(
      TEAMS_WORKSPACE,
      "common/skills/feign-client-integration/SKILL.md",
      ArtifactFamily.Skill,
    );

    const result = await new SkillsMigrator().transform(artifact, CONTEXT);

    expect(result.files[0]?.relativePath).toBe("skills/common/feign-client-integration/SKILL.md");
  });

  test("keeps a root-level skill flat", async () => {
    const artifact = await loadMarkdownArtifact(
      join(FIXTURES, "copilot"),
      ".github/skills/example-skill/SKILL.md",
      ArtifactFamily.Skill,
    );

    const result = await new SkillsMigrator().transform(artifact, CONTEXT);

    expect(result.files[0]?.relativePath).toBe("skills/example-skill/SKILL.md");
  });

  test("migrates a CLI-home skill from the same family", async () => {
    const artifact = await loadMarkdownArtifact(
      join(FIXTURES, "cli-home"),
      "skills/cli-skill/SKILL.md",
      ArtifactFamily.Skill,
    );

    const result = await new SkillsMigrator().transform(artifact, CONTEXT);

    expect(result.files[0]?.relativePath).toBe("skills/cli-skill/SKILL.md");
    expect(result.files[0]?.content).toContain("A skill discovered from the Copilot CLI home.");
  });
});
