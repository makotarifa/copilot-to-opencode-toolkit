import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { appendOpenCodeNotes } from "../src/domain/opencode-artifact";
import { MigratorRegistry } from "../src/transform/registry";
import { Migrator } from "../src/transform/migrator";
import { agentIdOf, namespaceOf } from "../src/transform/transform-helpers";

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

describe("namespaceOf", () => {
  test("drops a dot-prefixed infra segment and stays flat", () => {
    expect(namespaceOf(".github/instructions/x.instructions.md")).toBe("");
  });

  test("drops any dot-prefixed directory, not just .github", () => {
    expect(namespaceOf(".hidden/agents/a.agent.md")).toBe("");
  });

  test("keeps named container segments verbatim", () => {
    expect(namespaceOf("github-copilot/neo/instructions/g.instructions.md")).toBe("github-copilot/neo");
  });

  test("keeps a root-level family path flat", () => {
    expect(namespaceOf("agents/a.agent.md")).toBe("");
  });

  test("keeps a plain named team namespace", () => {
    expect(namespaceOf("common/instructions/generic.instructions.md")).toBe("common");
  });
});

describe("agentIdOf", () => {
  test("prefixes the namespaced id for a named container", () => {
    expect(agentIdOf("github-copilot/neo/agents/g.agent.md")).toBe("github-copilot/neo/g");
  });

  test("stays the bare basename for the classic layout", () => {
    expect(agentIdOf(".github/agents/example.agent.md")).toBe("example");
  });

  test("strips the legacy chatmode suffix", () => {
    expect(agentIdOf("common/agents/legacy.chatmode.md")).toBe("common/legacy");
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
