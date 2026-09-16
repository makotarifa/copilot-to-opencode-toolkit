import { spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { runCli } from "../src/cli/run";
import { InteractivePrompts } from "../src/cli/prompts";
import { ReportCode } from "../src/domain/report";
import { TargetScope } from "../src/domain/target-scope";

const TOOLKIT_DIR = join(import.meta.dirname, "..");
const FIXTURES = join(import.meta.dirname, "fixtures");
const COPIOLOT_FIXTURE = join(FIXTURES, "copilot");
const OUR_WORKSPACE_OPENCODE_DIR = resolve(import.meta.dirname, "../..", ".opencode");
const CORRUPT_CONFIG_CONTENT = "{ not valid jsonc";
const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function makeMockPrompts(overrides: Partial<InteractivePrompts> = {}): InteractivePrompts {
  return {
    promptPath: async () => "",
    selectScope: async (_message, defaultValue) => defaultValue ?? TargetScope.Project,
    confirm: async () => true,
    confirmOverwrite: async () => true,
    confirmPersist: async () => true,
    selectTeams: async (_message, teams) => teams,
    chooseModel: async () => "litellm/litellm-default",
    showPanel: () => undefined,
    ...overrides,
  };
}

async function makeRepo(): Promise<string> {
  const repoRoot = await makeTempDir("toolkit-repo-");
  await mkdir(join(repoRoot, ".opencode"), { recursive: true });
  await mkdir(join(repoRoot, "toolkit"), { recursive: true });
  await writeFile(join(repoRoot, "toolkit", "model-map.json"), JSON.stringify({ "gpt-4o": "litellm/litellm-default" }));
  return repoRoot;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function makeCleanSource(): Promise<string> {
  const source = await makeTempDir("toolkit-source-");
  await mkdir(join(source, ".github", "agents"), { recursive: true });
  await mkdir(join(source, ".github", "skills", "x"), { recursive: true });
  await writeFile(
    join(source, ".github", "agents", "example.agent.md"),
    "---\ndescription: Example\nmodel: gpt-4o\n---\nBody\n",
  );
  await writeFile(
    join(source, ".github", "skills", "x", "SKILL.md"),
    "---\nname: x\ndescription: X skill\n---\nSkill body\n",
  );
  return source;
}

describe("runCli dry run", () => {
  test("exits 0 and writes zero files under the dest", async () => {
    const repoRoot = await makeRepo();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--dry-run", "--source", COPIOLOT_FIXTURE, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { prompts: makeMockPrompts() },
    });

    expect(exitCode).toBe(0);
    expect(await pathExists(dest)).toBe(false);
  });

  test("re-prompts an invalid interactive path and succeeds on retry", async () => {
    const repoRoot = await makeRepo();
    const dest = join(repoRoot, "out");
    let sourceAttempts = 0;
    const prompts = makeMockPrompts({
      promptPath: async (message) => {
        if (message.toLowerCase().includes("source")) {
          sourceAttempts += 1;
          return sourceAttempts === 1 ? join(repoRoot, "nope") : COPIOLOT_FIXTURE;
        }
        return dest;
      },
    });

    const exitCode = await runCli(["--dry-run"], { cwd: repoRoot, dependencies: { prompts } });

    expect(exitCode).toBe(0);
    expect(sourceAttempts).toBe(2);
  });

  test("uses the copilot-source -> migrated defaults with zero flags", async () => {
    const repoRoot = await makeRepo();
    await mkdir(join(repoRoot, "copilot-source", ".github", "agents"), { recursive: true });
    await writeFile(
      join(repoRoot, "copilot-source", ".github", "agents", "example.agent.md"),
      "---\ndescription: Example\nmodel: gpt-4o\n---\nBody\n",
    );

    const exitCode = await runCli(["--yes"], { cwd: repoRoot });

    expect(exitCode).toBe(0);
    expect(await pathExists(join(repoRoot, "migrated", "agents", "example.md"))).toBe(true);
  });
});

