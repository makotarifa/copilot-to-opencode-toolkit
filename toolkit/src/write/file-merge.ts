import { FrontmatterValue } from "../domain/copilot-artifact";
import { MigratedFile } from "../domain/opencode-artifact";
import { isFrontmatterRecord } from "../parse/frontmatter-values";
import { parseJsonc } from "../parse/jsonc";

function valueIdentity(value: FrontmatterValue): string {
  return JSON.stringify(value);
}

function unionArrays(
  base: readonly FrontmatterValue[],
  overlay: readonly FrontmatterValue[],
): FrontmatterValue[] {
  const merged: FrontmatterValue[] = [...base];
  const seen = new Set(base.map(valueIdentity));
  for (const value of overlay) {
    const identity = valueIdentity(value);
    if (!seen.has(identity)) {
      seen.add(identity);
      merged.push(value);
    }
  }
  return merged;
}

export function deepMerge(base: FrontmatterValue, overlay: FrontmatterValue): FrontmatterValue {
  if (Array.isArray(base) && Array.isArray(overlay)) {
    return unionArrays(base, overlay);
  }
  if (isFrontmatterRecord(base) && isFrontmatterRecord(overlay)) {
    const merged: Record<string, FrontmatterValue> = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
      const current = merged[key];
      merged[key] = current === undefined ? value : deepMerge(current, value);
    }
    return merged;
  }
  return overlay;
}

function mergePair(existing: MigratedFile, incoming: MigratedFile): MigratedFile {
  if (existing.content === incoming.content) {
    return existing;
  }
  if (!existing.relativePath.endsWith(".json")) {
    return existing;
  }
  try {
    const merged = deepMerge(parseJsonc(existing.content), parseJsonc(incoming.content));
    return { relativePath: existing.relativePath, content: `${JSON.stringify(merged, null, 2)}\n` };
  } catch {
    return incoming;
  }
}

export function mergeMigratedFiles(files: readonly MigratedFile[]): MigratedFile[] {
  const byPath = new Map<string, MigratedFile>();
  for (const file of files) {
    const existing = byPath.get(file.relativePath);
    byPath.set(file.relativePath, existing === undefined ? file : mergePair(existing, file));
  }
  return [...byPath.values()];
}
