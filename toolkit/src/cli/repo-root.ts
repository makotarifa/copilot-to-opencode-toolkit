import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { GIT_DIR_NAME, OPEN_CODE_DIR_NAME } from "../constants";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function findRepoRoot(start: string): Promise<string> {
  let current = resolve(start);
  while (true) {
    const hasMarker =
      (await pathExists(join(current, OPEN_CODE_DIR_NAME))) || (await pathExists(join(current, GIT_DIR_NAME)));
    if (hasMarker) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(start);
    }
    current = parent;
  }
}

export async function defaultCliHome(source: string): Promise<string | undefined> {
  const candidate = join(source, "cli-home");
  return (await pathExists(candidate)) ? candidate : undefined;
}
