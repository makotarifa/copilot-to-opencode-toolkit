import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { FrontmatterValue } from "../domain/copilot-artifact";
import { parseFrontmatterFile } from "../parse/frontmatter-parser";
import { parseJsonc } from "../parse/jsonc";
import { getStringArray } from "../parse/frontmatter-values";

export const SEEDED_OPENCODE_MODEL_IDS: readonly string[] = [
  "litellm/litellm-orchestrator",
  "litellm/litellm-default",
  "litellm/litellm-builder",
  "litellm/litellm-planner",
  "litellm/litellm-small-planner",
  "litellm/litellm-big-planner",
  "litellm/litellm-tester",
  "litellm/litellm-workspace-admin",
  "litellm/litellm-docs",
];

const AGENTS_DIR_NAME = "agents";
const OPENCODE_CONFIG_NAME = "opencode.json";
const MODEL_KEY = "model";
const MARKDOWN_SUFFIX = ".md";

export class ModelCatalog {
  private readonly ids: readonly string[];

  constructor(ids: readonly string[]) {
    this.ids = [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))].sort();
  }

  all(): readonly string[] {
    return this.ids;
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }
}

async function readAgentModelIds(agentsDir: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(agentsDir);
  } catch {
    return [];
  }

  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(MARKDOWN_SUFFIX)) {
      continue;
    }
    const parsed = await parseFrontmatterFile(join(agentsDir, entry));
    ids.push(...getStringArray(parsed.frontmatter, MODEL_KEY));
  }
  return ids;
}

function collectModelValues(value: FrontmatterValue, ids: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((entry) => collectModelValues(entry, ids));
    return;
  }
  if (typeof value !== "object" || value === null) {
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (key === MODEL_KEY && typeof entry === "string") {
      ids.push(entry);
    }
    collectModelValues(entry, ids);
  }
}

async function readConfigModelIds(configPath: string): Promise<string[]> {
  let raw: string;
  try {
    raw = await readFile(configPath, "utf8");
  } catch {
    return [];
  }

  const ids: string[] = [];
  collectModelValues(parseJsonc(raw), ids);
  return ids;
}

export async function readOpenCodeCatalogIds(opencodeRoot: string): Promise<string[]> {
  const fromAgents = await readAgentModelIds(join(opencodeRoot, AGENTS_DIR_NAME));
  const fromConfig = await readConfigModelIds(join(opencodeRoot, OPENCODE_CONFIG_NAME));
  return [...fromAgents, ...fromConfig];
}

export interface ModelCatalogOptions {
  readonly opencodeRoot?: string;
  readonly extraIds?: readonly string[];
}

export async function createModelCatalog(options: ModelCatalogOptions): Promise<ModelCatalog> {
  const discovered = options.opencodeRoot ? await readOpenCodeCatalogIds(options.opencodeRoot) : [];
  return new ModelCatalog([
    ...SEEDED_OPENCODE_MODEL_IDS,
    ...discovered,
    ...(options.extraIds ?? []),
  ]);
}
