import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { appendOpenCodeNotes } from "../src/domain/opencode-artifact";
import { MigratorRegistry } from "../src/transform/registry";
import { Migrator } from "../src/transform/migrator";

const stubMigrator: Migrator = {
  family: ArtifactFamily.Skill,
  async transform() {
    return { files: [], rows: [], warnings: [] };
  },
};

describe("domain models", () => {
  test("appendOpenCodeNotes terminates the body with the notes trailer", () => {
    const result = appendOpenCodeNotes("Body\n", [
      { label: "Source", value: "`.github/skills/x/SKILL.md`" },
    ]);

    expect(result).toContain("## OpenCode notes");
    expect(result.trimEnd().endsWith("- Source: `.github/skills/x/SKILL.md`")).toBe(true);
  });
});

describe("MigratorRegistry", () => {
  test("registers and retrieves a migrator by family", () => {
    const registry = new MigratorRegistry();
    registry.register(stubMigrator);

    expect(registry.has(ArtifactFamily.Skill)).toBe(true);
    expect(registry.get(ArtifactFamily.Skill)).toBe(stubMigrator);
    expect(registry.get(ArtifactFamily.Agent)).toBeUndefined();
    expect(registry.families()).toEqual([ArtifactFamily.Skill]);
  });
});
