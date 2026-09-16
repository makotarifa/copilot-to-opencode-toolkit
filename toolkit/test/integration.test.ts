import { createHash } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { runCli } from "../src/cli/run";
import { InteractivePrompts } from "../src/cli/prompts";
import { PLUGIN_FRAGMENT_FILE, RECOMMENDED_PLUGINS_FILE } from "../src/constants";
import { ReportCode } from "../src/domain/report";

const TOOLKIT_DIR = join(import.meta.dirname, "..");
const FIXTURES = join(import.meta.dirname, "fixtures");
const COPIOLOT_FIXTURE = join(FIXTURES, "copilot");
const TEAMS_FIXTURE = join(FIXTURES, "copilot-teams");
const USER_CONFIG_FIXTURE = join(FIXTURES, "user-config");
const REPO_DEFAULTS = [join(TOOLKIT_DIR, "..", "copilot-source"), join(TOOLKIT_DIR, "..", "migrated")];
const GOLDEN_PROJECT_TREE_HASH =
  "8bd7fc5ddc55dd15482d9e4861431d9f45b7bd59d64cbc70b5cfea9598ff1258";
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

async function isolatedPlugins(): Promise<{ pluginsPath: string }> {
  return { pluginsPath: await makeTempDir("toolkit-plugins-empty-") };
}

async function makeTeamsSource(): Promise<string> {
  const source = await makeTempDir("toolkit-e2e-teams-source-");
  await cp(TEAMS_FIXTURE, source, { recursive: true });
  return source;
}

interface TeamReportRow {
  readonly code: string;
  readonly source: string;
  readonly dest?: string;
  readonly message: string;
}

async function readReportRows(dest: string): Promise<TeamReportRow[]> {
  const report = JSON.parse(await readFile(join(dest, "_migration-report.json"), "utf8")) as {
    rows: TeamReportRow[];
  };
  return report.rows;
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
    selectTeams: async (_message, teams) => teams,
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

    const dependencies = await isolatedPlugins();
    const dryRun = await runCli(["--dry-run", "--scope", "project", "--source", source, "--dest", dryDest], { cwd: repoRoot, dependencies });
    expect(dryRun).toBe(0);
    expect(await pathExists(dryDest)).toBe(false);

    const realRun = await runCli(["--yes", "--scope", "project", "--source", source, "--dest", dest], { cwd: repoRoot, dependencies });
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
    expect(snippet).toContain(".opencode/instructions/**/*.md");
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
      { cwd: repoRoot, dependencies: await isolatedPlugins() },
    );

    expect(exitCode).toBe(0);
    expect(await hashTree(dest)).toBe(GOLDEN_PROJECT_TREE_HASH);
  });

  test("classic project scope reports every unresolved agent reference", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--scope", "project", "--source", source, "--dest", dest],
      { cwd: repoRoot, dependencies: await isolatedPlugins() },
    );

    expect(exitCode).toBe(0);
    const unknownRefs = (await readReportRows(dest)).filter((row) =>
      row.message.includes("UNKNOWN_AGENT_REF:"),
    );
    expect(unknownRefs).toHaveLength(4);
    expect(unknownRefs.every((row) => row.code === ReportCode.ManualReview)).toBe(true);
    const messages = unknownRefs.map((row) => row.message).join("\n");
    expect(messages).toContain("`agent`");
    expect(messages).toContain("`reviewer`");
    expect(messages).toContain("`docs-writer`");
    expect(await readFile(join(dest, "_migration-report.md"), "utf8")).toContain("UNKNOWN_AGENT_REF:");
  });
});

