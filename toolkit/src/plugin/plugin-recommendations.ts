import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { RECOMMENDED_PLUGINS_FILE } from "../constants";
import { FrontmatterValue } from "../domain/copilot-artifact";
import { isFrontmatterRecord } from "../parse/frontmatter-values";
import { parseJsonc } from "../parse/jsonc";

export enum PluginSourceKind {
  Npm = "npm",
  Local = "local",
}

export interface PluginRecommendation {
  readonly kind: PluginSourceKind;
  readonly specifier: string;
}

export class PluginRecommendationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PluginRecommendationError";
  }
}

const PLUGINS_KEY = "plugins";
const KIND_KEY = "kind";
const SPECIFIER_KEY = "specifier";

function isPluginSourceKind(value: string): value is PluginSourceKind {
  return value === PluginSourceKind.Npm || value === PluginSourceKind.Local;
}

function parseRecommendation(value: FrontmatterValue): PluginRecommendation {
  if (!isFrontmatterRecord(value)) {
    throw new PluginRecommendationError("Each recommended plugin must be a JSON object.");
  }
  const kind = value[KIND_KEY];
  const specifier = value[SPECIFIER_KEY];
  if (typeof kind !== "string" || !isPluginSourceKind(kind)) {
    throw new PluginRecommendationError(
      `Recommended plugin has an unknown \`${KIND_KEY}\`: ${JSON.stringify(kind)}.`,
    );
  }
  if (typeof specifier !== "string" || specifier.trim().length === 0) {
    throw new PluginRecommendationError("Recommended plugin is missing a non-empty specifier.");
  }
  return { kind, specifier: specifier.trim() };
}

export async function loadRecommendedPlugins(directory: string): Promise<PluginRecommendation[]> {
  let raw: string;
  try {
    raw = await readFile(join(directory, RECOMMENDED_PLUGINS_FILE), "utf8");
  } catch {
    return [];
  }

  const parsed = parseJsonc(raw);
  if (!isFrontmatterRecord(parsed)) {
    throw new PluginRecommendationError(`\`${RECOMMENDED_PLUGINS_FILE}\` must be a JSON object.`);
  }
  const plugins = parsed[PLUGINS_KEY];
  if (plugins === undefined) {
    return [];
  }
  if (!Array.isArray(plugins)) {
    throw new PluginRecommendationError(`\`${RECOMMENDED_PLUGINS_FILE}\` \`${PLUGINS_KEY}\` must be an array.`);
  }
  return plugins.map(parseRecommendation);
}
