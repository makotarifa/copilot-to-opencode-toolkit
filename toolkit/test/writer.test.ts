import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { PathEscapeError, resolveWithin, writeFiles } from "../src/write/writer";
import { deepMerge, mergeMigratedFiles } from "../src/write/file-merge";
import { renderDiff } from "../src/write/diff-preview";
import { mergeJsonInto } from "../src/write/merge-json";
import { buildOpenCodeConfigPatch } from "../src/write/opencode-config";
import { ConfigSection, detectConfigCollisions } from "../src/write/config-conflicts";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toolkit-writer-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("writer", () => {
  test("writes nested files under the dest root", async () => {
    const destRoot = await makeTempDir();
    const outcome = await writeFiles(
      destRoot,
      [{ relativePath: "agents/x.md", content: "hello" }],
      true,
    );

    expect(outcome.written).toEqual(["agents/x.md"]);
    expect(await readFile(join(destRoot, "agents", "x.md"), "utf8")).toBe("hello");
  });

  test("refuses to overwrite without consent", async () => {
    const destRoot = await makeTempDir();
    await writeFiles(destRoot, [{ relativePath: "x.md", content: "first" }], true);

    const outcome = await writeFiles(destRoot, [{ relativePath: "x.md", content: "second" }], false);

    expect(outcome.refused).toEqual(["x.md"]);
    expect(await readFile(join(destRoot, "x.md"), "utf8")).toBe("first");
  });

  test("re-checks every target against the dest root", async () => {
    const destRoot = await makeTempDir();
    expect(() => resolveWithin(destRoot, "../escape.md")).toThrow(PathEscapeError);
  });
});

describe("file merge and diff preview", () => {
  test("deep-merges JSON fragments that share a path", () => {
    const merged = mergeMigratedFiles([
      { relativePath: "fragments/mcp-snippet.json", content: JSON.stringify({ mcp: { a: { type: "local" } } }) },
      { relativePath: "fragments/mcp-snippet.json", content: JSON.stringify({ mcp: { b: { type: "remote" } } }) },
    ]);

    expect(merged).toHaveLength(1);
    const parsed = JSON.parse(merged[0]?.content ?? "{}") as { mcp: Record<string, unknown> };
    expect(Object.keys(parsed.mcp)).toEqual(["a", "b"]);
  });

  test("unions arrays preserving base order and deduping the overlay", () => {
    expect(deepMerge(["a", "b"], ["b", "c"])).toEqual(["a", "b", "c"]);
    expect(deepMerge([{ id: 1 }], [{ id: 1 }, { id: 2 }])).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("keeps object deep-merge semantics alongside array union", () => {
    const merged = deepMerge(
      { instructions: ["keep"], nested: { a: 1 } },
      { instructions: ["migrated"], nested: { b: 2 } },
    );

    expect(merged).toEqual({ instructions: ["keep", "migrated"], nested: { a: 1, b: 2 } });
  });

  test("renders a diff with add/remove markers", () => {
    const diff = renderDiff("a\nb\n", "a\nc\n", "--- preview");

    expect(diff).toContain("--- preview");
    expect(diff).toContain("-b");
    expect(diff).toContain("+c");
    expect(renderDiff(undefined, "new", "--- new")).toContain("(new file)");
  });
});

describe("opencode.json merge", () => {
  test("deep-merges into an existing config preserving unrelated keys", async () => {
    const destRoot = await makeTempDir();
    const existing = {
      $schema: "https://opencode.ai/config.json",
      tui: { theme: "dark" },
      plugin: ["subtask2"],
      provider: { keep: { npm: "x" } },
    };
    await writeFile(join(destRoot, "opencode.json"), JSON.stringify(existing, null, 2), "utf8");

    await mergeJsonInto(destRoot, "opencode.json", {
      $schema: "https://opencode.ai/config.json",
      instructions: ["instructions/*.md"],
      provider: { added: { npm: "y" } },
    });

    const merged = JSON.parse(await readFile(join(destRoot, "opencode.json"), "utf8")) as {
      tui: { theme: string };
      plugin: string[];
      provider: Record<string, unknown>;
      instructions: string[];
    };
    expect(merged.tui.theme).toBe("dark");
    expect(merged.plugin).toEqual(["subtask2"]);
    expect(Object.keys(merged.provider).sort()).toEqual(["added", "keep"]);
    expect(merged.instructions).toEqual(["instructions/*.md"]);
    expect(await readdir(destRoot)).toEqual(["opencode.json"]);
  });

  test("preserves pre-existing instructions entries and appends the migrated ones deduped", async () => {
    const destRoot = await makeTempDir();
    const existing = {
      $schema: "https://opencode.ai/config.json",
      instructions: ["~/.config/opencode/custom.md", "~/.config/opencode/instructions/*.md"],
    };
    await writeFile(join(destRoot, "opencode.json"), JSON.stringify(existing, null, 2), "utf8");

    await mergeJsonInto(destRoot, "opencode.json", {
      instructions: ["~/.config/opencode/instructions/*.md", "~/.config/opencode/migrated.md"],
    });

    const merged = JSON.parse(await readFile(join(destRoot, "opencode.json"), "utf8")) as {
      instructions: string[];
    };
    expect(merged.instructions).toEqual([
      "~/.config/opencode/custom.md",
      "~/.config/opencode/instructions/*.md",
      "~/.config/opencode/migrated.md",
    ]);
  });

  test("writes a fresh config when opencode.json is absent", async () => {
    const destRoot = await makeTempDir();

    await mergeJsonInto(destRoot, "opencode.json", { $schema: "https://opencode.ai/config.json" });

    const parsed = JSON.parse(await readFile(join(destRoot, "opencode.json"), "utf8")) as {
      $schema: string;
    };
    expect(parsed.$schema).toBe("https://opencode.ai/config.json");
  });

  test("detects differing provider/mcp ids and ignores additive or equal ones", () => {
    const existing = {
      provider: { clash: { name: "A" }, keep: { name: "K" } },
      mcp: { same: { url: "u" } },
    };
    const patch = {
      provider: { clash: { name: "B" }, added: { name: "N" } },
      mcp: { same: { url: "u" }, added: { url: "v" } },
    };

    expect(detectConfigCollisions(existing, patch)).toEqual([
      { section: ConfigSection.Provider, key: "clash" },
    ]);
  });

  test("builds an opencode.json patch from the generated fragments", () => {
    const patch = buildOpenCodeConfigPatch([
      { relativePath: "fragments/instructions-snippet.json", content: JSON.stringify([".opencode/instructions/*.md"]) },
      { relativePath: "fragments/mcp-snippet.json", content: JSON.stringify({ mcp: { a: { type: "local" } } }) },
      {
        relativePath: "fragments/opencode-provider.fragment.json",
        content: JSON.stringify({ provider: { p: { npm: "x" } } }),
      },
    ]);

    expect(patch.$schema).toBe("https://opencode.ai/config.json");
    expect(patch.instructions).toEqual([".opencode/instructions/*.md"]);
    expect(patch.mcp).toEqual({ a: { type: "local" } });
    expect(patch.provider).toEqual({ p: { npm: "x" } });
  });
});
