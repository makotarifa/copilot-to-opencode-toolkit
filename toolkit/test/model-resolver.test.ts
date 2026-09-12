import { describe, expect, test, vi } from "vitest";

import { ModelCatalog } from "../src/model/model-catalog";
import { createMapSourceLookup, mergeModelMaps } from "../src/model/model-map";
import {
  ModelResolutionOptions,
  ModelResolutionSource,
  ModelResolutionStatus,
  resolveModelValue,
} from "../src/model/model-resolver";

const CATALOG = new ModelCatalog(["litellm/litellm-default", "litellm/litellm-builder"]);
const MAP = {
  "gpt-4o": "litellm/litellm-default",
  "claude-3.5-sonnet": "litellm/litellm-builder",
};

function options(overrides: Partial<ModelResolutionOptions> = {}): ModelResolutionOptions {
  return { map: MAP, catalog: CATALOG, ...overrides };
}

describe("resolveModelValue", () => {
  test("resolves an exact map entry case-insensitively", async () => {
    const result = await resolveModelValue("GPT-4o", options());

    expect(result.status).toBe(ModelResolutionStatus.Resolved);
    expect(result.resolved).toBe("litellm/litellm-default");
    expect(result.source).toBe(ModelResolutionSource.Map);
    expect(result.warnings).toEqual([]);
  });

  test("collapses a model array to the first mappable member and keeps the original", async () => {
    const result = await resolveModelValue(["gpt-4o", "claude-3.5-sonnet"], options());

    expect(result.resolved).toBe("litellm/litellm-default");
    expect(result.remainingMembers).toEqual(["claude-3.5-sonnet"]);
    expect(result.originalValue).toEqual(["gpt-4o", "claude-3.5-sonnet"]);
    expect(result.warnings[0]).toContain("MODEL_FALLBACK");
  });

  test("resolves a later mappable member and records the skipped unmapped member", async () => {
    const result = await resolveModelValue(["unknown-name", "gpt-4o"], options());

    expect(result.status).toBe(ModelResolutionStatus.Resolved);
    expect(result.resolved).toBe("litellm/litellm-default");
    expect(result.remainingMembers).toEqual(["unknown-name"]);
    expect(result.originalValue).toEqual(["unknown-name", "gpt-4o"]);
    expect(result.warnings.some((warning) => warning.includes("UNMAPPED_MODEL"))).toBe(false);
  });

  test("resolves a value already present in the catalog directly", async () => {
    const result = await resolveModelValue("litellm/litellm-builder", options());

    expect(result.source).toBe(ModelResolutionSource.Direct);
    expect(result.resolved).toBe("litellm/litellm-builder");
    expect(result.mappedFrom).toBeUndefined();
  });

  test("records the map provenance when resolving via the map", async () => {
    const result = await resolveModelValue(
      "gpt-4o",
      options({ mapSource: () => "--model-map custom.json" }),
    );

    expect(result.mappedFrom).toEqual({
      original: "gpt-4o",
      dest: "litellm/litellm-default",
      mapSource: "--model-map custom.json",
    });
  });

  test("defaults the map source to the built-in model-map.json", async () => {
    const result = await resolveModelValue("gpt-4o", options());

    expect(result.mappedFrom?.mapSource).toBe("model-map.json");
  });

  test("reports unmapped models when no interactive prompt is available", async () => {
    const result = await resolveModelValue("totally-unknown-model", options());

    expect(result.status).toBe(ModelResolutionStatus.Unmapped);
    expect(result.resolved).toBeUndefined();
    expect(result.warnings[0]).toContain("UNMAPPED_MODEL");
  });

  test("records the map provenance of the first mappable array member", async () => {
    const result = await resolveModelValue(["unknown", "gpt-4o"], options());

    expect(result.mappedFrom?.original).toBe("gpt-4o");
    expect(result.warnings.some((warning) => warning.includes("MODEL_FALLBACK"))).toBe(true);
  });

  test("flags stale map entries that are absent from the catalog", async () => {
    const result = await resolveModelValue("gpt-4o", options({ map: { "gpt-4o": "litellm/gone" } }));

    expect(result.status).toBe(ModelResolutionStatus.Stale);
    expect(result.warnings[0]).toContain("STALE_MODEL_ID");
    expect(result.warnings[0]).toContain("model-map.json");
  });

  test("attributes a stale map entry to the actual map source", async () => {
    const result = await resolveModelValue(
      "gpt-4o",
      options({ map: { "gpt-4o": "litellm/gone" }, mapSource: () => "--model-map overlay.json" }),
    );

    expect(result.status).toBe(ModelResolutionStatus.Stale);
    expect(result.warnings[0]).toContain("--model-map overlay.json");
    expect(result.warnings[0]).not.toContain("model-map.json");
  });

  test("interactively resolves unknown models and offers persistence", async () => {
    const interactive = {
      chooseModel: vi.fn(async () => "litellm/litellm-builder"),
      confirmPersist: vi.fn(async () => true),
    };

    const result = await resolveModelValue("mystery-model", options({ interactive }));

    expect(result.resolved).toBe("litellm/litellm-builder");
    expect(result.source).toBe(ModelResolutionSource.Interactive);
    expect(result.persist).toEqual({
      copilotModel: "mystery-model",
      opencodeModelId: "litellm/litellm-builder",
    });
  });

  test("interactively re-maps stale ids", async () => {
    const interactive = {
      chooseModel: vi.fn(async () => "litellm/litellm-default"),
      confirmPersist: vi.fn(async () => false),
    };

    const result = await resolveModelValue("gpt-4o", options({ map: { "gpt-4o": "litellm/gone" }, interactive }));

    expect(result.status).toBe(ModelResolutionStatus.Resolved);
    expect(result.resolved).toBe("litellm/litellm-default");
    expect(result.persist).toBeUndefined();
  });

  test("returns not-set when no model is declared", async () => {
    const result = await resolveModelValue(undefined, options());

    expect(result.status).toBe(ModelResolutionStatus.NotSet);
    expect(result.originalMembers).toEqual([]);
  });

  test("resolves the overlay value end to end when base and overlay differ by case", async () => {
    const base = { "GPT-4O": "litellm/litellm-default" };
    const overlay = { "gpt-4o": "litellm/litellm-builder" };
    const merged = mergeModelMaps(base, overlay);
    const mapSource = createMapSourceLookup(base, "model-map.json", overlay, "--model-map overlay.json");

    const result = await resolveModelValue("gpt-4o", { map: merged, catalog: CATALOG, mapSource });

    expect(result.resolved).toBe("litellm/litellm-builder");
    expect(result.mappedFrom?.mapSource).toBe("--model-map overlay.json");
  });
});
