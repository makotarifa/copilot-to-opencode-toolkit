import { FrontmatterValue } from "../domain/copilot-artifact";

const FAMILY_SEGMENTS = new Set(["agents", "prompts", "instructions", "skills"]);
const INFRA_SEGMENTS = new Set(["github-copilot", ".github"]);

export function namespaceOf(relativePath: string): string {
  const segments = relativePath
    .split("\\")
    .join("/")
    .split("/")
    .filter((segment) => segment.length > 0);
  const familyIndex = segments.findIndex((segment) => FAMILY_SEGMENTS.has(segment));
  if (familyIndex <= 0) {
    return "";
  }
  return segments
    .slice(0, familyIndex)
    .filter((segment) => !INFRA_SEGMENTS.has(segment))
    .join("/");
}

export function withNamespace(directory: string, namespace: string): string {
  return namespace.length === 0 ? directory : `${directory}/${namespace}`;
}

export function toModelValue(value: FrontmatterValue | undefined): string | string[] | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  return undefined;
}

export function stringifyFrontmatterValue(value: FrontmatterValue): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => stringifyFrontmatterValue(entry)).join(", ");
  }
  if (value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function parentDirectoryName(relativePath: string): string {
  const segments = relativePath.split("/");
  return segments.length >= 2 ? (segments[segments.length - 2] ?? "") : "";
}

export function firstNonEmptyLine(value: string): string {
  const line = value
    .split("\n")
    .map((entry) => entry.trim())
    .find((entry) => entry.length > 0);
  return line ?? "";
}
