import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ParsedCopilotArtifact } from "../src/domain/copilot-artifact";
import { ReportCode } from "../src/domain/report";
import { isPlaintextProviderKey } from "../src/safety/secret-scanner";
import { buildProviderFragment, ProviderMigrator } from "../src/transform/provider-migrator";
import { mergeEnvVars, renderEnvExample } from "../src/write/env-example";

const FIXTURES = join(import.meta.dirname, "fixtures");
const WORKSPACE = join(FIXTURES, "copilot");
const DEST_ROOT = join(import.meta.dirname, "tmp-dest");
const PLAINTEXT_KEY = ["sk", "plaintextfixturekey", "0000"].join("-");

function providerArtifact(absolutePath: string): ParsedCopilotArtifact {
  return {
    inventory: {
      family: ArtifactFamily.Provider,
      absolutePath,
      relativePath: "user-model-config.json",
      sha: "x",
    },
    frontmatter: {},
    body: "",
  };
}

describe("ProviderMigrator", () => {
  test("emits a schema-exact provider fragment with {env:VAR} secrets", async () => {
    const artifact = providerArtifact(join(WORKSPACE, "user-model-config.json"));

    const result = await new ProviderMigrator().transform(artifact, { destRoot: DEST_ROOT });
    const fragment = JSON.parse(result.files[0]?.content ?? "{}") as {
      provider: Record<
        string,
        {
          npm: string;
          name: string;
          options: { baseURL: string; apiKey: string };
          models: Record<string, { name: string }>;
        }
      >;
    };

    expect(result.files[0]?.relativePath).toBe("fragments/opencode-provider.fragment.json");
    expect(fragment.provider.azure?.npm).toBe("@ai-sdk/openai-compatible");
    expect(fragment.provider.azure?.options.baseURL).toBe("https://example.openai.azure.com/");
    expect(fragment.provider.azure?.options.apiKey).toBe("{env:AZURE_OPENAI_API_KEY}");
    expect(fragment.provider.azure?.models["gpt-4o"]).toEqual({ name: "gpt-4o" });
    expect(result.envVars).toEqual([{ name: "AZURE_OPENAI_API_KEY", consumer: "provider:azure" }]);
    expect(result.files[0]?.content).not.toContain("sk-plaintext-fixture-key-not-real");
    expect(result.providerPreview?.providerId).toBe("azure");
  });

  test("normalizes a plaintext apiKey and strips embedded baseURL credentials", () => {
    const build = buildProviderFragment({
      providerType: "custom",
      baseURL: "https://user:pass@example.com/v1",
      apiKey: PLAINTEXT_KEY,
      models: [],
    });

    const provider = build.fragment.custom as { options: { baseURL: string; apiKey: string } };
    expect(provider.options.apiKey).toBe("{env:CUSTOM_API_KEY}");
    expect(provider.options.baseURL).toBe("https://example.com/v1");
    expect(build.rows.some((row) => row.code === ReportCode.SecretNormalized)).toBe(true);
  });

  test("merges provider and mcp env keys once in the shared .env.example", () => {
    const providerBuild = buildProviderFragment({ providerType: "azure", apiKeyEnvVar: "AZURE_OPENAI_API_KEY", models: [] });
    const merged = mergeEnvVars([
      providerBuild.envVars,
      [{ name: "AZURE_OPENAI_API_KEY", consumer: "mcp:example" }],
    ]);

    expect(merged).toHaveLength(1);
    const rendered = renderEnvExample(merged);
    expect((rendered.match(/AZURE_OPENAI_API_KEY=/g) ?? []).length).toBe(1);
    expect(rendered).not.toContain("sk-");
  });

  test("detects plaintext provider keys but accepts references", () => {
    expect(isPlaintextProviderKey(PLAINTEXT_KEY)).toBe(true);
    expect(isPlaintextProviderKey("{env:MY_KEY}")).toBe(false);
    expect(isPlaintextProviderKey(undefined)).toBe(false);
  });
});
