import { readFile } from "node:fs/promises";

import matter from "gray-matter";
import { parse as parseYaml } from "yaml";

import { Frontmatter, FrontmatterParseNotice, FrontmatterValue } from "../domain/copilot-artifact";
import { parseJsonc } from "./jsonc";

export interface ParsedFrontmatterFile {
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly raw: string;
  readonly parseNotice?: FrontmatterParseNotice;
}

const FRONTMATTER_BLOCK_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
const FRONTMATTER_LINE_PATTERN = /^([A-Za-z0-9_-]+):\s*(.*)$/;
const QUOTE_TRIM_PATTERN = /^["']|["']$/g;

function parseLenientValue(value: string): FrontmatterValue {
  if (value.startsWith("[") && value.endsWith("]")) {
    return value
      .slice(1, -1)
      .split(",")
      .map((entry) => entry.trim().replace(QUOTE_TRIM_PATTERN, ""))
      .filter((entry) => entry.length > 0);
  }
  return value.replace(QUOTE_TRIM_PATTERN, "");
}

function parseLenientFrontmatter(raw: string): ParsedFrontmatterFile {
  const block = FRONTMATTER_BLOCK_PATTERN.exec(raw);
  if (block === null) {
    return { frontmatter: {}, body: raw, raw, parseNotice: { droppedLines: [] } };
  }
  const frontmatter: Frontmatter = {};
  const droppedLines: string[] = [];
  for (const line of (block[1] ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const match = FRONTMATTER_LINE_PATTERN.exec(trimmed);
    if (match === null) {
      droppedLines.push(trimmed);
      continue;
    }
    frontmatter[match[1] ?? ""] = parseLenientValue((match[2] ?? "").trim());
  }
  return { frontmatter, body: raw.slice(block[0].length), raw, parseNotice: { droppedLines } };
}

export function parseFrontmatterText(raw: string): ParsedFrontmatterFile {
  try {
    const parsed = matter(raw);
    return { frontmatter: parsed.data as Frontmatter, body: parsed.content, raw };
  } catch {
    return parseLenientFrontmatter(raw);
  }
}

export async function parseFrontmatterFile(
  absolutePath: string,
): Promise<ParsedFrontmatterFile> {
  const raw = await readFile(absolutePath, "utf8");
  return parseFrontmatterText(raw);
}

export function parseStructuredText(raw: string): FrontmatterValue {
  try {
    return parseJsonc(raw);
  } catch {
    return parseYaml(raw) as FrontmatterValue;
  }
}

export async function parseStructuredDocument(
  absolutePath: string,
): Promise<FrontmatterValue> {
  const raw = await readFile(absolutePath, "utf8");
  return parseStructuredText(raw);
}
