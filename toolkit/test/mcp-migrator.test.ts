import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ParsedCopilotArtifact } from "../src/domain/copilot-artifact";
import { ReportCode, ReportSeverity } from "../src/domain/report";
import { McpMigrator } from "../src/transform/mcp-migrator";
import { mergeEnvVars, renderEnvExample } from "../src/write/env-example";

const FIXTURES = join(import.meta.dirname, "fixtures");
const WORKSPACE = join(FIXTURES, "copilot");
const DEST_ROOT = join(import.meta.dirname, "tmp-dest");

function mcpArtifact(absolutePath: string, relativePath: string): ParsedCopilotArtifact {
  return {
    inventory: { family: ArtifactFamily.Mcp, absolutePath, relativePath, sha: "x" },
    frontmatter: {},
    body: "",
  };
}

describe("env example", () => {
  test("merges duplicate env vars exactly once and renders placeholders", () => {
    const merged = mergeEnvVars([
      [
        { name: "B_TOKEN", consumer: "mcp:example" },
        { name: "A_KEY", consumer: "mcp:example" },
      ],
      [{ name: "B_TOKEN", consumer: "provider:azure" }],
    ]);

    expect(merged.map((reference) => reference.name)).toEqual(["A_KEY", "B_TOKEN"]);
    expect(merged[1]?.consumer).toBe("mcp:example, provider:azure");

    const rendered = renderEnvExample(merged);
    expect(rendered).toContain("A_KEY=");
    expect(rendered).toContain("# consumer: mcp:example, provider:azure");
    expect((rendered.match(/B_TOKEN=/g) ?? []).length).toBe(1);
  });
});

describe("McpMigrator", () => {
  test("maps servers to a disabled mcp fragment and normalizes input references", async () => {
    const artifact = mcpArtifact(join(WORKSPACE, ".vscode", "mcp.json"), ".vscode/mcp.json");

    const result = await new McpMigrator().transform(artifact, { destRoot: DEST_ROOT });
    const fragment = JSON.parse(result.files[0]?.content ?? "{}") as {
      mcp: Record<string, { type: string; command: string[]; enabled: boolean; environment: Record<string, string> }>;
    };

    expect(result.files[0]?.relativePath).toBe("fragments/mcp-snippet.json");
    expect(fragment.mcp.example?.type).toBe("local");
    expect(fragment.mcp.example?.command).toEqual(["npx", "-y", "@example/mcp-server"]);
    expect(fragment.mcp.example?.enabled).toBe(false);
    expect(fragment.mcp.example?.environment.API_TOKEN).toBe("{env:TOKEN}");
    expect(result.files[0]?.content).not.toContain("${");
    expect(result.envVars).toEqual([{ name: "TOKEN", consumer: "mcp:example" }]);
  });

  test("rewrites Copilot ${env:VAR} references to OpenCode {env:VAR}", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolkit-mcp-env-"));
    const file = join(dir, "mcp.json");
    await writeFile(
      file,
      JSON.stringify({ servers: { gh: { command: "node", env: { GITHUB_TOKEN: "${env:GITHUB_TOKEN}" } } } }),
    );

    const result = await new McpMigrator().transform(mcpArtifact(file, ".vscode/mcp.json"), {
      destRoot: DEST_ROOT,
    });
    const output = result.files[0]?.content ?? "";
    const fragment = JSON.parse(output) as {
      mcp: Record<string, { environment: Record<string, string> }>;
    };

    expect(fragment.mcp.gh?.environment.GITHUB_TOKEN).toBe("{env:GITHUB_TOKEN}");
    expect(output).not.toContain("${env:");
    expect(output).not.toContain("${");
    await rm(dir, { recursive: true, force: true });
  });

  test("forces plaintext env secrets behind {env:VAR} and warns", async () => {
    const plaintext = ["sk", "plaintextfixturevalue", "000"].join("-");
    const dir = await mkdtemp(join(tmpdir(), "toolkit-mcp-"));
    const file = join(dir, "mcp.json");
    await writeFile(file, JSON.stringify({ servers: { sec: { command: "node", env: { KEY: plaintext } } } }));

    const result = await new McpMigrator().transform(mcpArtifact(file, ".vscode/mcp.json"), {
      destRoot: DEST_ROOT,
    });
    const fragment = JSON.parse(result.files[0]?.content ?? "{}") as {
      mcp: Record<string, { environment: Record<string, string> }>;
    };

    expect(fragment.mcp.sec?.environment.KEY).toBe("{env:SEC_KEY}");
    expect(result.rows.some((row) => row.code === ReportCode.SecretNormalized)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("strips embedded url credentials and surfaces a warning", async () => {
    const dir = await mkdtemp(join(tmpdir(), "toolkit-mcp-creds-"));
    const file = join(dir, "mcp.json");
    await writeFile(
      file,
      JSON.stringify({ servers: { risky: { url: "https://user:s3cret@example.com/mcp" } } }),
    );

    const result = await new McpMigrator().transform(mcpArtifact(file, ".vscode/mcp.json"), {
      destRoot: DEST_ROOT,
    });
    const output = result.files[0]?.content ?? "";
    const fragment = JSON.parse(output) as { mcp: Record<string, { url: string }> };

    expect(fragment.mcp.risky?.url).toBe("https://example.com/mcp");
    expect(output).not.toContain("s3cret");
    expect(output).not.toContain("user:");
    expect(result.warnings.some((warning) => warning.includes("EMBEDDED_CREDENTIALS"))).toBe(true);
    expect(result.rows.some((row) => row.code === ReportCode.SecretNormalized)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("rejects unstrippable url credentials with manual review and no fragment entry", async () => {
    const serverName = "blocked";
    const unstrippableUrl = "https://user:s3cret@host:8080@evil.com/mcp";
    const dir = await mkdtemp(join(tmpdir(), "toolkit-mcp-unstrippable-"));
    const file = join(dir, "mcp.json");
    await writeFile(file, JSON.stringify({ servers: { [serverName]: { url: unstrippableUrl } } }));

    const result = await new McpMigrator().transform(mcpArtifact(file, ".vscode/mcp.json"), {
      destRoot: DEST_ROOT,
    });
    const fragment = JSON.parse(result.files[0]?.content ?? "{}") as {
      mcp: Record<string, { url: string }>;
    };
    const reviewRow = result.rows.find((row) => row.code === ReportCode.ManualReview);

    expect(fragment.mcp[serverName]).toBeUndefined();
    expect(reviewRow?.severity).toBe(ReportSeverity.Error);
    expect(reviewRow?.source).toBe(serverName);
    expect(result.warnings.some((warning) => warning.includes("fragment rejected"))).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});
