import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";

export function isPathInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

export function isSamePath(left: string, right: string): boolean {
  return left === right;
}

export function isOutsideRepo(path: string, repoRoot: string): boolean {
  const rel = relative(repoRoot, path);
  return rel !== "" && (rel.startsWith("..") || isAbsolute(rel));
}

export function overlaps(left: string, right: string): boolean {
  return isSamePath(left, right) || isPathInside(left, right) || isPathInside(right, left);
}

export async function isReadableDirectory(target: string): Promise<boolean> {
  try {
    const info = await stat(target);
    if (!info.isDirectory()) {
      return false;
    }
    await access(target, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}