describe("user scope end-to-end", () => {
  test("dry run writes nothing, real run emits under the config home and merges opencode.json", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const sourceHashBefore = await hashTree(source);
    const configHome = await seedConfigHome("toolkit-e2e-user-");
    const agentsMdBefore = await readFile(join(configHome, "AGENTS.md"), "utf8");

    const dependencies = await isolatedPlugins();
    const dryRun = await runCli(
      ["--scope", "user", "--dry-run", "--yes", "--source", source, "--dest", configHome],
      { cwd: repoRoot, dependencies },
    );
    expect(dryRun).toBe(0);
    expect(await pathExists(join(configHome, "command"))).toBe(false);
    expect(await readFile(join(configHome, "AGENTS.md"), "utf8")).toBe(agentsMdBefore);

    const realRun = await runCli(
      ["--scope", "user", "--yes", "--source", source, "--dest", configHome],
      { cwd: repoRoot, dependencies },
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

describe("team selection", () => {
  test("--team restricts the whole run to the selected team", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--team", "neo", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    expect(await pathExists(join(dest, "instructions", "neo", "generic.md"))).toBe(true);
    expect(await pathExists(join(dest, "instructions", "common", "generic.md"))).toBe(false);
    const rows = await readReportRows(dest);
    expect(rows.map((row) => row.dest ?? "")).toContain("instructions/neo/generic.md");
    expect(rows.map((row) => row.dest ?? "")).not.toContain("instructions/common/generic.md");
    expect(rows.some((row) => row.source === "(team breakdown): neo")).toBe(true);
  });

  test("--yes without --team warns with per-team and per-family counts", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    expect(exitCode).toBe(0);
    const rows = await readReportRows(dest);
    const multi = rows.find((row) => row.code === ReportCode.MultiTeam);
    expect(multi).toBeDefined();
    expect(multi?.message).toContain("common →");
    expect(multi?.message).toContain("neo →");
    expect(multi?.message).toContain("instructions: 3");
    expect(multi?.message).toContain("agent: 1");
    expect(rows.some((row) => row.source === "(team breakdown): github-copilot/smith")).toBe(true);
  });

  test("--team all migrates every team without the warning", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--team", "all", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    expect(await pathExists(join(dest, "instructions", "common", "generic.md"))).toBe(true);
    expect(await pathExists(join(dest, "instructions", "neo", "generic.md"))).toBe(true);
    expect(await pathExists(join(dest, "instructions", "github-copilot", "smith", "generic.md"))).toBe(true);
    const rows = await readReportRows(dest);
    expect(rows.some((row) => row.code === ReportCode.MultiTeam)).toBe(false);
  });

  test("--team all flags co-passed unknown team names without dropping the selection", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--team", "all", "--team", "ghost", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    expect(await pathExists(join(dest, "instructions", "neo", "generic.md"))).toBe(true);
    const rows = await readReportRows(dest);
    expect(
      rows.some((row) => row.code === ReportCode.ManualReview && row.source.includes("ghost")),
    ).toBe(true);
    expect(rows.some((row) => row.code === ReportCode.TeamSelection)).toBe(false);
  });

  test("treats an empty interactive selection as an error and exits 1", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");
    const prompts: InteractivePrompts = {
      ...makeDecliningOverwritePrompts(),
      selectTeams: async () => [],
    };

    const exitCode = await runCli(
      ["--scope", "project", "--source", source, "--dest", dest],
      { cwd: repoRoot, dependencies: { prompts } },
    );

    expect(exitCode).toBe(1);
    expect(await pathExists(join(dest, "instructions", "neo", "generic.md"))).toBe(false);
    const rows = await readReportRows(dest);
    expect(rows.some((row) => row.code === ReportCode.TeamSelection)).toBe(true);
  });

  test("interactive subset selection filters to the chosen teams", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");
    const prompts: InteractivePrompts = {
      ...makeDecliningOverwritePrompts(),
      selectTeams: async () => ["neo"],
    };

    const exitCode = await runCli(
      ["--scope", "project", "--source", source, "--dest", dest],
      { cwd: repoRoot, dependencies: { prompts } },
    );

    expect(exitCode).toBe(0);
    expect(await pathExists(join(dest, "instructions", "neo", "generic.md"))).toBe(true);
    expect(await pathExists(join(dest, "instructions", "common", "generic.md"))).toBe(false);
    const rows = await readReportRows(dest);
    expect(rows.some((row) => row.source === "(team breakdown): neo")).toBe(true);
    expect(rows.some((row) => row.source === "(team breakdown): common")).toBe(false);
  });

  test("--team combines with --family to narrow one family within a team", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--team", "common", "--family", "instructions", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    expect(await pathExists(join(dest, "instructions", "common", "generic.md"))).toBe(true);
    expect(await pathExists(join(dest, "agents", "common", "java-backend-developer.md"))).toBe(false);
    expect(await pathExists(join(dest, "instructions", "neo", "generic.md"))).toBe(false);
  });

  test("--team ghost yields a manual-review row and exit 1", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--team", "ghost", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(1);
    const rows = await readReportRows(dest);
    expect(rows.some((row) => row.code === ReportCode.ManualReview && row.source.includes("ghost"))).toBe(true);
    expect(rows.some((row) => row.code === ReportCode.TeamSelection)).toBe(true);
  });

  test("no duplicate loss under namespacing and zero dry-run writes", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      logged.push(args.map((arg) => String(arg)).join(" "));
    });

    const exitCode = await runCli(
      ["--dry-run", "--yes", "--team", "neo", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );
    spy.mockRestore();

    expect(exitCode).toBe(0);
    expect(await pathExists(dest)).toBe(false);
    expect(logged.join("\n")).toContain("instructions/neo/generic.md");
    expect(logged.join("\n")).not.toContain("Two artifacts target the same path");
  });

  test("user scope merges namespaced absolute instruction paths and keeps pre-existing keys", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const configHome = await seedConfigHome("toolkit-e2e-teams-user-");

    const exitCode = await runCli(
      ["--yes", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    const config = JSON.parse(await readFile(join(configHome, "opencode.json"), "utf8")) as {
      tui: { theme: string };
      instructions: string[];
    };
    expect(config.tui.theme).toBe("dark");
    expect(
      config.instructions.some((entry) => entry.startsWith(`${configHome}/instructions/`) && entry.includes("/neo/")),
    ).toBe(true);
    expect(config.instructions).not.toContain(`${configHome}/instructions/*.md`);
  });

  test("rewrites a command's owning agent to the id the agent file registers", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--team", "common", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    const command = await readFile(join(dest, "commands", "common", "jira-reviewer.md"), "utf8");
    expect(command).toContain("agent: common/jira-reviewer");
    expect(command).toContain('agent="common/jira-reviewer"');
    expect(await pathExists(join(dest, "agents", "common", "jira-reviewer.md"))).toBe(true);
    const rows = await readReportRows(dest);
    expect(rows.some((row) => row.message.includes("AMBIGUOUS_AGENT_REF:"))).toBe(false);
  });

  test("flags an ambiguous agent reference and keeps it verbatim", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeTeamsSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(
      ["--yes", "--team", "all", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    const command = await readFile(join(dest, "commands", "common", "jira-reviewer.md"), "utf8");
    expect(command).toContain("agent: jira-reviewer");
    expect(command).not.toContain("agent: common/jira-reviewer");

    const rows = await readReportRows(dest);
    const ambiguous = rows.find((row) => row.message.includes("AMBIGUOUS_AGENT_REF:"));
    expect(ambiguous?.code).toBe(ReportCode.ManualReview);
    expect(ambiguous?.message).toContain("common/jira-reviewer");
    expect(ambiguous?.message).toContain("neo/jira-reviewer");
    expect(await readFile(join(dest, "_migration-report.md"), "utf8")).toContain("AMBIGUOUS_AGENT_REF:");
  });
});

