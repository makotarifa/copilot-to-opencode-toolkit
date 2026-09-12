import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import { ArtifactFamily } from "../domain/artifact-family";
import { InventoryItem } from "../domain/copilot-artifact";
import { basenameOf, classifyCopilotPath, toPosixPath } from "./path-classifier";

export enum ScanRootKind {
  Workspace = "workspace",
  CliHome = "cli-home",
}

export interface ScanRequest {
  readonly sourceRoot: string;
  readonly cliHomeRoot?: string;
}

export interface ScanResult {
  readonly items: readonly InventoryItem[];
  readonly unknown: readonly InventoryItem[];
}

const SKIPPED_DIRECTORY_NAMES = new Set([".git", "node_modules", "dist", "coverage"]);
const UNKNOWN_EXTENSIONS = new Set([".json", ".jsonc", ".md"]);
const WORKSPACE_CANDIDATE_PREFIXES = [".github/", ".vscode/"];

async function walkFiles(current: string): Promise<string[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      files.push(...(await walkFiles(join(current, entry.name))));
    } else if (entry.isFile()) {
      files.push(join(current, entry.name));
    }
  }

  return files;
}

async function sha256File(absolutePath: string): Promise<string> {
  const content = await readFile(absolutePath);
  return createHash("sha256").update(content).digest("hex");
}

function hasCandidateExtension(relativePath: string): boolean {
  const basename = basenameOf(relativePath);
  const dotIndex = basename.lastIndexOf(".");
  if (dotIndex === -1) {
    return false;
  }
  return UNKNOWN_EXTENSIONS.has(basename.slice(dotIndex));
}

function isUnknownCandidate(relativePath: string, kind: ScanRootKind): boolean {
  if (!hasCandidateExtension(relativePath)) {
    return false;
  }
  if (kind === ScanRootKind.CliHome) {
    return true;
  }
  return WORKSPACE_CANDIDATE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
}

async function scanRoot(root: string, kind: ScanRootKind): Promise<ScanResult> {
  const absoluteFiles = await walkFiles(root);
  const items: InventoryItem[] = [];
  const unknown: InventoryItem[] = [];

  for (const absolutePath of absoluteFiles) {
    const relativePath = toPosixPath(relative(root, absolutePath));
    const family = classifyCopilotPath(relativePath);
    const item: InventoryItem = {
      family,
      absolutePath,
      relativePath,
      sha: await sha256File(absolutePath),
    };

    if (family !== ArtifactFamily.Unknown) {
      items.push(item);
    } else if (isUnknownCandidate(relativePath, kind)) {
      unknown.push(item);
    }
  }

  return { items, unknown };
}

function sortByRelativePath(result: ScanResult): ScanResult {
  const byPath = (left: InventoryItem, right: InventoryItem): number =>
    left.relativePath.localeCompare(right.relativePath);
  return {
    items: [...result.items].sort(byPath),
    unknown: [...result.unknown].sort(byPath),
  };
}

export async function scanSource(request: ScanRequest): Promise<ScanResult> {
  const workspace = await scanRoot(request.sourceRoot, ScanRootKind.Workspace);
  const cliHome = request.cliHomeRoot
    ? await scanRoot(request.cliHomeRoot, ScanRootKind.CliHome)
    : { items: [], unknown: [] };

  return sortByRelativePath({
    items: [...workspace.items, ...cliHome.items],
    unknown: [...workspace.unknown, ...cliHome.unknown],
  });
}