describe("runCli --yes", () => {
  test("populates a temp dest for a clean source", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { pluginsPath: await makeTempDir("toolkit-plugins-empty-") },
    });

    expect(exitCode).toBe(0);
    expect(await pathExists(join(dest, "agents", "example.md"))).toBe(true);
    expect(await pathExists(join(dest, "skills", "x", "SKILL.md"))).toBe(true);
    expect(await pathExists(join(dest, "_migration-report.md"))).toBe(true);
    expect(await pathExists(join(dest, ".opencode"))).toBe(false);
    const report = JSON.parse(await readFile(join(dest, "_migration-report.json"), "utf8")) as {
      summary: { counts: Record<string, number> };
    };
    expect(report.summary.counts[ReportCode.Migrated]).toBeGreaterThan(0);
  });

  test("gates unmapped models behind a non-zero exit unless allowed", async () => {
    const repoRoot = await makeRepo();
    const dest = join(repoRoot, "out");

    const gated = await runCli(["--yes", "--source", COPIOLOT_FIXTURE, "--dest", dest], { cwd: repoRoot });
    expect(gated).toBe(1);
    const report = JSON.parse(await readFile(join(dest, "_migration-report.json"), "utf8")) as {
      rows: { code: string }[];
    };
    expect(report.rows.some((row) => row.code === ReportCode.UnmappedModel)).toBe(true);

    const allowed = await runCli(
      ["--yes", "--allow-unmapped-models", "--allow-overwrite", "--source", COPIOLOT_FIXTURE, "--dest", dest],
      { cwd: repoRoot },
    );
    expect(allowed).toBe(0);
  });

  test("does not gate a model array whose later member is mappable", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-array-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "mixed.agent.md"),
      "---\ndescription: Mixed\nmodel: [unknown-name, gpt-4o]\n---\nBody\n",
    );
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    expect(exitCode).toBe(0);
    const agent = await readFile(join(dest, "agents", "mixed.md"), "utf8");
    expect(agent).toContain("model: litellm/litellm-default");
    expect(agent).toContain("Model (original): `[unknown-name, gpt-4o]`");
  });
});

describe("runCli interactive overwrite consent", () => {
  test("never overwrites an existing file without consent", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");
    expect(await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot })).toBe(0);
    const agentPath = join(dest, "agents", "example.md");
    const original = await readFile(agentPath, "utf8");

    await writeFile(
      join(source, ".github", "agents", "example.agent.md"),
      "---\ndescription: Changed\nmodel: gpt-4o\n---\nChanged body\n",
    );

    let asked = 0;
    const panels: string[] = [];
    const declining = makeMockPrompts({
      confirmOverwrite: async () => {
        asked += 1;
        return false;
      },
      showPanel: (title) => {
        panels.push(title);
      },
    });
    const declined = await runCli(["--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { prompts: declining },
    });

    expect(declined).toBe(0);
    expect(asked).toBeGreaterThan(0);
    expect(panels.some((title) => title.includes("Proposed change"))).toBe(true);
    expect(await readFile(agentPath, "utf8")).toBe(original);

    const accepted = await runCli(["--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { prompts: makeMockPrompts({ confirmOverwrite: async () => true }) },
    });
    expect(accepted).toBe(0);
    expect(await readFile(agentPath, "utf8")).toContain("Changed body");
  });

  test("writes only the files the user consents to on the default interactive path", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");

    const declined = await runCli(["--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { prompts: makeMockPrompts({ confirm: async () => false }) },
    });
    expect(declined).toBe(0);
    expect(await pathExists(join(dest, "agents", "example.md"))).toBe(false);

    const consented = await runCli(["--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { prompts: makeMockPrompts({ confirm: async () => true }) },
    });
    expect(consented).toBe(0);
    expect(await pathExists(join(dest, "agents", "example.md"))).toBe(true);
  });
});

