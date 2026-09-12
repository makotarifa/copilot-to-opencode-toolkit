import { Frontmatter, FrontmatterValue } from "../domain/copilot-artifact";

export function isFrontmatterRecord(
  value: FrontmatterValue | undefined,
): value is Record<string, FrontmatterValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(frontmatter: Frontmatter, key: string): string | undefined {
  const value = frontmatter[key];
  return typeof value === "string" ? value : undefined;
}

export function getBoolean(frontmatter: Frontmatter, key: string): boolean | undefined {
  const value = frontmatter[key];
  return typeof value === "boolean" ? value : undefined;
}

export function getStringArray(frontmatter: Frontmatter, key: string): string[] {
  const value = frontmatter[key];
  return toStringArray(value);
}

export function toStringArray(value: FrontmatterValue | undefined): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

export function getRecordArray(
  frontmatter: Frontmatter,
  key: string,
): Record<string, FrontmatterValue>[] {
  const value = frontmatter[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isFrontmatterRecord);
}
