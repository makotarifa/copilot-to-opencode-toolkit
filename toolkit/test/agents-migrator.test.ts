import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ParsedCopilotArtifact } from "../src/domain/copilot-artifact";
import { ReportCode } from "../src/domain/report";
import { ModelCatalog } from "../src/model/model-catalog";
import { createModelResolver } from "../src/model/model-resolver";
import { AgentsMigrator } from "../src/transform/agents-migrator";
import { AgentReferenceIndex } from "../src/transform/reference-index";
import { loadMarkdownArtifact } from "./helpers/artifact";

const FIXTURES = join(import.meta.dirname, "fixtures");
const WORKSPACE = join(FIXTURES, "copilot");
const AGENT_MODES = join(FIXTURES, "agent-modes");
const TEAMS_WORKSPACE = join(FIXTURES, "copilot-teams");
const DEST_ROOT = join(import.meta.dirname, "tmp-dest");

const models = createModelResolver({
  catalog: new ModelCatalog(["litellm/litellm-default", "litellm/litellm-builder"]),
  map: {
    "gpt-4o": "litellm/litellm-default",
    "claude-3.5-sonnet": "litellm/litellm-builder",
  },
});

const CONTEXT = { destRoot: DEST_ROOT, models };

function agentArtifact(relativePath: string): ParsedCopilotArtifact {
  return {
    inventory: { family: ArtifactFamily.Agent, absolutePath: relativePath, relativePath, sha: "x" },
    frontmatter: {},
    body: "",
  };
}

