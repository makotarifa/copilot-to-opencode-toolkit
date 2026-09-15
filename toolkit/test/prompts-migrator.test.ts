import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { PromptPattern } from "../src/domain/prompt-pattern";
import { ReportCode } from "../src/domain/report";
import { ModelCatalog } from "../src/model/model-catalog";
import { createModelResolver } from "../src/model/model-resolver";
import { PromptsMigrator } from "../src/transform/prompts-migrator";
import { loadMarkdownArtifact } from "./helpers/artifact";

const FIXTURES = join(import.meta.dirname, "fixtures");
const TEAMS_WORKSPACE = join(FIXTURES, "copilot-teams");
const DEST_ROOT = join(import.meta.dirname, "tmp-dest");

const models = createModelResolver({
  catalog: new ModelCatalog(["litellm/litellm-default", "litellm/litellm-builder"]),
  map: {
    "gpt-4o": "litellm/litellm-default",
    "claude-3.5-sonnet": "litellm/litellm-builder",
  },
});

async function loadReviewPrompt() {
  return loadMarkdownArtifact(
    join(FIXTURES, "copilot"),
    ".github/prompts/review.prompt.md",
    ArtifactFamily.Prompt,
  );
}

describe("PromptsMigrator", () => {
  test("defaults to pattern B delegation and converts argument-hint to a Usage block", async () => {
    const artifact = await loadReviewPrompt();

    const result = await new PromptsMigrator().transform(artifact, { destRoot: DEST_ROOT });
    const file = result.files[0];

    expect(file?.relativePath).toBe("commands/review.md");
    expect(file?.content).toContain("agent: agent");
    expect(file?.content).not.toContain("subtask: true");
    expect(file?.content).toContain("## Usage");
    expect(file?.content).toContain("/review <file>");
    expect(file?.content).toContain("## Delegation");
    expect(file?.content).toContain('agent="agent"');
    expect(file?.content).toContain("## OpenCode notes");
  });

  test("namespaces a prompt by its source team", async () => {
    const artifact = await loadMarkdownArtifact(
      TEAMS_WORKSPACE,
      "common/prompts/jira-review.prompt.md",
      ArtifactFamily.Prompt,
    );

    const result = await new PromptsMigrator().transform(artifact, { destRoot: DEST_ROOT });

    expect(result.files[0]?.relativePath).toBe("commands/common/jira-review.md");
  });

  test("keeps a root-level prompt flat", async () => {
    const artifact = await loadMarkdownArtifact(
      join(FIXTURES, "copilot"),
      ".github/prompts/review.prompt.md",
      ArtifactFamily.Prompt,
    );

    const result = await new PromptsMigrator().transform(artifact, { destRoot: DEST_ROOT });

    expect(result.files[0]?.relativePath).toBe("commands/review.md");
  });

  test("pattern A emits subtask: true in frontmatter instead of a delegation block", async () => {
    const artifact = await loadReviewPrompt();

    const result = await new PromptsMigrator().transform(artifact, {
      destRoot: DEST_ROOT,
      promptPattern: PromptPattern.PatternA,
    });
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("subtask: true");
    expect(content).not.toContain("## Delegation");
    expect(content).toContain("A (`subtask: true`)");
  });

  test("resolves prompt models and preserves the original array in notes", async () => {
    const artifact = await loadMarkdownArtifact(
      join(FIXTURES, "copilot"),
      ".github/prompts/model.prompt.md",
      ArtifactFamily.Prompt,
    );

    const result = await new PromptsMigrator().transform(artifact, { destRoot: DEST_ROOT, models });
    const content = result.files[0]?.content ?? "";

    expect(content).toContain("model: litellm/litellm-default");
    expect(content).toContain("Model (original): `[gpt-4o, claude-3.5-sonnet]`");
    expect(result.rows.some((row) => row.code === ReportCode.ModelFallback)).toBe(true);
  });
});
