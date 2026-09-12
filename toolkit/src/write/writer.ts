import { constants } from "node:fs";
import { access, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import { MigratedFile } from "../domain/opencode-artifact";

export class PathEscapeError extends Error {
  readonly code = "ERR_DEST_ESCAPE";

  constructor(target: string) {
    super(`Refusing to write outside the validated dest root: ${target}`);
    this.name = "PathEscapeError";
  }
}

export interface WriteOutcome {
  readonly written: readonly string[];
  readonly refused: readonly string[];
}

export function resolveWithin(destRoot: string, relativePath: string): string {
  const target = resolve(destRoot, relativePath);
  const rel = relative(destRoot, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new PathEscapeError(target);
  }
  return target;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeFiles(
  destRoot: string,
  files: readonly MigratedFile[],
  overwrite: boolean,
): Promise<WriteOutcome> {
  const written: string[] = [];
  const refused: string[] = [];

  for (const file of files) {
    const target = resolveWithin(destRoot, file.relativePath);
    if (!overwrite && (await exists(target))) {
      refused.push(file.relativePath);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content, "utf8");
    written.push(file.relativePath);
  }

  return { written, refused };
}
