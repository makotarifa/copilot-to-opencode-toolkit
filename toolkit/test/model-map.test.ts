import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createModelCatalog, ModelCatalog, readOpenCodeCatalogIds } from "../src/model/model-catalog";
import {
  createMapSourceLookup,
  loadModelMap,
  lookupModelMap,
  mergeModelMaps,
  persistModelMapEntry,
} from "../src/model/model-map";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toolkit-model-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("model map", () => {
  test("loads, case-insensitively looks up, merges and persists entries", async () => {
    const dir = await makeTempDir();
    const mapPath = join(dir, "model-map.json");

    expect(await loadModelMap(mapPath)).toEqual({});

    await persistModelMapEntry(mapPath, {
      copilotModel: "gpt-4o",
      opencodeModelId: "litellm/litellm-default",
    });
    await persistModelMapEntry(mapPath, {
      copilotModel: "o1",
      opencodeModelId: "litellm/litellm-planner",
    });

    const map = await loadModelMap(mapPath);
    expect(lookupModelMap(map, "GPT-4O")).toBe("litellm/litellm-default");
    expect(mergeModelMaps(map, { o1: "litellm/litellm-big-planner" }).o1).toBe(
      "litellm/litellm-big-planner",
    );

    const written = JSON.parse(await readFile(mapPath, "utf8")) as Record<string, string>;
    expect(Object.keys(written)).toEqual(["gpt-4o", "o1"]);
  });
});

describe("overlay precedence", () => {
  test("lets an overlay key that differs only by case win over the base", () => {
    const base = { "GPT-4O": "litellm/litellm-default" };
    const overlay = { "gpt-4o": "litellm/litellm-builder" };
    const merged = mergeModelMaps(base, overlay);
    const lookup = createMapSourceLookup(base, "model-map.json", overlay, "--model-map overlay.json");

    expect(lookupModelMap(merged, "gpt-4o")).toBe("litellm/litellm-builder");
    expect(lookup("gpt-4o")).toBe("--model-map overlay.json");
  });
});

describe("map source lookup", () => {
  test("attributes an overriding key to the overlay label", () => {
    const lookup = createMapSourceLookup(
      { "gpt-4o": "litellm/litellm-default" },
      "model-map.json",
      { "gpt-4o": "litellm/litellm-builder" },
      "--model-map overlay.json",
    );

    expect(lookup("GPT-4O")).toBe("--model-map overlay.json");
  });

  test("falls back to the base label and reports unknown keys as undefined", () => {
    const lookup = createMapSourceLookup(
      { "gpt-4o": "litellm/litellm-default" },
      "model-map.json",
      {},
      "--model-map overlay.json",
    );

    expect(lookup("gpt-4o")).toBe("model-map.json");
    expect(lookup("unknown")).toBeUndefined();
  });
});

describe("model catalog", () => {
  test("merges seeded ids with ids discovered from the OpenCode agents and config", async () => {
    const opencodeRoot = await makeTempDir();
    await mkdir(join(opencodeRoot, "agents"), { recursive: true });
    await writeFile(
      join(opencodeRoot, "agents", "a.md"),
      "---\nmodel: litellm/litellm-orchestrator\n---\nBody\n",
    );
    await writeFile(
      join(opencodeRoot, "opencode.json"),
      JSON.stringify({ agent: { x: { model: "litellm/custom-id" } } }),
    );

    const discovered = await readOpenCodeCatalogIds(opencodeRoot);
    expect(discovered).toContain("litellm/litellm-orchestrator");
    expect(discovered).toContain("litellm/custom-id");

    const catalog = await createModelCatalog({ opencodeRoot, extraIds: ["litellm/extra"] });
    expect(catalog.has("litellm/litellm-default")).toBe(true);
    expect(catalog.has("litellm/custom-id")).toBe(true);
    expect(catalog.has("litellm/extra")).toBe(true);
    expect(catalog.all()).toEqual([...catalog.all()].sort());
  });

  test("returns an empty discovery when the OpenCode root does not exist", async () => {
    expect(await readOpenCodeCatalogIds("/nonexistent/opencode/root")).toEqual([]);
    expect(new ModelCatalog([" b ", "a", "a", ""]).all()).toEqual(["a", "b"]);
  });
});
