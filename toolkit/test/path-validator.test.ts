import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { TargetScope } from "../src/domain/target-scope";
import { PathErrorCode, validatePaths } from "../src/safety/path-validator";

const OUR_WORKSPACE_OPENCODE_DIR = resolve(import.meta.dirname, "../..", ".opencode");
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "toolkit-paths-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeRepo(): Promise<string> {
  const repoRoot = await makeTempDir();
  await mkdir(join(repoRoot, ".opencode"), { recursive: true });
  await mkdir(join(repoRoot, "source"), { recursive: true });
  return repoRoot;
}

function codes(result: Awaited<ReturnType<typeof validatePaths>>): string[] {
  return result.errors.map((issue) => issue.code);
}

describe("validatePaths", () => {
  test("accepts a valid source and dest", async () => {
    const repoRoot = await makeRepo();
    const result = await validatePaths({
      source: join(repoRoot, "source"),
      dest: join(repoRoot, "migrated"),
      repoRoot,
    });

    expect(result.errors).toEqual([]);
  });

  test("rejects a missing source", async () => {
    const repoRoot = await makeRepo();
    const result = await validatePaths({
      source: join(repoRoot, "missing"),
      dest: join(repoRoot, "migrated"),
      repoRoot,
    });

    expect(codes(result)).toContain(PathErrorCode.SourceReadable);
  });

  test("rejects source equal to dest", async () => {
    const repoRoot = await makeRepo();
    const source = join(repoRoot, "source");
    const result = await validatePaths({ source, dest: source, repoRoot });

    expect(codes(result)).toContain(PathErrorCode.SourceEqualsDest);
  });

  test("rejects dest inside source and source inside dest", async () => {
    const repoRoot = await makeRepo();
    const source = join(repoRoot, "source");
    const insideSource = await validatePaths({ source, dest: join(source, "out"), repoRoot });
    const insideDest = await validatePaths({ source, dest: join(repoRoot), repoRoot });

    expect(codes(insideSource)).toContain(PathErrorCode.DestInsideSource);
    expect(codes(insideDest)).toContain(PathErrorCode.SourceInsideDest);
  });

  test("hard-rejects a dest inside .opencode", async () => {
    const repoRoot = await makeRepo();
    const result = await validatePaths({
      source: join(repoRoot, "source"),
      dest: join(repoRoot, ".opencode", "generated"),
      repoRoot,
    });

    expect(codes(result)).toContain(PathErrorCode.DestInOpenCode);
  });

  test("warns when the source equals the repo root", async () => {
    const repoRoot = await makeRepo();
    const destOutside = await makeTempDir();
    const result = await validatePaths({ source: repoRoot, dest: destOutside, repoRoot });

    expect(result.confirmations.map((issue) => issue.code)).toContain(PathErrorCode.SourceIsRepoRoot);
    expect(codes(result)).toContain(PathErrorCode.DestOutsideRepo);
  });

  test("rejects a dest outside the repository root", async () => {
    const repoRoot = await makeRepo();
    const outside = await makeTempDir();
    const result = await validatePaths({
      source: join(repoRoot, "source"),
      dest: outside,
      repoRoot,
    });

    expect(codes(result)).toContain(PathErrorCode.DestOutsideRepo);
  });

  test("rejects a cli-home that overlaps the dest or shadows the source", async () => {
    const repoRoot = await makeRepo();
    const source = join(repoRoot, "source");
    const dest = join(repoRoot, "migrated");

    const overlapDest = await validatePaths({ source, dest, repoRoot, cliHome: repoRoot });
    expect(codes(overlapDest)).toContain(PathErrorCode.CliHomeOverlap);

    const shadowsSource = await validatePaths({ source, dest, repoRoot, cliHome: source });
    expect(codes(shadowsSource)).toContain(PathErrorCode.CliHomeOverlap);
  });

  test("accepts a cli-home nested inside the source", async () => {
    const repoRoot = await makeRepo();
    const source = join(repoRoot, "source");
    const cliHome = join(source, "cli-home");
    await mkdir(cliHome, { recursive: true });

    const result = await validatePaths({
      source,
      dest: join(repoRoot, "migrated"),
      repoRoot,
      cliHome,
    });

    expect(result.errors).toEqual([]);
  });
});

describe("validatePaths scope awareness", () => {
  test("suppresses the repo-boundary rules under user scope", async () => {
    const repoRoot = await makeRepo();
    const source = join(repoRoot, "source");
    const configHome = await makeTempDir();

    const result = await validatePaths({
      source,
      dest: configHome,
      repoRoot,
      scope: TargetScope.User,
      configHome,
    });

    expect(codes(result)).not.toContain(PathErrorCode.DestOutsideRepo);
    expect(codes(result)).not.toContain(PathErrorCode.DestInOpenCode);
    expect(result.errors).toEqual([]);
  });

  test("fires ERR_NO_CONFIG_HOME when user scope has no config home", async () => {
    const repoRoot = await makeRepo();

    const result = await validatePaths({
      source: join(repoRoot, "source"),
      dest: "",
      repoRoot,
      scope: TargetScope.User,
    });

    expect(codes(result)).toContain(PathErrorCode.NoConfigHome);
  });

  test("keeps the repo-boundary rules under project scope", async () => {
    const repoRoot = await makeRepo();
    const outside = await makeTempDir();

    const result = await validatePaths({
      source: join(repoRoot, "source"),
      dest: outside,
      repoRoot,
      scope: TargetScope.Project,
    });

    expect(codes(result)).toContain(PathErrorCode.DestOutsideRepo);
  });

  test("never allows writing this workspace's own .opencode in project scope", async () => {
    const repoRoot = await makeRepo();

    const result = await validatePaths({
      source: join(repoRoot, "source"),
      dest: OUR_WORKSPACE_OPENCODE_DIR,
      repoRoot,
      scope: TargetScope.Project,
    });

    expect(codes(result)).toContain(PathErrorCode.WriteInsideOurOpenCode);
  });

  test("never allows writing this workspace's own .opencode in user scope", async () => {
    const repoRoot = await makeRepo();

    const result = await validatePaths({
      source: join(repoRoot, "source"),
      dest: OUR_WORKSPACE_OPENCODE_DIR,
      repoRoot,
      scope: TargetScope.User,
      configHome: OUR_WORKSPACE_OPENCODE_DIR,
    });

    expect(codes(result)).toContain(PathErrorCode.WriteInsideOurOpenCode);
  });
});
