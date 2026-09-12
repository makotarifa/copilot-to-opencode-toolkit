import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { runCli } from "../src/cli/run";
import { InteractivePrompts } from "../src/cli/prompts";
import { ReportCode } from "../src/domain/report";

const TOOLKIT_DIR = join(import.meta.dirname, "..");
const FIXTURES = join(import.meta.dirname, "fixtures");
const COPIOLOT_FIXTURE = join(FIXTURES, "copilot");
const USER_CONFIG_FIXTURE = join(FIXTURES, "user-config");
const REPO_DEFAULTS = [join(TOOLKIT_DIR, "..", "copilot-source"), join(TOOLKIT_DIR, "..", "migrated")];
const GOLDEN_PROJECT_TREE_HASH =
  "576403d81e517209592887a0bd7afe27cf4ec32ac7315f4be5010befa78a6f54";
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash("sha256");
  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const target = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(target);
      } else {
        hash.update(entry.name);
        hash.update(await readFile(target));
      }
    }
  }
  await walk(root);
  return hash.digest("hex");
}

async function makeRepoWithMap(): Promise<string> {
  const repoRoot = await makeTempDir("toolkit-e2e-repo-");
  await mkdir(join(repoRoot, ".opencode"), { recursive: true });
  await writeFile(join(repoRoot, ".opencode", "marker.txt"), "untouched");
  await mkdir(join(repoRoot, "toolkit"), { recursive: true });
  await writeFile(
    join(repoRoot, "toolkit", "model-map.json"),
    JSON.stringify({ "gpt-4o": "litellm/litellm-default", "claude-3.5-sonnet": "litellm/litellm-builder" }),
  );
  return repoRoot;
}

async function makeSource(): Promise<string> {
  const source = await makeTempDir("toolkit-e2e-source-");
  await cp(COPIOLOT_FIXTURE, source, { recursive: true });
  await rm(join(source, ".github", "agents", "unknown-model.agent.md"));
  return source;
}

async function seedConfigHome(prefix: string): Promise<string> {
  const configHome = await makeTempDir(prefix);
  await cp(join(USER_CONFIG_FIXTURE, "opencode.json"), join(configHome, "opencode.json"));
  await cp(join(USER_CONFIG_FIXTURE, "AGENTS.md"), join(configHome, "AGENTS.md"));
  return configHome;
}

function makeDecliningOverwritePrompts(): InteractivePrompts {
  return {
    promptPath: async () => "",
    selectScope: async (_message, defaultValue) => defaultValue,
    confirm: async () => true,
    confirmOverwrite: async () => false,
    confirmPersist: async () => false,
    chooseModel: async () => "litellm/litellm-default",
    showPanel: () => undefined,
  };
}

describe("end-to-end migration", () => {
  test("dry run writes nothing, real run emits every artifact and the report", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const sourceHashBefore = await hashTree(source);
    const dryDest = join(repoRoot, "dry-out");
    const dest = join(repoRoot, "out");

    const dryRun = await runCli(["--dry-run", "--scope", "project", "--source", source, "--dest", dryDest], { cwd: repoRoot });
    expect(dryRun).toBe(0);
    expect(await pathExists(dryDest)).toBe(false);

    const realRun = await runCli(["--yes", "--scope", "project", "--source", source, "--dest", dest], { cwd: repoRoot });
    expect(realRun).toBe(0);

    const agent = await readFile(join(dest, "agents", "example.md"), "utf8");
    expect(agent).toContain("model: litellm/litellm-default");
    expect(agent).toContain("Model (original): `[gpt-4o, claude-3.5-sonnet]`");
    expect(agent).toContain("## OpenCode notes");

    const provider = JSON.parse(
      await readFile(join(dest, "fragments", "opencode-provider.fragment.json"), "utf8"),
    ) as { provider: Record<string, { options: { apiKey: string; baseURL: string } }> };
    expect(provider.provider.azure?.options.apiKey).toBe("{env:AZURE_OPENAI_API_KEY}");
    expect(provider.provider.azure?.options.baseURL).toBe("https://example.openai.azure.com/");

    const envExample = await readFile(join(dest, ".env.example"), "utf8");
    expect((envExample.match(/^TOKEN=/gm) ?? []).length).toBe(1);
    expect((envExample.match(/^AZURE_OPENAI_API_KEY=/gm) ?? []).length).toBe(1);
    expect(envExample).not.toContain("sk-plaintext");

    const snippet = await readFile(join(dest, "fragments", "instructions-snippet.json"), "utf8");
    expect(snippet).toContain(".opencode/instructions/*.md");
    expect(await readFile(join(dest, "fragments", "excluded-agents.md"), "utf8")).toContain("docs-writer");
    expect(await pathExists(join(dest, "commands", "review.md"))).toBe(true);
    expect(await pathExists(join(dest, "skills", "example-skill", "SKILL.md"))).toBe(true);

    const report = JSON.parse(await readFile(join(dest, "_migration-report.json"), "utf8")) as {
      rows: { code: string }[];
    };
    const codes = report.rows.map((row) => row.code);
    expect(codes).toContain(ReportCode.ModelFallback);
    expect(codes).toContain(ReportCode.ProviderMigrated);
    expect(codes).toContain(ReportCode.ExcludedAgent);

    expect(await hashTree(source)).toBe(sourceHashBefore);
    expect(await readFile(join(repoRoot, ".opencode", "marker.txt"), "utf8")).toBe("untouched");
    expect(await readdir(join(repoRoot, ".opencode"))).toEqual(["marker.txt"]);
    expect(await pathExists(join(dest, ".opencode"))).toBe(false);

    for (const defaults of REPO_DEFAULTS) {
      const entries = await readdir(defaults);
      expect(entries.every((entry) => entry === ".gitkeep" || entry === "README.md")).toBe(true);
    }
  });

  test("project scope output matches the pre-scope golden tree hash", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--scope", "project", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    expect(await hashTree(dest)).toBe(GOLDEN_PROJECT_TREE_HASH);
  });
});