describe("runCli scope wiring", () => {
  test("prompts for scope interactively and shows it in the resolved panel", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");
    let selectCalls = 0;
    const panels: string[] = [];
    const prompts = makeMockPrompts({
      promptPath: async (message) => (message.toLowerCase().includes("source") ? source : dest),
      selectScope: async () => {
        selectCalls += 1;
        return TargetScope.Project;
      },
      showPanel: (title, lines) => {
        panels.push([title, ...lines].join("\n"));
      },
    });

    const exitCode = await runCli(["--dry-run"], { cwd: repoRoot, dependencies: { prompts } });

    expect(exitCode).toBe(0);
    expect(selectCalls).toBe(1);
    expect(panels.some((panel) => panel.includes("scope:") && panel.includes("write root:"))).toBe(true);
  });

  test("writes user-scope commands to the singular command dir under --dest", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    await mkdir(join(source, ".github", "prompts"), { recursive: true });
    await writeFile(
      join(source, ".github", "prompts", "review.prompt.md"),
      "---\ndescription: Review\nagent: reviewer\n---\nBody\n",
    );
    const configHome = await makeTempDir("toolkit-config-");
    await writeFile(
      join(configHome, "opencode.json"),
      JSON.stringify({ tui: { theme: "dark" }, plugin: ["subtask2"] }),
    );
    await writeFile(join(configHome, "AGENTS.md"), "global rules\n");

    const exitCode = await runCli(
      ["--yes", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot, dependencies: { pluginsPath: await makeTempDir("toolkit-plugins-empty-") } },
    );

    expect(exitCode).toBe(0);
    expect(await pathExists(join(configHome, "command", "review.md"))).toBe(true);
    expect(await pathExists(join(configHome, "commands"))).toBe(false);
    expect(await pathExists(join(configHome, "agents", "example.md"))).toBe(true);
    const config = JSON.parse(await readFile(join(configHome, "opencode.json"), "utf8")) as {
      $schema: string;
      tui: { theme: string };
      plugin: string[];
    };
    expect(config.$schema).toBe("https://opencode.ai/config.json");
    expect(config.tui.theme).toBe("dark");
    expect(config.plugin).toEqual(["subtask2"]);
    expect(await readFile(join(configHome, "AGENTS.md"), "utf8")).toBe("global rules\n");
  });
});

describe("runCli --allow-overwrite guard", () => {
  test("refuses to overwrite an existing target under project --yes unless allowed", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");
    const existingAgent = join(dest, "agents", "example.md");
    await mkdir(join(dest, "agents"), { recursive: true });
    await writeFile(existingAgent, "operator content\n");

    const blocked = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });
    expect(blocked).toBe(1);
    expect(await readFile(existingAgent, "utf8")).toBe("operator content\n");
    expect(await pathExists(join(dest, "skills", "x", "SKILL.md"))).toBe(false);

    const allowed = await runCli(
      ["--yes", "--allow-overwrite", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );
    expect(allowed).toBe(0);
    expect(await readFile(existingAgent, "utf8")).not.toBe("operator content\n");
  });

  test("refuses to overwrite an existing target under user --yes unless allowed", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    await mkdir(join(source, ".github", "prompts"), { recursive: true });
    await writeFile(
      join(source, ".github", "prompts", "review.prompt.md"),
      "---\ndescription: Review\nagent: reviewer\n---\nBody\n",
    );
    const configHome = await makeTempDir("toolkit-guard-");
    const existingCommand = join(configHome, "command", "review.md");
    await mkdir(join(configHome, "command"), { recursive: true });
    await writeFile(existingCommand, "operator command\n");

    const blocked = await runCli(
      ["--yes", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );
    expect(blocked).toBe(1);
    expect(await readFile(existingCommand, "utf8")).toBe("operator command\n");
    expect(await pathExists(join(configHome, "agents"))).toBe(false);

    const allowed = await runCli(
      ["--yes", "--allow-overwrite", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );
    expect(allowed).toBe(0);
    expect(await readFile(existingCommand, "utf8")).not.toBe("operator command\n");
  });
});

