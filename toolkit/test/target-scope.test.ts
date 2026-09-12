import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  directoriesForScope,
  parseTargetScope,
  resolveScope,
  TargetScope,
} from "../src/domain/target-scope";

const REPO_ROOT = "/repo";
const HOME_DIR = "/home/operator";
const XDG_CONFIG_HOME = "/xdg";

describe("parseTargetScope", () => {
  test("accepts the two closed-set values", () => {
    expect(parseTargetScope("user")).toBe(TargetScope.User);
    expect(parseTargetScope("project")).toBe(TargetScope.Project);
  });

  test("rejects anything else", () => {
    expect(parseTargetScope("global")).toBeUndefined();
    expect(parseTargetScope("")).toBeUndefined();
  });
});

describe("directoriesForScope", () => {
  test("user scope commands dir is singular", () => {
    expect(directoriesForScope(TargetScope.User).commands).toBe("command");
  });

  test("project scope commands dir is plural", () => {
    expect(directoriesForScope(TargetScope.Project).commands).toBe("commands");
  });

  test("agents, skills, instructions and fragments dirs are scope-independent", () => {
    const user = directoriesForScope(TargetScope.User);
    const project = directoriesForScope(TargetScope.Project);

    expect(user.agents).toBe("agents");
    expect(project.agents).toBe("agents");
    expect(user.skills).toBe(project.skills);
    expect(user.instructions).toBe(project.instructions);
    expect(user.fragments).toBe(project.fragments);
  });
});

describe("resolveScope project", () => {
  test("defaults to the repo-rooted migrated directory", () => {
    const resolution = resolveScope({
      scope: TargetScope.Project,
      repoRoot: REPO_ROOT,
      homeDir: HOME_DIR,
      envXdgConfigHome: XDG_CONFIG_HOME,
    });

    expect(resolution.configHome).toBe(resolve(REPO_ROOT, "migrated"));
  });

  test("honours --dest as a repo-rooted override", () => {
    const resolution = resolveScope({
      scope: TargetScope.Project,
      repoRoot: REPO_ROOT,
      flagDest: "out",
      homeDir: HOME_DIR,
    });

    expect(resolution.configHome).toBe(resolve(REPO_ROOT, "out"));
  });
});

describe("resolveScope user", () => {
  test("prefers XDG_CONFIG_HOME over HOME", () => {
    const resolution = resolveScope({
      scope: TargetScope.User,
      repoRoot: REPO_ROOT,
      homeDir: HOME_DIR,
      envXdgConfigHome: XDG_CONFIG_HOME,
    });

    expect(resolution.configHome).toBe(resolve(XDG_CONFIG_HOME, "opencode"));
  });

  test("falls back to ~/.config/opencode when XDG is unset", () => {
    const resolution = resolveScope({
      scope: TargetScope.User,
      repoRoot: REPO_ROOT,
      homeDir: HOME_DIR,
    });

    expect(resolution.configHome).toBe(resolve(HOME_DIR, ".config", "opencode"));
  });

  test("lets --dest override XDG_CONFIG_HOME and HOME", () => {
    const resolution = resolveScope({
      scope: TargetScope.User,
      repoRoot: REPO_ROOT,
      flagDest: "/override",
      homeDir: HOME_DIR,
      envXdgConfigHome: XDG_CONFIG_HOME,
    });

    expect(resolution.configHome).toBe(resolve("/override"));
  });

  test("anchors a relative --dest at the repo root", () => {
    const resolution = resolveScope({
      scope: TargetScope.User,
      repoRoot: REPO_ROOT,
      flagDest: "local-config",
      homeDir: HOME_DIR,
      envXdgConfigHome: XDG_CONFIG_HOME,
    });

    expect(resolution.configHome).toBe(resolve(REPO_ROOT, "local-config"));
  });

  test("returns no config home when nothing resolves", () => {
    const resolution = resolveScope({
      scope: TargetScope.User,
      repoRoot: REPO_ROOT,
      homeDir: "",
    });

    expect(resolution.configHome).toBeUndefined();
  });
});
