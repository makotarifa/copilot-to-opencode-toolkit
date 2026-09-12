import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ReportCode, ReportSeverity } from "../src/domain/report";
import { ModelCatalog } from "../src/model/model-catalog";
import { modelResultRows } from "../src/model/model-report";
import { resolveModelValue } from "../src/model/model-resolver";

const CATALOG = new ModelCatalog(["litellm/litellm-default"]);
const SOURCE = "agents/example.agent.md";

describe("modelResultRows", () => {
  test("emits MODEL_MAPPED with original, destination and map source", async () => {
    const result = await resolveModelValue("gpt-4o", {
      map: { "gpt-4o": "litellm/litellm-default" },
      catalog: CATALOG,
      mapSource: () => "--model-map custom.json",
    });

    const mapped = modelResultRows(result, ArtifactFamily.Agent, SOURCE).find(
      (row) => row.code === ReportCode.ModelMapped,
    );

    expect(mapped?.severity).toBe(ReportSeverity.Info);
    expect(mapped?.source).toBe(SOURCE);
    expect(mapped?.message).toContain("`gpt-4o`");
    expect(mapped?.message).toContain("→");
    expect(mapped?.message).toContain("`litellm/litellm-default`");
    expect(mapped?.message).toContain("--model-map custom.json");
  });

  test("defaults the source label to model-map.json", async () => {
    const result = await resolveModelValue("gpt-4o", {
      map: { "gpt-4o": "litellm/litellm-default" },
      catalog: CATALOG,
    });

    const mapped = modelResultRows(result, ArtifactFamily.Agent, SOURCE).find(
      (row) => row.code === ReportCode.ModelMapped,
    );

    expect(mapped?.message).toContain("model-map.json");
  });

  test("stays silent for a pass-through catalog id", async () => {
    const result = await resolveModelValue("litellm/litellm-default", { map: {}, catalog: CATALOG });

    const rows = modelResultRows(result, ArtifactFamily.Agent, SOURCE);

    expect(rows.some((row) => row.code === ReportCode.ModelMapped)).toBe(false);
  });

  test("emits exactly one MODEL_MAPPED alongside MODEL_FALLBACK for a collapsed array", async () => {
    const result = await resolveModelValue(["unknown", "gpt-4o"], {
      map: { "gpt-4o": "litellm/litellm-default" },
      catalog: CATALOG,
    });

    const rows = modelResultRows(result, ArtifactFamily.Agent, SOURCE);
    const mapped = rows.filter((row) => row.code === ReportCode.ModelMapped);

    expect(mapped).toHaveLength(1);
    expect(mapped[0]?.message).toContain("`gpt-4o`");
    expect(rows.some((row) => row.code === ReportCode.ModelFallback)).toBe(true);
  });

  test("stays silent for an interactively resolved model", async () => {
    const interactive = {
      chooseModel: async () => "litellm/litellm-default",
      confirmPersist: async () => false,
    };
    const result = await resolveModelValue("mystery-model", { map: {}, catalog: CATALOG, interactive });

    const rows = modelResultRows(result, ArtifactFamily.Agent, SOURCE);

    expect(rows.some((row) => row.code === ReportCode.ModelMapped)).toBe(false);
  });

  test("keeps emitting STALE_MODEL_ID for a map entry absent from the catalog", async () => {
    const result = await resolveModelValue("gpt-4o", {
      map: { "gpt-4o": "litellm/gone" },
      catalog: CATALOG,
    });

    const rows = modelResultRows(result, ArtifactFamily.Agent, SOURCE);

    expect(rows.some((row) => row.code === ReportCode.StaleModelId)).toBe(true);
  });
});