describe("user scope end-to-end", () => {
  test("dry run writes nothing, real run emits under the config home and merges opencode.json", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const sourceHashBefore = await hashTree(source);
    const configHome = await seedConfigHome("toolkit-e2e-user-");
    const agentsMdBefore = await readFile(join(configHome, "AGENTS.md"), "utf8");

    const dryRun = await runCli(
      ["--scope", "user", "--dry-run", "--yes", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );
    expect(dryRun).toBe(0);
    expect(await pathExists(join(configHome, "command"))).toBe(false);
    expect(await readFile(join(configHome, "AGENTS.md"), "utf8")).toBe(agentsMdBefore);

    const realRun = await runCli(
      ["--scope", "user", "--yes", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );
    expect(realRun).toBe(0);

    expect(await pathExists(join(configHome, "command", "review.md"))).toBe(true);
    expect(await pathExists(join(configHome, "commands"))).toBe(false);
    expect(await pathExists(join(configHome, "agents", "example.md"))).toBe(true);
    expect(await pathExists(join(configHome, "skills", "example-skill", "SKILL.md"))).toBe(true);
    expect(await pathExists(join(configHome, "instructions", "api.md"))).toBe(true);
    expect(await pathExists(join(configHome, "_migration-report.md"))).toBe(true);
    expect(await pathExists(join(configHome, "_migration-report.json"))).toBe(true);

    const config = JSON.parse(await readFile(join(configHome, "opencode.json"), "utf8")) as {
      tui: { theme: string };
      plugin: string[];
      provider: Record<string, { options: { apiKey: string } }>;
      instructions: string[];
    };
    expect(config.tui.theme).toBe("dark");
    expect(config.plugin).toEqual(["subtask2"]);
    expect(config.provider.keep).toBeDefined();
    expect(config.provider.azure?.options.apiKey).toBe("{env:AZURE_OPENAI_API_KEY}");
    expect(Array.isArray(config.instructions)).toBe(true);
    expect(config.instructions.length).toBeGreaterThan(0);

    expect(await readFile(join(configHome, "AGENTS.md"), "utf8")).toBe(agentsMdBefore);
    expect(await hashTree(source)).toBe(sourceHashBefore);
    expect(await pathExists(join(source, ".opencode"))).toBe(false);
  });

  test("defaults to $XDG_CONFIG_HOME/opencode and never writes a global AGENTS.md", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const xdgConfigHome = await makeTempDir("toolkit-e2e-xdg-");
    const previousXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = xdgConfigHome;
    try {
      const exitCode = await runCli(["--scope", "user", "--yes", "--source", source], { cwd: repoRoot });

      expect(exitCode).toBe(0);
      const configHome = join(xdgConfigHome, "opencode");
      expect(await pathExists(join(configHome, "command", "review.md"))).toBe(true);
      expect(await pathExists(join(configHome, "opencode.json"))).toBe(true);
      expect(await pathExists(join(configHome, "AGENTS.md"))).toBe(false);
    } finally {
      if (previousXdg === undefined) {
        delete process.env.XDG_CONFIG_HOME;
      } else {
        process.env.XDG_CONFIG_HOME = previousXdg;
      }
    }
  });

  test("refuses to overwrite an existing skill that the operator declines", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const configHome = await makeTempDir("toolkit-e2e-collision-");
    const existingSkill = join(configHome, "skills", "example-skill", "SKILL.md");
    await mkdir(join(configHome, "skills", "example-skill"), { recursive: true });
    await writeFile(existingSkill, "existing skill\n");

    const exitCode = await runCli(
      ["--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot, dependencies: { prompts: makeDecliningOverwritePrompts() } },
    );

    expect(exitCode).toBe(0);
    expect(await readFile(existingSkill, "utf8")).toBe("existing skill\n");
    expect(await pathExists(join(configHome, "agents", "example.md"))).toBe(true);
  });
});
