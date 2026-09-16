import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ParsedCopilotArtifact } from "../src/domain/copilot-artifact";
import {
  AgentReferenceIndex,
  AgentReferenceResolution,
  rewriteAgentReference,
} from "../src/transform/reference-index";

function agentArtifact(relativePath: string): ParsedCopilotArtifact {
  return {
    inventory: { family: ArtifactFamily.Agent, absolutePath: relativePath, relativePath, sha: "x" },
    frontmatter: {},
    body: "",
  };
}

function buildIndex(paths: readonly string[]): AgentReferenceIndex {
  return new AgentReferenceIndex(paths.map(agentArtifact));
}

describe("AgentReferenceIndex", () => {
  test("resolves a unique basename to the namespaced id", () => {
    const index = buildIndex(["common/agents/jira-reviewer.agent.md"]);

    const result = index.resolve("jira-reviewer");

    expect(result.resolution).toBe(AgentReferenceResolution.Resolved);
    expect(result.id).toBe("common/jira-reviewer");
    expect(result.candidates).toEqual([]);
  });

  test("keeps a classic agent id bare", () => {
    const index = buildIndex([".github/agents/example.agent.md"]);

    expect(index.resolve("example").id).toBe("example");
  });

  test("reports Ambiguous with both candidates when two teams share a basename", () => {
    const index = buildIndex([
      "common/agents/jira-reviewer.agent.md",
      "neo/agents/jira-reviewer.agent.md",
    ]);

    const result = index.resolve("jira-reviewer");

    expect(result.resolution).toBe(AgentReferenceResolution.Ambiguous);
    expect(result.id).toBe("jira-reviewer");
    expect(result.candidates).toEqual(["common/jira-reviewer", "neo/jira-reviewer"]);
  });

  test("reports Unknown and keeps the verbatim reference", () => {
    const index = buildIndex(["common/agents/jira-reviewer.agent.md"]);

    const result = index.resolve("ghost");

    expect(result.resolution).toBe(AgentReferenceResolution.Unknown);
    expect(result.id).toBe("ghost");
    expect(result.candidates).toEqual([]);
  });
});

describe("rewriteAgentReference", () => {
  test("returns the resolved namespaced id without a row", () => {
    const index = buildIndex(["common/agents/jira-reviewer.agent.md"]);

    const outcome = rewriteAgentReference(index, "jira-reviewer", ArtifactFamily.Prompt, "p.prompt.md");

    expect(outcome.reference).toBe("common/jira-reviewer");
    expect(outcome.rows).toEqual([]);
  });

  test("keeps the verbatim reference and emits an UNKNOWN_AGENT_REF warning", () => {
    const index = buildIndex([]);

    const outcome = rewriteAgentReference(index, "ghost", ArtifactFamily.Prompt, "p.prompt.md");

    expect(outcome.reference).toBe("ghost");
    expect(outcome.rows).toHaveLength(1);
    expect(outcome.rows[0]?.message).toContain("UNKNOWN_AGENT_REF:");
  });

  test("flags an ambiguous reference with its candidates", () => {
    const index = buildIndex(["common/agents/x.agent.md", "neo/agents/x.agent.md"]);

    const outcome = rewriteAgentReference(index, "x", ArtifactFamily.Agent, "a.agent.md");

    expect(outcome.reference).toBe("x");
    expect(outcome.rows[0]?.message).toContain("AMBIGUOUS_AGENT_REF:");
    expect(outcome.rows[0]?.message).toContain("common/x");
    expect(outcome.rows[0]?.message).toContain("neo/x");
  });

  test("does nothing without an index", () => {
    const outcome = rewriteAgentReference(undefined, "ghost", ArtifactFamily.Prompt, "p.prompt.md");

    expect(outcome.reference).toBe("ghost");
    expect(outcome.rows).toEqual([]);
  });
});
