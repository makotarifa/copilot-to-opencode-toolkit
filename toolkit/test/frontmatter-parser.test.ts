import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  getRecordArray,
  getString,
  getStringArray,
  toStringArray,
} from "../src/parse/frontmatter-values";
import {
  parseFrontmatterFile,
  parseFrontmatterText,
  parseStructuredDocument,
  parseStructuredText,
} from "../src/parse/frontmatter-parser";

const FIXTURES = join(import.meta.dirname, "fixtures");

describe("frontmatter parsing", () => {
  test("parses YAML frontmatter and preserves the body verbatim", async () => {
    const parsed = await parseFrontmatterFile(
      join(FIXTURES, "copilot", ".github", "agents", "example.agent.md"),
    );

    expect(getString(parsed.frontmatter, "description")).toBe("Example custom agent");
    expect(getStringArray(parsed.frontmatter, "model")).toEqual([
      "gpt-4o",
      "claude-3.5-sonnet",
    ]);
    expect(getStringArray(parsed.frontmatter, "tools")).toEqual(["codebase", "editFiles"]);
    expect(parsed.body).toContain("You are an example agent.");
    expect(parsed.body).not.toContain("---");
  });

  test("parses handoff records", async () => {
    const parsed = await parseFrontmatterFile(
      join(FIXTURES, "copilot", ".github", "agents", "example.agent.md"),
    );
    const handoffs = getRecordArray(parsed.frontmatter, "handoffs");

    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]?.agent).toBe("reviewer");
  });

  test("returns an empty frontmatter when the file has none", () => {
    const parsed = parseFrontmatterText("# Title\n\nBody\n");

    expect(parsed.frontmatter).toEqual({});
    expect(parsed.body).toBe("# Title\n\nBody\n");
  });

  test("falls back to a lenient scan when YAML frontmatter is malformed", () => {
    const parsed = parseFrontmatterText(
      "---\ndescription: Uses colons: like this\nmodel: [a, b]\n---\nBody\n",
    );

    expect(parsed.frontmatter.description).toContain("Uses colons");
    expect(parsed.frontmatter.model).toEqual(["a", "b"]);
    expect(parsed.body).toBe("Body\n");
  });

  test("surfaces the lenient fallback with the dropped lines", () => {
    const parsed = parseFrontmatterText(
      "---\ndescription: Uses colons: like this\nthis line is dropped\nmodel: [a, b]\n---\nBody\n",
    );

    expect(parsed.parseNotice?.droppedLines).toContain("this line is dropped");
  });

  test("does not flag well-formed frontmatter", () => {
    const parsed = parseFrontmatterText("---\ndescription: Fine\nmodel: [a, b]\n---\nBody\n");

    expect(parsed.parseNotice).toBeUndefined();
  });
});

describe("structured document parsing", () => {
  test("parses JSON documents", async () => {
    const document = await parseStructuredDocument(
      join(FIXTURES, "copilot", ".vscode", "mcp.json"),
    );

    expect(document).toHaveProperty("servers");
  });

  test("parses JSONC documents with comments", () => {
    const parsed = parseStructuredText('{\n  // a comment\n  "enabled": true\n}\n');

    expect(parsed).toEqual({ enabled: true });
  });

  test("toStringArray accepts a single string or an array", () => {
    expect(toStringArray("gpt-4o")).toEqual(["gpt-4o"]);
    expect(toStringArray(["a", 1, "b"])).toEqual(["a", "b"]);
    expect(toStringArray(undefined)).toEqual([]);
  });
});