describe("runCli config preflight", () => {
  test("aborts with zero writes when the existing opencode.json is corrupt", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const configHome = await makeTempDir("toolkit-corrupt-config-");
    const configPath = join(configHome, "opencode.json");
    await writeFile(configPath, CORRUPT_CONFIG_CONTENT, "utf8");

    const exitCode = await runCli(
      ["--yes", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(1);
    expect(await readFile(configPath, "utf8")).toBe(CORRUPT_CONFIG_CONTENT);
    expect(await pathExists(join(configHome, "agents"))).toBe(false);
    expect(await pathExists(join(configHome, "command"))).toBe(false);
  });

  test("aborts with zero writes when the existing opencode.json is corrupt interactively", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const configHome = await makeTempDir("toolkit-corrupt-config-interactive-");
    const configPath = join(configHome, "opencode.json");
    await writeFile(configPath, CORRUPT_CONFIG_CONTENT, "utf8");
    const declining = makeMockPrompts({
      confirm: async () => false,
      confirmOverwrite: async () => false,
    });

    const exitCode = await runCli(
      ["--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot, dependencies: { prompts: declining } },
    );

    expect(exitCode).toBe(1);
    expect(await readFile(configPath, "utf8")).toBe(CORRUPT_CONFIG_CONTENT);
    expect(await pathExists(join(configHome, "agents"))).toBe(false);
    expect(await pathExists(join(configHome, "command"))).toBe(false);
  });
});

describe("runCli opencode.json conflict", () => {
  test("reports a provider collision and exits 1 under --yes unless allowed", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-provider-src-");
    await writeFile(
      join(source, "user-model-config.json"),
      JSON.stringify({
        providerType: "azure",
        providerId: "azure",
        name: "Migrated Azure",
        baseURL: "https://example.openai.azure.com/",
        models: ["gpt-4o"],
      }),
    );
    const configHome = await makeTempDir("toolkit-provider-config-");
    const configPath = join(configHome, "opencode.json");
    await writeFile(
      configPath,
      JSON.stringify(
        { provider: { azure: { npm: "@ai-sdk/openai-compatible", name: "Existing Azure" } } },
        null,
        2,
      ),
    );
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    });

    const blocked = await runCli(
      ["--yes", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );
    expect(blocked).toBe(1);
    expect(errors.join("\n")).toContain(ReportCode.ConfigOverwrite);
    expect(errors.join("\n")).toContain("provider.azure");
    const untouched = JSON.parse(await readFile(configPath, "utf8")) as {
      provider: Record<string, { name: string }>;
    };
    expect(untouched.provider.azure?.name).toBe("Existing Azure");

    const allowed = await runCli(
      ["--yes", "--allow-overwrite", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );
    expect(allowed).toBe(0);
    const merged = JSON.parse(await readFile(configPath, "utf8")) as {
      provider: Record<string, { name: string }>;
    };
    expect(merged.provider.azure?.name).toBe("Migrated Azure");
    spy.mockRestore();
  });
});

describe("runCli interactive opencode.json merge", () => {
  test("previews the merge diff and writes the config only after consent", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-merge-src-");
    await writeFile(
      join(source, "user-model-config.json"),
      JSON.stringify({
        providerType: "azure",
        providerId: "azure",
        name: "Azure",
        baseURL: "https://example.openai.azure.com/",
        models: ["gpt-4o"],
      }),
    );
    const configHome = await makeTempDir("toolkit-merge-config-");
    const configPath = join(configHome, "opencode.json");
    await writeFile(configPath, JSON.stringify({ tui: { theme: "dark" } }, null, 2), "utf8");

    const panels: string[] = [];
    const declining = makeMockPrompts({
      confirmOverwrite: async () => false,
      showPanel: (title, lines) => {
        panels.push([title, ...lines].join("\n"));
      },
    });
    const declined = await runCli(["--scope", "user", "--source", source, "--dest", configHome], {
      cwd: repoRoot,
      dependencies: { prompts: declining },
    });
    expect(declined).toBe(0);
    expect(panels.some((panel) => panel.includes("opencode.json"))).toBe(true);
    const declinedConfig = JSON.parse(await readFile(configPath, "utf8")) as { provider?: unknown };
    expect(declinedConfig.provider).toBeUndefined();

    const accepting = makeMockPrompts({
      confirmOverwrite: async () => true,
      showPanel: () => undefined,
    });
    const accepted = await runCli(["--scope", "user", "--source", source, "--dest", configHome], {
      cwd: repoRoot,
      dependencies: { prompts: accepting },
    });
    expect(accepted).toBe(0);
    const merged = JSON.parse(await readFile(configPath, "utf8")) as {
      provider?: Record<string, unknown>;
      tui: { theme: string };
    };
    expect(merged.provider?.azure).toBeDefined();
    expect(merged.tui.theme).toBe("dark");
  });
});

