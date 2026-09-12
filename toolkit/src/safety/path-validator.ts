import { join, resolve } from "node:path";

import { OPEN_CODE_DIR_NAME } from "../constants";
import { TargetScope } from "../domain/target-scope";
import {
  isOutsideRepo,
  isPathInside,
  isReadableDirectory,
  isSamePath,
  overlaps,
} from "./path-relations";

export enum PathErrorCode {
  SourceReadable = "ERR_SOURCE_READABLE",
  CliHomeReadable = "ERR_CLI_HOME_READABLE",
  CliHomeOverlap = "ERR_CLI_HOME_OVERLAP",
  SourceEqualsDest = "ERR_SOURCE_EQUALS_DEST",
  DestInsideSource = "ERR_DEST_INSIDE_SOURCE",
  SourceInsideDest = "ERR_SOURCE_INSIDE_DEST",
  DestOutsideRepo = "ERR_DEST_OUTSIDE_REPO",
  DestInOpenCode = "ERR_DEST_IN_OPENCODE",
  SourceIsRepoRoot = "ERR_SOURCE_IS_REPO_ROOT",
  NoConfigHome = "ERR_NO_CONFIG_HOME",
  WriteInsideOurOpenCode = "ERR_WRITE_INSIDE_OUR_OPENCODE",
}

export interface ResolvedPaths {
  readonly source: string;
  readonly dest: string;
  readonly cliHome?: string;
  readonly repoRoot: string;
}

export interface PathIssue {
  readonly code: PathErrorCode;
  readonly message: string;
}

export interface PathValidationResult {
  readonly errors: readonly PathIssue[];
  readonly confirmations: readonly PathIssue[];
  readonly resolved: ResolvedPaths;
}

export interface PathValidationInput {
  readonly source: string;
  readonly dest: string;
  readonly repoRoot: string;
  readonly cliHome?: string;
  readonly scope?: TargetScope;
  readonly configHome?: string;
}

const OUR_WORKSPACE_OPENCODE_DIR = resolve(import.meta.dirname, "../../..", OPEN_CODE_DIR_NAME);

function checkDestInsideOpenCode(dest: string, repoRoot: string, errors: PathIssue[]): void {
  const openCodeDir = join(repoRoot, OPEN_CODE_DIR_NAME);
  if (isSamePath(dest, openCodeDir) || isPathInside(dest, openCodeDir)) {
    errors.push({
      code: PathErrorCode.DestInOpenCode,
      message: `Dest \`${dest}\` is inside \`${OPEN_CODE_DIR_NAME}/\`; that boundary is absolute.`,
    });
  }
}

function checkDestOutsideRepo(dest: string, repoRoot: string, errors: PathIssue[]): void {
  if (isOutsideRepo(dest, repoRoot)) {
    errors.push({
      code: PathErrorCode.DestOutsideRepo,
      message: `Dest \`${dest}\` must resolve inside the repository root \`${repoRoot}\`.`,
    });
  }
}

function checkOurWorkspaceOpenCode(dest: string, errors: PathIssue[]): void {
  if (isSamePath(dest, OUR_WORKSPACE_OPENCODE_DIR) || isPathInside(dest, OUR_WORKSPACE_OPENCODE_DIR)) {
    errors.push({
      code: PathErrorCode.WriteInsideOurOpenCode,
      message: `Dest \`${dest}\` targets this workspace's own \`${OPEN_CODE_DIR_NAME}/\`; it is never writable.`,
    });
  }
}

function checkSourceDestRelations(input: PathValidationInput, errors: PathIssue[]): void {
  if (isSamePath(input.source, input.dest)) {
    errors.push({
      code: PathErrorCode.SourceEqualsDest,
      message: "Source and dest must be different directories.",
    });
  }
  if (isPathInside(input.dest, input.source)) {
    errors.push({
      code: PathErrorCode.DestInsideSource,
      message: `Dest \`${input.dest}\` must not be inside the source \`${input.source}\`.`,
    });
  }
  if (isPathInside(input.source, input.dest)) {
    errors.push({
      code: PathErrorCode.SourceInsideDest,
      message: `Source \`${input.source}\` must not be inside the dest \`${input.dest}\`.`,
    });
  }
}

async function checkSourceReadable(source: string, errors: PathIssue[]): Promise<void> {
  if (!(await isReadableDirectory(source))) {
    errors.push({
      code: PathErrorCode.SourceReadable,
      message: `Source \`${source}\` does not exist or is not readable.`,
    });
  }
}

async function checkCliHome(
  cliHome: string | undefined,
  source: string,
  dest: string | undefined,
  errors: PathIssue[],
): Promise<void> {
  if (cliHome === undefined || cliHome.length === 0) {
    return;
  }
  if (!(await isReadableDirectory(cliHome))) {
    errors.push({
      code: PathErrorCode.CliHomeReadable,
      message: `CLI home \`${cliHome}\` does not exist or is not readable.`,
    });
    return;
  }
  const shadowsSource = isSamePath(cliHome, source) || isPathInside(source, cliHome);
  const touchesDest = dest !== undefined && overlaps(cliHome, dest);
  if (touchesDest || shadowsSource) {
    errors.push({
      code: PathErrorCode.CliHomeOverlap,
      message: `CLI home \`${cliHome}\` overlaps the source or dest; a CLI home nested inside the source is allowed, but it must not contain the source or touch the write target.`,
    });
  }
}

export async function validatePaths(input: PathValidationInput): Promise<PathValidationResult> {
  const scope = input.scope ?? TargetScope.Project;
  const errors: PathIssue[] = [];
  const confirmations: PathIssue[] = [];
  const hasConfigHome = input.configHome !== undefined && input.configHome.length > 0;
  const hasDest = scope !== TargetScope.User || hasConfigHome;

  if (scope === TargetScope.User && !hasConfigHome) {
    errors.push({
      code: PathErrorCode.NoConfigHome,
      message:
        "User scope needs a config home: pass `--dest` or set `XDG_CONFIG_HOME`/`HOME` to resolve `~/.config/opencode`.",
    });
  }

  if (hasDest) {
    checkOurWorkspaceOpenCode(input.dest, errors);
    checkSourceDestRelations(input, errors);
    if (scope === TargetScope.Project) {
      checkDestInsideOpenCode(input.dest, input.repoRoot, errors);
      checkDestOutsideRepo(input.dest, input.repoRoot, errors);
    }
  }

  await checkSourceReadable(input.source, errors);
  await checkCliHome(input.cliHome, input.source, hasDest ? input.dest : undefined, errors);

  if (isSamePath(input.source, input.repoRoot)) {
    confirmations.push({
      code: PathErrorCode.SourceIsRepoRoot,
      message: "Source equals the repository root; confirm that scanning the whole repo is intended.",
    });
  }

  const cliHome = input.cliHome;
  return {
    errors,
    confirmations,
    resolved: {
      source: input.source,
      dest: input.dest,
      cliHome: cliHome !== undefined && cliHome.length > 0 ? cliHome : undefined,
      repoRoot: input.repoRoot,
    },
  };
}

export function describePathIssue(issue: PathIssue): string {
  return `${issue.code}: ${issue.message}`;
}
