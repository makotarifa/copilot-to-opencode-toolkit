import { InstructionRecord } from "./instructions-migrator";

const GLOB_META = /[*?{}[\]!]/;

function staticDirectoryPrefix(applyTo: string | undefined): string | undefined {
  if (applyTo === undefined) {
    return undefined;
  }
  const metaIndex = applyTo.search(GLOB_META);
  const head = metaIndex === -1 ? applyTo : applyTo.slice(0, metaIndex);
  const lastSlash = head.lastIndexOf("/");
  return lastSlash <= 0 ? undefined : head.slice(0, lastSlash);
}

function commonDirectoryPrefix(prefixes: readonly string[]): string | undefined {
  const segments = prefixes.map((prefix) => prefix.split("/"));
  const first = segments[0] ?? [];
  const common: string[] = [];
  for (let index = 0; index < first.length; index += 1) {
    const segment = first[index];
    if (segment === undefined || !segments.every((parts) => parts[index] === segment)) {
      break;
    }
    common.push(segment);
  }
  return common.length > 0 ? common.join("/") : undefined;
}

export function sharedPrefixSlug(records: readonly InstructionRecord[]): string | undefined {
  const prefixes: string[] = [];
  for (const record of records) {
    const prefix = staticDirectoryPrefix(record.applyTo);
    if (prefix === undefined) {
      return undefined;
    }
    prefixes.push(prefix);
  }
  const common = commonDirectoryPrefix(prefixes);
  if (common === undefined) {
    return undefined;
  }
  const segments = common.split("/");
  return segments[segments.length - 1];
}