describe("AgentsMigrator", () => {
  test("resolves the first mappable model and preserves the full original array in notes", async () => {
    const artifact = await loadMarkdownArtifact(
      WORKSPACE,
      ".github/agents/example.agent.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);
    const content = result.files[0]?.content ?? "";

    expect(result.files[0]?.relativePath).toBe("agents/example.md");
    expect(content).toContain("mode: primary");
    expect(content).toContain("model: litellm/litellm-default");
    expect(content).toContain("Model (original): `[gpt-4o, claude-3.5-sonnet]`");
    expect(content).toContain("Model fallback members: `claude-3.5-sonnet`");
    expect(content).toContain("## Handoffs");
    expect(content).toContain('agent="reviewer"');
    expect(content).toContain("## OpenCode notes");
    expect(result.rows.some((row) => row.code === ReportCode.ModelFallback)).toBe(true);
  });

  test("flags unmapped models while preserving the original value", async () => {
    const artifact = await loadMarkdownArtifact(
      WORKSPACE,
      ".github/agents/unknown-model.agent.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("Model (original): `totally-unknown-model`");
    expect(content).not.toContain("model: totally-unknown-model");
    expect(result.rows.some((row) => row.code === ReportCode.UnmappedModel)).toBe(true);
    expect(result.warnings.some((warning) => warning.includes("UNMAPPED_MODEL"))).toBe(true);
  });

  test("resolves a later mappable member and records the skipped member in notes", async () => {
    const artifact: ParsedCopilotArtifact = {
      inventory: {
        family: ArtifactFamily.Agent,
        absolutePath: "mixed.agent.md",
        relativePath: ".github/agents/mixed.agent.md",
        sha: "x",
      },
      frontmatter: { description: "Mixed", model: ["unknown-name", "gpt-4o"] },
      body: "Body\n",
    };

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("model: litellm/litellm-default");
    expect(content).toContain("Model (original): `[unknown-name, gpt-4o]`");
    expect(content).toContain("Model fallback members: `unknown-name`");
    expect(result.rows.some((row) => row.code === ReportCode.UnmappedModel)).toBe(false);
  });

  test("rewrites a handoff to the namespaced id when resolved", async () => {
    const artifact = await loadMarkdownArtifact(WORKSPACE, ".github/agents/example.agent.md", ArtifactFamily.Agent);
    const agentReferences = new AgentReferenceIndex([agentArtifact("common/agents/reviewer.agent.md")]);

    const result = await new AgentsMigrator().transform(artifact, { ...CONTEXT, agentReferences });
    const content = result.files[0]?.content ?? "";

    expect(content).toContain('agent="common/reviewer"');
    expect(result.rows.some((row) => row.code === ReportCode.ManualReview)).toBe(false);
  });

  test("keeps an ambiguous handoff verbatim and flags it", async () => {
    const artifact = await loadMarkdownArtifact(WORKSPACE, ".github/agents/example.agent.md", ArtifactFamily.Agent);
    const agentReferences = new AgentReferenceIndex([
      agentArtifact("common/agents/reviewer.agent.md"),
      agentArtifact("neo/agents/reviewer.agent.md"),
    ]);

    const result = await new AgentsMigrator().transform(artifact, { ...CONTEXT, agentReferences });
    const content = result.files[0]?.content ?? "";

    expect(content).toContain('agent="reviewer"');
    expect(
      result.rows.some(
        (row) => row.code === ReportCode.ManualReview && row.message.includes("AMBIGUOUS_AGENT_REF:"),
      ),
    ).toBe(true);
  });

  test("keeps a handoff without an agent and emits no delegation", async () => {
    const artifact: ParsedCopilotArtifact = {
      inventory: {
        family: ArtifactFamily.Agent,
        absolutePath: ".github/agents/agentless.agent.md",
        relativePath: ".github/agents/agentless.agent.md",
        sha: "x",
      },
      frontmatter: {
        description: "Agent with agentless handoffs",
        handoffs: [
          { label: "Missing agent", prompt: "First prompt." },
          { label: "Empty agent", agent: "", prompt: "Second prompt." },
        ],
      },
      body: "Body\n",
    };
    const agentReferences = new AgentReferenceIndex([agentArtifact("common/agents/reviewer.agent.md")]);

    const result = await new AgentsMigrator().transform(artifact, { ...CONTEXT, agentReferences });
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("## Handoffs");
    expect(content).toContain("Missing agent");
    expect(content).toContain("First prompt.");
    expect(content).toContain("Empty agent");
    expect(content).toContain("Second prompt.");
    expect(content).not.toContain('agent=""');
    expect(result.rows.some((row) => row.message.includes("UNKNOWN_AGENT_REF:"))).toBe(false);
    expect(result.rows.some((row) => row.code === ReportCode.ManualReview)).toBe(false);
  });

  test("namespaces an agent by its source team", async () => {
    const artifact = await loadMarkdownArtifact(
      TEAMS_WORKSPACE,
      "common/agents/java-backend-developer.agent.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);

    expect(result.files[0]?.relativePath).toBe("agents/common/java-backend-developer.md");
  });

  test("keeps a classic agent flat", async () => {
    const artifact = await loadMarkdownArtifact(
      WORKSPACE,
      ".github/agents/example.agent.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);

    expect(result.files[0]?.relativePath).toBe("agents/example.md");
  });

  test("aliases legacy chatmode files and records tool friction", async () => {
    const artifact = await loadMarkdownArtifact(
      WORKSPACE,
      ".github/agents/legacy.chatmode.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);
    const content = result.files[0]?.content ?? "";

    expect(result.files[0]?.relativePath).toBe("agents/legacy.md");
    expect(content).toContain("chatmode");
  });

  test("defaults to primary mode and documents the legacy infer field", async () => {
    const artifact = await loadMarkdownArtifact(
      AGENT_MODES,
      ".github/agents/infer-default.agent.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("mode: primary");
    expect(content).toContain("Mode: `primary` (default; `user-invocable` absent in source)");
    expect(content).toContain("infer: `true` — legacy Copilot field; no OpenCode equivalent");
    expect(content).not.toContain("disable-model-invocation:");
  });

  test("maps user-invocable false to subagent and only describes present fields", async () => {
    const artifact = await loadMarkdownArtifact(
      AGENT_MODES,
      ".github/agents/hidden.agent.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("mode: subagent");
    expect(content).toContain("Mode: `subagent` (from `user-invocable: false`)");
    expect(content).not.toContain("infer:");
  });

  test("documents disable-model-invocation without forcing subagent", async () => {
    const artifact = await loadMarkdownArtifact(
      AGENT_MODES,
      ".github/agents/model-invocation-off.agent.md",
      ArtifactFamily.Agent,
    );

    const result = await new AgentsMigrator().transform(artifact, CONTEXT);
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("mode: primary");
    expect(content).toContain(
      "disable-model-invocation: `true` — no OpenCode equivalent; preserved for manual review",
    );
  });
});
