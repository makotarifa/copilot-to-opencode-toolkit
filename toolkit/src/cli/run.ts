import { join, resolve } from "node:path";

import { DEFAULT_DEST_DIR_NAME, DEFAULT_SOURCE_DIR_NAME, MODEL_MAP_FILE } from "../constants";
import { defaultUserConfigHome, resolveScope, TargetScope } from "../domain/target-scope";
import { renderReportMarkdown } from "../report/migration-report";
import { PathValidationResult, ResolvedPaths, validatePaths } from "../safety/path-validator";
import { CliOptions, formatUsage, parseFlags } from "./flag-parser";
import { printManualStepsSummary } from "./manual-steps-summary";
import { printModelSummary } from "./model-summary";
import { InteractivePrompts, interactivePrompts } from "./prompts";
import { defaultCliHome, findRepoRoot } from "./repo-root";
import { runSession, SessionDependencies } from "./session";

const MAX_PATH_PROMPT_ATTEMPTS = 3;
const DEFAULT_TARGET_SCOPE = TargetScope.Project;
const TOOLKIT_DIR_NAME = "toolkit";

function withDefault(value: string | undefined, fallback: string): string {
  return value !== undefined && value.length > 0 ? value : fallback;
}

interface ResolvedInput {
  readonly source: string;
  readonly dest: string;
  readonly cliHome?: string;
  readonly scope: TargetScope;
  readonly configHome?: string;
}

function homeDirectory(): string {
  return process.env.HOME ?? "";
}

function defaultDestForScope(scope: TargetScope): string {
  if (scope === TargetScope.User) {
    return defaultUserConfigHome({ envXdgConfigHome: process.env.XDG_CONFIG_HOME, homeDir: homeDirectory() }) ?? "";
  }
  return DEFAULT_DEST_DIR_NAME;
}

async function buildInputs(options: CliOptions, repoRoot: string, scope: TargetScope): Promise<ResolvedInput> {
  const source = resolve(repoRoot, withDefault(options.source, DEFAULT_SOURCE_DIR_NAME));
  const resolution = resolveScope({
    scope,
    repoRoot,
    flagDest: options.dest,
    envXdgConfigHome: process.env.XDG_CONFIG_HOME,
    homeDir: homeDirectory(),
  });
  const cliHome = options.cliHome !== undefined
    ? resolve(repoRoot, options.cliHome)
    : await defaultCliHome(source);
  return { source, dest: resolution.configHome ?? "", cliHome, scope, configHome: resolution.configHome };
}

function modelMapPathForScope(scope: TargetScope, dest: string, repoRoot: string): string {
  return scope === TargetScope.User
    ? join(dest, MODEL_MAP_FILE)
    : join(repoRoot, TOOLKIT_DIR_NAME, MODEL_MAP_FILE);
}

function reportIssues(issues: readonly { readonly code: string; readonly message: string }[]): void {
  for (const issue of issues) {
    console.error(`${issue.code}: ${issue.message}`);
  }
}

interface InteractiveResolution {
  readonly resolved: ResolvedPaths;
  readonly validation: PathValidationResult;
  readonly scope: TargetScope;
}

async function resolveInteractive(
  options: CliOptions,
  repoRoot: string,
  prompts: InteractivePrompts,
): Promise<InteractiveResolution | undefined> {
  for (let attempt = 0; attempt < MAX_PATH_PROMPT_ATTEMPTS; attempt += 1) {
    const scope =
      options.scope ?? (await prompts.selectScope("Where should the OpenCode config be emitted?", DEFAULT_TARGET_SCOPE));
    const sourceInput = options.source ?? (await prompts.promptPath("Copilot source directory", DEFAULT_SOURCE_DIR_NAME));
    const destInput = options.dest ?? (await prompts.promptPath("Output directory", defaultDestForScope(scope)));
    const inputs = await buildInputs({ ...options, source: sourceInput, dest: destInput }, repoRoot, scope);
    const validation = await validatePaths({ ...inputs, repoRoot });

    if (validation.errors.length === 0) {
      return { resolved: validation.resolved, validation, scope };
    }
    reportIssues(validation.errors);
    if (options.source !== undefined && options.dest !== undefined) {
      return undefined;
    }
  }
  console.error("Too many invalid path attempts.");
  return undefined;
}

async function confirmRepoRoot(validation: PathValidationResult, prompts: InteractivePrompts): Promise<boolean> {
  for (const issue of validation.confirmations) {
    if (!(await prompts.confirm(issue.message, false))) {
      console.error(`${issue.code}: declined.`);
      return false;
    }
  }
  return true;
}

export interface RunOverrides {
  readonly dependencies?: SessionDependencies;
  readonly cwd?: string;
}

export async function runCli(argv: readonly string[], overrides: RunOverrides = {}): Promise<number> {
  const options = parseFlags(argv);
  const prompts = overrides.dependencies?.prompts ?? interactivePrompts;

  if (options.help) {
    console.log(formatUsage());
    return 0;
  }
  if (options.errors.length > 0) {
    for (const error of options.errors) {
      console.error(error);
    }
    console.error(formatUsage());
    return 1;
  }

  const repoRoot = await findRepoRoot(overrides.cwd ?? process.cwd());
  let resolved: ResolvedPaths;
  let scope: TargetScope;

  if (options.yes) {
    scope = options.scope ?? DEFAULT_TARGET_SCOPE;
    const inputs = await buildInputs(options, repoRoot, scope);
    const validation = await validatePaths({ ...inputs, repoRoot });
    if (validation.errors.length > 0) {
      reportIssues(validation.errors);
      return 1;
    }
    if (validation.confirmations.length > 0) {
      reportIssues(validation.confirmations);
      return 1;
    }
    resolved = validation.resolved;
  } else {
    const interactive = await resolveInteractive(options, repoRoot, prompts);
    if (interactive === undefined) {
      return 1;
    }
    if (!(await confirmRepoRoot(interactive.validation, prompts))) {
      return 1;
    }
    resolved = interactive.resolved;
    scope = interactive.scope;
    prompts.showPanel("Resolved migration paths", [
      `scope:    ${scope}  →  write root: ${resolved.dest}`,
      `source:   ${resolved.source}`,
      `cli-home: ${resolved.cliHome ?? "(none)"}`,
      `dest:     ${resolved.dest}`,
    ]);
  }

  const result = await runSession({
    options: { ...options, scope },
    paths: resolved,
    modelMapPath: modelMapPathForScope(scope, resolved.dest, repoRoot),
    baseModelMapPath: join(repoRoot, TOOLKIT_DIR_NAME, MODEL_MAP_FILE),
    dependencies: overrides.dependencies,
  });

  if (result.dryRun) {
    console.log(renderReportMarkdown(result.report));
    console.log("Dry run: no files were written.");
  } else if (result.blocked) {
    reportIssues(result.blockers);
  } else {
    console.log(`Wrote ${result.written.length} file(s) under ${resolved.dest}.`);
    if (result.refused.length > 0) {
      console.error(`Refused ${result.refused.length} overwrite(s).`);
    }
    if (options.yes) {
      printModelSummary(result.report);
    }
  }
  printManualStepsSummary(result.report);
  return result.exitCode;
}
