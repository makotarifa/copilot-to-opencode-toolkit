import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { scanSource } from "../src/discovery/source-scanner";

const FIXTURES = join(import.meta.dirname, "fixtures");
const COPIOLOT_FIXTURE = join(FIXTURES, "copilot");
const CLI_HOME_FIXTURE = join(FIXTURES, "cli-home");
const REPO_SOURCE = join(import.meta.dirname, "..", "..", "copilot-source");

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toolkit-scanner-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("scanSource workspace", () => {
  test("classifies each Copilot artifact family from the fixture tree", async () => {
    const result = await scanSource({ sourceRoot: COPIOLOT_FIXTURE });
    const byPath = new Map(result.items.map((item) => [item.relativePath, item.family]));

    expect(byPath.get(".github/agents/example.agent.md")).toBe(ArtifactFamily.Agent);
    expect(byPath.get(".github/agents/legacy.chatmode.md")).toBe(ArtifactFamily.Agent);
    expect(byPath.get(".github/prompts/review.prompt.md")).toBe(ArtifactFamily.Prompt);
    expect(byPath.get(".github/instructions/typescript.instructions.md")).toBe(
      ArtifactFamily.Instructions,
    );
    expect(byPath.get(".github/copilot-instructions.md")).toBe(ArtifactFamily.Instructions);
    expect(byPath.get(".github/skills/example-skill/SKILL.md")).toBe(ArtifactFamily.Skill);
    expect(byPath.get(".vscode/mcp.json")).toBe(ArtifactFamily.Mcp);
    expect(byPath.get("user-model-config.json")).toBe(ArtifactFamily.Provider);
    expect(byPath.get(".github/hooks/pre-tool.json")).toBe(ArtifactFamily.Hooks);
  });

  test("ignores non-Copilot files and reports unknown candidates", async () => {
    const result = await scanSource({ sourceRoot: COPIOLOT_FIXTURE });

    expect(result.items.some((item) => item.relativePath === "README.md")).toBe(false);
    expect(result.unknown.map((item) => item.relativePath)).toEqual([".github/unknown-file.json"]);
  });

  test("computes stable sha-256 hashes per file", async () => {
    const first = await scanSource({ sourceRoot: COPIOLOT_FIXTURE });
    const second = await scanSource({ sourceRoot: COPIOLOT_FIXTURE });

    expect(first.items.every((item) => item.sha.length === 64)).toBe(true);
    expect(first.items.map((item) => item.sha)).toEqual(second.items.map((item) => item.sha));
  });
});

describe("scanSource cli-home", () => {
  test("merges the CLI-home inventory and surfaces unknown config files", async () => {
    const result = await scanSource({
      sourceRoot: COPIOLOT_FIXTURE,
      cliHomeRoot: CLI_HOME_FIXTURE,
    });
    const byPath = new Map(result.items.map((item) => [item.relativePath, item.family]));

    expect(byPath.get("agents/cli.agent.md")).toBe(ArtifactFamily.Agent);
    expect(byPath.get("skills/cli-skill/SKILL.md")).toBe(ArtifactFamily.Skill);
    expect(byPath.get("instructions/cli.instructions.md")).toBe(ArtifactFamily.Instructions);
    expect(byPath.get("copilot-instructions.md")).toBe(ArtifactFamily.Instructions);
    expect(byPath.get("mcp-config.json")).toBe(ArtifactFamily.Mcp);

    const unknownPaths = result.unknown.map((item) => item.relativePath);
    expect(unknownPaths).toContain("settings.json");
    expect(unknownPaths).toContain("permissions-config.json");
  });
});

describe("scanSource temp dirs and defaults", () => {
  test("scans an atomically created temp source tree", async () => {
    const sourceRoot = await makeTempDir();
    await mkdir(join(sourceRoot, ".github", "agents"), { recursive: true });
    await writeFile(join(sourceRoot, ".github", "agents", "temp.agent.md"), "---\n---\nBody");

    const result = await scanSource({ sourceRoot });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.family).toBe(ArtifactFamily.Agent);
  });

  test("the repo default copilot-source is empty until it is dumped", async () => {
    const result = await scanSource({ sourceRoot: REPO_SOURCE });

    expect(result.items).toEqual([]);
    expect(result.unknown).toEqual([]);
  });
});
