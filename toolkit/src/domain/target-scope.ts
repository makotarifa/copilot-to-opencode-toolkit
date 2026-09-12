import { resolve } from "node:path";

import {
  DEFAULT_DEST_DIR_NAME,
  FRAGMENTS_DIR_NAME,
  INSTRUCTIONS_DIR_NAME,
  PROJECT_AGENTS_DIR,
  PROJECT_COMMANDS_DIR,
  SKILLS_DIR_NAME,
  USER_AGENTS_DIR,
  USER_COMMANDS_DIR,
  XDG_CONFIG_DIR_NAME,
  XDG_CONFIG_SUBDIR,
} from "../constants";

export enum TargetScope {
  User = "user",
  Project = "project",
}

const TARGET_SCOPE_VALUES: readonly TargetScope[] = Object.values(TargetScope);

export function parseTargetScope(value: string): TargetScope | undefined {
  return TARGET_SCOPE_VALUES.find((scope) => scope === value);
}

export interface ScopeDirectories {
  readonly agents: string;
  readonly commands: string;
  readonly skills: string;
  readonly instructions: string;
  readonly fragments: string;
}

const PROJECT_DIRECTORIES: ScopeDirectories = {
  agents: PROJECT_AGENTS_DIR,
  commands: PROJECT_COMMANDS_DIR,
  skills: SKILLS_DIR_NAME,
  instructions: INSTRUCTIONS_DIR_NAME,
  fragments: FRAGMENTS_DIR_NAME,
};

const USER_DIRECTORIES: ScopeDirectories = {
  ...PROJECT_DIRECTORIES,
  agents: USER_AGENTS_DIR,
  commands: USER_COMMANDS_DIR,
};

export function directoriesForScope(scope: TargetScope): ScopeDirectories {
  return scope === TargetScope.User ? USER_DIRECTORIES : PROJECT_DIRECTORIES;
}

export interface ScopeResolutionInput {
  readonly scope: TargetScope;
  readonly repoRoot: string;
  readonly flagDest?: string;
  readonly envXdgConfigHome?: string;
  readonly homeDir: string;
}

export interface ScopeResolution {
  readonly scope: TargetScope;
  readonly configHome?: string;
  readonly repoRoot: string;
}

export function defaultUserConfigHome(
  input: Pick<ScopeResolutionInput, "envXdgConfigHome" | "homeDir">,
): string | undefined {
  const xdgConfigHome = input.envXdgConfigHome;
  if (xdgConfigHome !== undefined && xdgConfigHome.length > 0) {
    return resolve(xdgConfigHome, XDG_CONFIG_SUBDIR);
  }
  if (input.homeDir.length === 0) {
    return undefined;
  }
  return resolve(input.homeDir, XDG_CONFIG_DIR_NAME, XDG_CONFIG_SUBDIR);
}

function resolveProjectConfigHome(repoRoot: string, flagDest: string | undefined): string {
  const dest = flagDest !== undefined && flagDest.length > 0 ? flagDest : DEFAULT_DEST_DIR_NAME;
  return resolve(repoRoot, dest);
}

function resolveUserConfigHome(input: ScopeResolutionInput): string | undefined {
  const override = input.flagDest;
  if (override !== undefined && override.length > 0) {
    return resolve(input.repoRoot, override);
  }
  return defaultUserConfigHome(input);
}

export function resolveScope(input: ScopeResolutionInput): ScopeResolution {
  if (input.scope === TargetScope.Project) {
    return {
      scope: TargetScope.Project,
      configHome: resolveProjectConfigHome(input.repoRoot, input.flagDest),
      repoRoot: input.repoRoot,
    };
  }
  return {
    scope: TargetScope.User,
    configHome: resolveUserConfigHome(input),
    repoRoot: input.repoRoot,
  };
}
