import { FrontmatterValue } from "../domain/copilot-artifact";

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
