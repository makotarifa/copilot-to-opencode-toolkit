import { PLUGIN_KEY } from "../constants";
import { FrontmatterValue } from "../domain/copilot-artifact";
import { isFrontmatterRecord } from "../parse/frontmatter-values";

export enum ConfigSection {
  Provider = "provider",
  Mcp = "mcp",
  Plugin = "plugin",
}

const MERGED_SECTIONS: readonly ConfigSection[] = [
  ConfigSection.Provider,
  ConfigSection.Mcp,
  ConfigSection.Plugin,
];

export interface ConfigCollision {
  readonly section: ConfigSection;
  readonly key: string;
}

function deepEqual(left: FrontmatterValue, right: FrontmatterValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => deepEqual(item, right[index] ?? null));
  }
  if (isFrontmatterRecord(left) || isFrontmatterRecord(right)) {
    if (!isFrontmatterRecord(left) || !isFrontmatterRecord(right)) {
      return false;
    }
    const keys = Object.keys(left);
    if (keys.length !== Object.keys(right).length) {
      return false;
    }
    return keys.every(
      (key) => right[key] !== undefined && deepEqual(left[key] ?? null, right[key] ?? null),
    );
  }
  return left === right;
}

function sectionOf(record: FrontmatterValue, section: ConfigSection): FrontmatterValue | undefined {
  return isFrontmatterRecord(record) ? record[section] : undefined;
}

function isUnionArraySection(section: ConfigSection): boolean {
  return section === ConfigSection.Plugin;
}

function isArrayClobber(
  existingSection: FrontmatterValue | undefined,
  patchSection: FrontmatterValue | undefined,
): boolean {
  if (existingSection === undefined || patchSection === undefined) {
    return false;
  }
  if (Array.isArray(existingSection) && Array.isArray(patchSection)) {
    return false;
  }
  return !deepEqual(existingSection, patchSection);
}

export function detectConfigCollisions(
  existing: FrontmatterValue,
  patch: FrontmatterValue,
): ConfigCollision[] {
  const collisions: ConfigCollision[] = [];
  for (const section of MERGED_SECTIONS) {
    const existingSection = sectionOf(existing, section);
    const patchSection = sectionOf(patch, section);
    if (isUnionArraySection(section)) {
      if (isArrayClobber(existingSection, patchSection)) {
        collisions.push({ section, key: PLUGIN_KEY });
      }
      continue;
    }
    if (!isFrontmatterRecord(existingSection) || !isFrontmatterRecord(patchSection)) {
      continue;
    }
    for (const key of Object.keys(patchSection)) {
      const existingValue = existingSection[key];
      const patchValue = patchSection[key];
      if (
        existingValue !== undefined &&
        patchValue !== undefined &&
        !deepEqual(existingValue, patchValue)
      ) {
        collisions.push({ section, key });
      }
    }
  }
  return collisions;
}
