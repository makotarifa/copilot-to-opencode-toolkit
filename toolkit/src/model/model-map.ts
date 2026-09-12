import { readFile, writeFile } from "node:fs/promises";

import { FrontmatterValue } from "../domain/copilot-artifact";
import { isFrontmatterRecord } from "../parse/frontmatter-values";
import { parseJsonc } from "../parse/jsonc";

export type ModelMap = Record<string, string>;

export interface ModelMapEntry {
  readonly copilotModel: string;
  readonly opencodeModelId: string;
}

function toModelMap(value: FrontmatterValue): ModelMap {
  if (!isFrontmatterRecord(value)) {
    return {};
  }
  const map: ModelMap = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      map[key] = entry;
    }
  }
  return map;
}

export async function loadModelMap(path: string): Promise<ModelMap> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  return toModelMap(parseJsonc(raw));
}

export async function loadModelMapOverlay(path: string | undefined): Promise<ModelMap> {
  if (path === undefined) {
    return {};
  }
  return loadModelMap(path);
}

export function mergeModelMaps(base: ModelMap, overlay: ModelMap): ModelMap {
  const overlayKeyNames = new Set(Object.keys(overlay).map((key) => key.toLowerCase()));
  const merged: ModelMap = {};
  for (const [key, value] of Object.entries(base)) {
    if (!overlayKeyNames.has(key.toLowerCase())) {
      merged[key] = value;
    }
  }
  return { ...merged, ...overlay };
}

export function lookupModelMap(map: ModelMap, copilotModel: string): string | undefined {
  const target = copilotModel.toLowerCase();
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === target) {
      return value;
    }
  }
  return undefined;
}

export type MapSourceLookup = (copilotModel: string) => string | undefined;

export function createMapSourceLookup(
  base: ModelMap,
  baseLabel: string,
  overlay: ModelMap,
  overlayLabel: string | undefined,
): MapSourceLookup {
  return (copilotModel) => {
    if (overlayLabel !== undefined && lookupModelMap(overlay, copilotModel) !== undefined) {
      return overlayLabel;
    }
    return lookupModelMap(base, copilotModel) !== undefined ? baseLabel : undefined;
  };
}

function sortKeys(map: ModelMap): ModelMap {
  const sorted: ModelMap = {};
  for (const key of Object.keys(map).sort()) {
    const value = map[key];
    if (value !== undefined) {
      sorted[key] = value;
    }
  }
  return sorted;
}

export async function persistModelMapEntry(path: string, entry: ModelMapEntry): Promise<void> {
  const existing = await loadModelMap(path);
  const updated = sortKeys({ ...existing, [entry.copilotModel]: entry.opencodeModelId });
  await writeFile(path, `${JSON.stringify(updated, null, 2)}\n`, "utf8");
}
