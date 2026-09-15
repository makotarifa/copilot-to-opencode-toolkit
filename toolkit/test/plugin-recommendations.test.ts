import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { PLUGIN_FRAGMENT_FILE, RECOMMENDED_PLUGINS_FILE } from "../src/constants";
import { ReportCode } from "../src/domain/report";
import { TargetScope } from "../src/domain/target-scope";
import { buildPluginFragment } from "../src/plugin/plugin-fragment";
import { DEFAULT_PLUGIN_SOURCE_ROOT, DEFAULT_PLUGINS_DIR } from "../src/plugin/plugin-defaults";
import {
  loadRecommendedPlugins,
  PluginRecommendationError,
  PluginSourceKind,
} from "../src/plugin/plugin-recommendations";
import { ConfigSection, detectConfigCollisions } from "../src/write/config-conflicts";
import { mergeJsonInto } from "../src/write/merge-json";
import { buildOpenCodeConfigPatch } from "../src/write/opencode-config";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeRecommendations(directory: string, document: object): Promise<void> {
  await writeFile(join(directory, RECOMMENDED_PLUGINS_FILE), JSON.stringify(document), "utf8");
}

async function writeLocalPlugin(sourceRoot: string, relativePath: string, content: string): Promise<void> {
  const target = join(sourceRoot, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

function fragmentFile(plugin: readonly string[]) {
  return { relativePath: `fragments/${PLUGIN_FRAGMENT_FILE}`, content: JSON.stringify({ plugin }) };
}

describe("loadRecommendedPlugins", () => {
  test("parses npm and local recommendations", async () => {
    const directory = await makeTempDir("toolkit-plugins-");
    await writeRecommendations(directory, {
      version: 1,
      plugins: [
        { kind: "local", specifier: ".opencode/plugins/custom.js" },
        { kind: "npm", specifier: "@scope/pkg@latest" },
      ],
    });

    const plugins = await loadRecommendedPlugins(directory);

    expect(plugins).toEqual([
      { kind: PluginSourceKind.Local, specifier: ".opencode/plugins/custom.js" },
      { kind: PluginSourceKind.Npm, specifier: "@scope/pkg@latest" },
    ]);
  });

  test("returns an empty list for an absent or empty file", async () => {
    const absent = await makeTempDir("toolkit-plugins-absent-");
    const empty = await makeTempDir("toolkit-plugins-empty-");
    await writeRecommendations(empty, { version: 1, plugins: [] });
    const keyless = await makeTempDir("toolkit-plugins-keyless-");
    await writeRecommendations(keyless, { version: 1 });

    expect(await loadRecommendedPlugins(absent)).toEqual([]);
    expect(await loadRecommendedPlugins(empty)).toEqual([]);
    expect(await loadRecommendedPlugins(keyless)).toEqual([]);
  });

  test("fails fast on an invalid shape", async () => {
    const directory = await makeTempDir("toolkit-plugins-invalid-");
    await writeRecommendations(directory, { version: 1, plugins: [{ kind: "git", specifier: "x" }] });

    await expect(loadRecommendedPlugins(directory)).rejects.toBeInstanceOf(PluginRecommendationError);
  });
});

describe("buildPluginFragment", () => {
  test("emits the fragment and copies resolvable local plugins", async () => {
    const sourceRoot = await makeTempDir("toolkit-plugin-src-");
    await writeLocalPlugin(sourceRoot, ".opencode/plugins/custom.js", "// custom plugin\n");

    const build = await buildPluginFragment(
      [
        { kind: PluginSourceKind.Local, specifier: ".opencode/plugins/custom.js" },
        { kind: PluginSourceKind.Npm, specifier: "@scope/pkg@latest" },
      ],
      { scope: TargetScope.Project, sourceRoot },
    );

    expect(build.file).toBeDefined();
    expect(JSON.parse(build.file?.content ?? "{}")).toEqual({
      plugin: ["./.opencode/plugins/custom.js", "@scope/pkg@latest"],
    });
    expect(build.copiedFiles).toEqual([
      { relativePath: ".opencode/plugins/custom.js", content: "// custom plugin\n" },
    ]);
    expect(build.rows).toEqual([]);
  });

  test("references user-scope local copies from the plugins directory", async () => {
    const sourceRoot = await makeTempDir("toolkit-plugin-src-user-");
    await writeLocalPlugin(sourceRoot, ".opencode/plugins/custom.js", "// custom plugin\n");

    const build = await buildPluginFragment(
      [{ kind: PluginSourceKind.Local, specifier: ".opencode/plugins/custom.js" }],
      { scope: TargetScope.User, sourceRoot },
    );

    expect(JSON.parse(build.file?.content ?? "{}")).toEqual({ plugin: ["./plugins/custom.js"] });
    expect(build.copiedFiles[0]?.relativePath).toBe("plugins/custom.js");
  });

  test("skips an unresolvable local plugin with a manual-review row and no fragment", async () => {
    const sourceRoot = await makeTempDir("toolkit-plugin-src-missing-");

    const build = await buildPluginFragment(
      [{ kind: PluginSourceKind.Local, specifier: ".opencode/plugins/gone.js" }],
      { scope: TargetScope.Project, sourceRoot },
    );

    expect(build.file).toBeUndefined();
    expect(build.copiedFiles).toEqual([]);
    expect(build.rows[0]?.code).toBe(ReportCode.ManualReview);
    expect(build.rows[0]?.message).toContain(".opencode/plugins/gone.js");
  });
});

describe("shipped recommendations", () => {
  test("the shipped recommended-plugins.json resolves its bundled local plugins", async () => {
    const plugins = await loadRecommendedPlugins(DEFAULT_PLUGINS_DIR);

    expect(plugins.length).toBeGreaterThan(0);
    const build = await buildPluginFragment(plugins, {
      scope: TargetScope.Project,
      sourceRoot: DEFAULT_PLUGIN_SOURCE_ROOT,
    });
    expect(build.rows).toEqual([]);
    const copiedPaths = build.copiedFiles.map((file) => file.relativePath);
    expect(copiedPaths).toEqual(
      expect.arrayContaining([
        ".opencode/plugins/graphify.js",
        ".opencode/plugins/security-hooks.js",
      ]),
    );
    expect(build.copiedFiles.every((file) => file.content.length > 0)).toBe(true);
  });
});

describe("plugin config patch and merge", () => {
  test("emits no plugin key when the fragment is absent", () => {
    const patch = buildOpenCodeConfigPatch([
      { relativePath: "fragments/instructions-snippet.json", content: '["instructions/*.md"]' },
    ]);

    expect("plugin" in patch).toBe(false);
  });

  test("reads the plugin fragment into the config patch", () => {
    const patch = buildOpenCodeConfigPatch([fragmentFile(["@scope/pkg@latest"])]);

    expect(patch.plugin).toEqual(["@scope/pkg@latest"]);
  });

  test("unions and dedupes pre-existing plugin entries without clobbering unrelated keys", async () => {
    const destRoot = await makeTempDir("toolkit-plugin-merge-");
    await writeFile(
      join(destRoot, "opencode.json"),
      JSON.stringify({
        tui: { theme: "dark" },
        plugin: ["@openspoon/subtask2@latest", "unrelated"],
      }),
      "utf8",
    );

    await mergeJsonInto(
      destRoot,
      "opencode.json",
      buildOpenCodeConfigPatch([
        fragmentFile(["@openspoon/subtask2@latest", "@tarquinen/opencode-dcp@latest"]),
      ]),
    );

    const merged = JSON.parse(await readFile(join(destRoot, "opencode.json"), "utf8")) as {
      tui: { theme: string };
      plugin: string[];
    };
    expect(merged.tui.theme).toBe("dark");
    expect(merged.plugin).toEqual([
      "@openspoon/subtask2@latest",
      "unrelated",
      "@tarquinen/opencode-dcp@latest",
    ]);
  });
});

describe("plugin config collisions", () => {
  test("does not flag union-safe plugin arrays", () => {
    expect(detectConfigCollisions({ plugin: ["existing"] }, { plugin: ["new"] })).toEqual([]);
  });

  test("flags a plugin type clobber", () => {
    expect(detectConfigCollisions({ plugin: "not-an-array" }, { plugin: ["new"] })).toEqual([
      { section: ConfigSection.Plugin, key: "plugin" },
    ]);
  });
});