describe("recommended plugins", () => {
  test("emits the plugin fragment when recommendations are configured", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const dest = join(repoRoot, "out");
    const pluginsDir = await makeTempDir("toolkit-plugins-rec-");
    await writeFile(
      join(pluginsDir, RECOMMENDED_PLUGINS_FILE),
      JSON.stringify({ version: 1, plugins: [{ kind: "npm", specifier: "@scope/pkg@latest" }] }),
    );

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { pluginsPath: pluginsDir },
    });

    expect(exitCode).toBe(0);
    const fragment = JSON.parse(
      await readFile(join(dest, "fragments", PLUGIN_FRAGMENT_FILE), "utf8"),
    ) as { plugin: string[] };
    expect(fragment.plugin).toEqual(["@scope/pkg@latest"]);
  });

  test("copies local recommended plugins into the project plugins dir", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const dest = join(repoRoot, "out");
    const pluginsDir = await makeTempDir("toolkit-plugins-local-");
    const sourceRoot = await makeTempDir("toolkit-plugins-src-local-");
    await mkdir(join(sourceRoot, ".opencode", "plugins"), { recursive: true });
    await writeFile(join(sourceRoot, ".opencode", "plugins", "custom.js"), "// custom\n");
    await writeFile(
      join(pluginsDir, RECOMMENDED_PLUGINS_FILE),
      JSON.stringify({
        version: 1,
        plugins: [{ kind: "local", specifier: ".opencode/plugins/custom.js" }],
      }),
    );

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { pluginsPath: pluginsDir, pluginSourceRoot: sourceRoot },
    });

    expect(exitCode).toBe(0);
    expect(await pathExists(join(dest, ".opencode", "plugins", "custom.js"))).toBe(true);
    const fragment = JSON.parse(
      await readFile(join(dest, "fragments", PLUGIN_FRAGMENT_FILE), "utf8"),
    ) as { plugin: string[] };
    expect(fragment.plugin).toEqual(["./.opencode/plugins/custom.js"]);
  });

  test("emits the shipped default plugin set end to end", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    expect(exitCode).toBe(0);
    const shippedGraphify = await readFile(join(TOOLKIT_DIR, "plugins", "graphify.js"), "utf8");
    expect(await readFile(join(dest, ".opencode", "plugins", "graphify.js"), "utf8")).toBe(shippedGraphify);
    expect(await pathExists(join(dest, ".opencode", "plugins", "security-hooks.js"))).toBe(true);
    const fragment = JSON.parse(
      await readFile(join(dest, "fragments", PLUGIN_FRAGMENT_FILE), "utf8"),
    ) as { plugin: string[] };
    expect(fragment.plugin).toContain("./.opencode/plugins/graphify.js");
    expect(fragment.plugin).toContain("@zenobius/opencode-skillful@latest");
  });

  test("surfaces a malformed recommendations file as an error row instead of crashing", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const dest = join(repoRoot, "out");
    const pluginsDir = await makeTempDir("toolkit-plugins-broken-");
    await writeFile(join(pluginsDir, RECOMMENDED_PLUGINS_FILE), "{ not valid jsonc", "utf8");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { pluginsPath: pluginsDir },
    });

    expect(exitCode).toBe(1);
    const rows = await readReportRows(dest);
    expect(rows.some((row) => row.code === ReportCode.PluginRecommendations)).toBe(true);
    expect(await pathExists(join(dest, "fragments", PLUGIN_FRAGMENT_FILE))).toBe(false);
  });

  test("refuses to overwrite an existing copied local plugin under --yes", async () => {
    const repoRoot = await makeRepoWithMap();
    const source = await makeSource();
    const dest = join(repoRoot, "out");
    await mkdir(join(dest, ".opencode", "plugins"), { recursive: true });
    await writeFile(join(dest, ".opencode", "plugins", "custom.js"), "// operator\n");
    const pluginsDir = await makeTempDir("toolkit-plugins-local-");
    const sourceRoot = await makeTempDir("toolkit-plugins-src-local-");
    await mkdir(join(sourceRoot, "plugins"), { recursive: true });
    await writeFile(join(sourceRoot, "plugins", "custom.js"), "// custom\n");
    await writeFile(
      join(pluginsDir, RECOMMENDED_PLUGINS_FILE),
      JSON.stringify({
        version: 1,
        plugins: [{ kind: "local", specifier: "plugins/custom.js" }],
      }),
    );
    const dependencies = { pluginsPath: pluginsDir, pluginSourceRoot: sourceRoot };

    const blocked = await runCli(["--yes", "--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies,
    });

    expect(blocked).toBe(1);
    expect(await readFile(join(dest, ".opencode", "plugins", "custom.js"), "utf8")).toBe("// operator\n");
    expect(await pathExists(join(dest, "fragments", PLUGIN_FRAGMENT_FILE))).toBe(false);

    const allowed = await runCli(
      ["--yes", "--allow-overwrite", "--source", source, "--dest", dest],
      { cwd: repoRoot, dependencies },
    );
    expect(allowed).toBe(0);
    expect(await readFile(join(dest, ".opencode", "plugins", "custom.js"), "utf8")).toBe("// custom\n");
  });
});