describe("runCli target-scope edge cases", () => {
  test("emits absolute instruction globs for the user-scope config", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-instr-src-");
    await mkdir(join(source, ".github", "instructions"), { recursive: true });
    await writeFile(
      join(source, ".github", "instructions", "global.instructions.md"),
      "---\ndescription: Global\n---\nAlways write tests.\n",
    );
    const configHome = await makeTempDir("toolkit-instr-config-");

    const exitCode = await runCli(
      ["--yes", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot },
    );

    expect(exitCode).toBe(0);
    const config = JSON.parse(await readFile(join(configHome, "opencode.json"), "utf8")) as {
      instructions: string[];
    };
    expect(config.instructions).toEqual([`${configHome}/instructions/**/*.md`]);
  });

  test("fails fast with ERR_NO_CONFIG_HOME when XDG and HOME are unset", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const previousXdg = process.env.XDG_CONFIG_HOME;
    const previousHome = process.env.HOME;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.HOME;
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    });
    try {
      const exitCode = await runCli(["--yes", "--scope", "user", "--source", source], {
        cwd: repoRoot,
      });
      expect(exitCode).toBe(1);
      expect(errors.join("\n")).toContain("ERR_NO_CONFIG_HOME");
      expect(await pathExists(join(repoRoot, "migrated"))).toBe(false);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousXdg;
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      spy.mockRestore();
    }
  });

  test("rejects a dest inside this workspace's own .opencode in both scopes", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const bypass = join(OUR_WORKSPACE_OPENCODE_DIR, "bypass");
    const errors: string[] = [];
    const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(" "));
    });

    const project = await runCli(
      ["--yes", "--scope", "project", "--source", source, "--dest", bypass],
      { cwd: repoRoot },
    );
    const user = await runCli(
      ["--yes", "--scope", "user", "--source", source, "--dest", bypass],
      { cwd: repoRoot },
    );

    expect(project).toBe(1);
    expect(user).toBe(1);
    expect(errors.join("\n")).toContain("ERR_WRITE_INSIDE_OUR_OPENCODE");
    expect(await pathExists(bypass)).toBe(false);
    spy.mockRestore();
  });

  test("persists an interactively resolved model into the config-home model-map", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-user-unknown-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "mystery.agent.md"),
      "---\ndescription: Mystery\nmodel: mystery-model\n---\nBody\n",
    );
    const configHome = await makeTempDir("toolkit-user-modelmap-");
    const chooseModel = vi.fn(async (): Promise<string> => "litellm/litellm-default");

    const exitCode = await runCli(
      ["--dry-run", "--scope", "user", "--source", source, "--dest", configHome],
      { cwd: repoRoot, dependencies: { prompts: makeMockPrompts({ chooseModel }) } },
    );

    expect(exitCode).toBe(0);
    const map = JSON.parse(
      await readFile(join(configHome, "model-map.json"), "utf8"),
    ) as Record<string, string>;
    expect(map["mystery-model"]).toBe("litellm/litellm-default");
    const baseMap = JSON.parse(
      await readFile(join(repoRoot, "toolkit", "model-map.json"), "utf8"),
    ) as Record<string, string>;
    expect(baseMap["mystery-model"]).toBeUndefined();
  });
});

describe("runCli manual steps summary", () => {
  async function makeUnknownModelSource(): Promise<string> {
    const source = await makeTempDir("toolkit-manual-steps-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "mystery.agent.md"),
      "---\ndescription: Mystery\nmodel: mystery-model\n---\nBody\n",
    );
    return source;
  }

  test("prints the manual steps summary after the write summary without changing the exit code", async () => {
    const repoRoot = await makeRepo();
    const source = await makeUnknownModelSource();
    const dest = join(repoRoot, "out");
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runCli(
      ["--yes", "--allow-unmapped-models", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );

    const output = logged.mock.calls.map((call) => String(call[0])).join("\n");
    logged.mockRestore();
    expect(exitCode).toBe(0);
    expect(output).toContain("Manual steps required (");
    expect(output).toContain("UNMAPPED_MODEL");
    expect(output.indexOf("Wrote ")).toBeLessThan(output.indexOf("Manual steps required ("));
  });

  test("prints the manual steps summary on a dry run without writing", async () => {
    const repoRoot = await makeRepo();
    const source = await makeUnknownModelSource();
    const dest = join(repoRoot, "out");
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runCli(["--dry-run", "--yes", "--source", source, "--dest", dest], {
      cwd: repoRoot,
    });

    const output = logged.mock.calls.map((call) => String(call[0])).join("\n");
    logged.mockRestore();
    expect(exitCode).toBe(1);
    expect(output).toContain("Dry run: no files were written.");
    expect(output).toContain("Manual steps required (");
    expect(await pathExists(dest)).toBe(false);
  });
});

describe("runCli parse notices", () => {
  test("surfaces the lenient frontmatter fallback in the report", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-malformed-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "broken.agent.md"),
      "---\ndescription: Uses colons: like this\nmodel: gpt-4o\n---\nBody\n",
    );
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    expect(exitCode).toBe(0);
    const report = JSON.parse(await readFile(join(dest, "_migration-report.json"), "utf8")) as {
      rows: { code: string }[];
    };
    expect(report.rows.some((row) => row.code === ReportCode.ParseFallback)).toBe(true);
  });
});

