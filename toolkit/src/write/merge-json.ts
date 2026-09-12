import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { ATOMIC_TMP_SUFFIX } from "../constants";
import { FrontmatterValue } from "../domain/copilot-artifact";
import { parseJsonc } from "../parse/jsonc";
import { deepMerge } from "./file-merge";
import { resolveWithin } from "./writer";

async function readExisting(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

export function mergeJsonContent(existing: string | undefined, patch: FrontmatterValue): string {
  if (existing === undefined || existing.trim().length === 0) {
    return `${JSON.stringify(patch, null, 2)}\n`;
  }
  return `${JSON.stringify(deepMerge(parseJsonc(existing), patch), null, 2)}\n`;
}

export async function mergeJsonInto(
  destRoot: string,
  relativePath: string,
  patch: FrontmatterValue,
): Promise<void> {
  const target = resolveWithin(destRoot, relativePath);
  const content = mergeJsonContent(await readExisting(target), patch);
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}${ATOMIC_TMP_SUFFIX}`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}