describe("runCli path validation", () => {
  test("fails fast when source equals dest", async () => {
    const repoRoot = await makeRepo();

    const exitCode = await runCli(["--source", repoRoot, "--dest", repoRoot], {
      cwd: repoRoot,
      dependencies: { prompts: makeMockPrompts() },
    });

    expect(exitCode).toBe(1);
  });

  test("refuses a repo-root source in --yes mode", async () => {
    const repoRoot = await makeRepo();

    const exitCode = await runCli(["--yes", "--source", repoRoot, "--dest", join(repoRoot, "out")], {
      cwd: repoRoot,
    });

    expect(exitCode).toBe(1);
  });

  test("fails fast on a dest outside the repository root in --yes mode", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const outside = await makeTempDir("toolkit-outside-");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", outside], { cwd: repoRoot });

    expect(exitCode).toBe(1);
  });

  test("re-prompts an out-of-repo dest interactively and succeeds on retry", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const outside = await makeTempDir("toolkit-outside-");
    const dest = join(repoRoot, "out");
    let destAttempts = 0;
    const prompts = makeMockPrompts({
      promptPath: async (message) => {
        if (message.toLowerCase().includes("source")) {
          return source;
        }
        destAttempts += 1;
        return destAttempts === 1 ? outside : dest;
      },
    });

    const exitCode = await runCli(["--dry-run"], { cwd: repoRoot, dependencies: { prompts } });

    expect(exitCode).toBe(0);
    expect(destAttempts).toBe(2);
  });
});

describe("model mapping visibility", () => {
  async function reportRows(dest: string): Promise<{ code: string; message: string }[]> {
    const report = JSON.parse(await readFile(join(dest, "_migration-report.json"), "utf8")) as {
      rows: { code: string; message: string }[];
    };
    return report.rows;
  }

  test("emits MODEL_MAPPED with origin, destination and map source", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    expect(exitCode).toBe(0);
    const mapped = (await reportRows(dest)).filter((row) => row.code === ReportCode.ModelMapped);
    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.message).toContain("`gpt-4o`");
    expect(mapped[0]?.message).toContain("`litellm/litellm-default`");
    expect(mapped[0]?.message).toContain("model-map.json");
  });

  test("attributes an overlay mapping to --model-map", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");
    const overlay = join(repoRoot, "overlay.json");
    await writeFile(overlay, JSON.stringify({ "gpt-4o": "litellm/litellm-builder" }));

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest, "--model-map", overlay], {
      cwd: repoRoot,
    });

    expect(exitCode).toBe(0);
    const mapped = (await reportRows(dest)).filter((row) => row.code === ReportCode.ModelMapped);
    expect(mapped[0]?.message).toContain(`--model-map ${overlay}`);
    expect(mapped[0]?.message).toContain("`litellm/litellm-builder`");
  });

  test("does not emit MODEL_MAPPED for a pass-through catalog id", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-passthrough-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "direct.agent.md"),
      "---\ndescription: Direct\nmodel: litellm/litellm-default\n---\nBody\n",
    );
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    expect(exitCode).toBe(0);
    expect((await reportRows(dest)).some((row) => row.code === ReportCode.ModelMapped)).toBe(false);
    expect(await readFile(join(dest, "agents", "direct.md"), "utf8")).toContain(
      "model: litellm/litellm-default",
    );
  });

  test("gates an unmapped model, preserves the original and prints a --yes summary", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-unmapped-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "mystery.agent.md"),
      "---\ndescription: Mystery\nmodel: mystery-model\n---\nBody\n",
    );
    const dest = join(repoRoot, "out");
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const gated = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });
    expect(gated).toBe(1);
    expect((await reportRows(dest)).some((row) => row.code === ReportCode.UnmappedModel)).toBe(true);
    expect(await readFile(join(dest, "agents", "mystery.md"), "utf8")).toContain(
      "Model (original): `mystery-model`",
    );
    const output = logged.mock.calls.map((call) => String(call[0])).join("\n");
    expect(output).toContain("Model resolution:");
    expect(output).toContain("UNMAPPED_MODEL");

    const allowed = await runCli(
      ["--yes", "--allow-unmapped-models", "--allow-overwrite", "--source", source, "--dest", dest],
      { cwd: repoRoot },
    );
    expect(allowed).toBe(0);
    logged.mockRestore();
  });

  test("keeps STALE_MODEL_ID visible for a stale map entry", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-stale-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "stale.agent.md"),
      "---\ndescription: Stale\nmodel: gpt-4o\n---\nBody\n",
    );
    await writeFile(
      join(repoRoot, "toolkit", "model-map.json"),
      JSON.stringify({ "gpt-4o": "litellm/gone" }),
    );
    const dest = join(repoRoot, "out");

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    expect(exitCode).toBe(1);
    expect((await reportRows(dest)).some((row) => row.code === ReportCode.StaleModelId)).toBe(true);
  });

  test("prints no model summary when the run has zero model rows", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-nomodels-");
    await mkdir(join(source, ".github", "skills", "x"), { recursive: true });
    await writeFile(
      join(source, ".github", "skills", "x", "SKILL.md"),
      "---\nname: x\ndescription: X skill\n---\nSkill body\n",
    );
    const dest = join(repoRoot, "out");
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runCli(["--yes", "--source", source, "--dest", dest], { cwd: repoRoot });

    const output = logged.mock.calls.map((call) => String(call[0])).join("\n");
    logged.mockRestore();
    expect(exitCode).toBe(0);
    expect(output).not.toContain("Model resolution:");
  });

  test("suppresses the model summary on a --dry-run --yes run", async () => {
    const repoRoot = await makeRepo();
    const source = await makeCleanSource();
    const dest = join(repoRoot, "out");
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runCli(["--dry-run", "--yes", "--source", source, "--dest", dest], {
      cwd: repoRoot,
    });

    const output = logged.mock.calls.map((call) => String(call[0])).join("\n");
    logged.mockRestore();
    expect(exitCode).toBe(0);
    expect(output).not.toContain("Model resolution:");
    expect(output).toContain("Dry run: no files were written.");
  });
});

describe("interactive model persistence", () => {
  test("persists an interactively resolved model into model-map.json only", async () => {
    const repoRoot = await makeRepo();
    const source = await makeTempDir("toolkit-unknown-");
    await mkdir(join(source, ".github", "agents"), { recursive: true });
    await writeFile(
      join(source, ".github", "agents", "mystery.agent.md"),
      "---\ndescription: Mystery\nmodel: mystery-model\n---\nBody\n",
    );
    const dest = join(repoRoot, "out");
    const chooseModel = vi.fn(async (): Promise<string> => "litellm/litellm-default");

    const exitCode = await runCli(["--dry-run", "--source", source, "--dest", dest], {
      cwd: repoRoot,
      dependencies: { prompts: makeMockPrompts({ chooseModel }) },
    });

    expect(exitCode).toBe(0);
    expect(chooseModel).toHaveBeenCalledWith(
      "mystery-model",
      expect.arrayContaining(["litellm/litellm-default"]),
    );
    const map = JSON.parse(await readFile(join(repoRoot, "toolkit", "model-map.json"), "utf8")) as Record<string, string>;
    expect(map["mystery-model"]).toBe("litellm/litellm-default");
    expect(await pathExists(dest)).toBe(false);
  });
});

describe("bin/migrate.ts entrypoint", () => {
  test("exits non-zero for unmapped models and zero when allowed", async () => {
    const repoRoot = await makeTempDir("toolkit-spawn-repo-");
    await mkdir(join(repoRoot, ".opencode"), { recursive: true });
    const dest = join(repoRoot, "out");
    const bin = join(TOOLKIT_DIR, "bin", "migrate.ts");
    const tsx = join(TOOLKIT_DIR, "node_modules", ".bin", "tsx");
    const baseArgs = [bin, "--yes", "--source", COPIOLOT_FIXTURE, "--dest", dest];

    const gated = spawnSync(tsx, baseArgs, { cwd: repoRoot, encoding: "utf8" });
    expect(gated.status).toBe(1);

    const allowed = spawnSync(tsx, [...baseArgs, "--allow-unmapped-models", "--allow-overwrite"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(allowed.status).toBe(0);
    expect((await readdir(dest)).length).toBeGreaterThan(0);
  });
});
