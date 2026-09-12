import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { TargetScope } from "../src/domain/target-scope";
import { formatUsage, parseFlags } from "../src/cli/flag-parser";

describe("parseFlags", () => {
  test("defaults to an interactive, non-dry run", () => {
    const options = parseFlags([]);

    expect(options.dryRun).toBe(false);
    expect(options.yes).toBe(false);
    expect(options.scope).toBeUndefined();
    expect(options.errors).toEqual([]);
  });

  test("only an explicit --dry-run disables writes", () => {
    expect(parseFlags([]).dryRun).toBe(false);
    expect(parseFlags(["--dry-run"]).dryRun).toBe(true);
    expect(parseFlags(["--yes"]).dryRun).toBe(false);
    expect(parseFlags(["--yes", "--dry-run"]).dryRun).toBe(true);
  });

  test("parses value flags and the family enum", () => {
    const options = parseFlags([
      "--source",
      "src",
      "--dest",
      "out",
      "--cli-home",
      "home",
      "--family",
      "agent",
      "--model-map",
      "map.json",
      "--allow-unmapped-models",
    ]);

    expect(options.source).toBe("src");
    expect(options.dest).toBe("out");
    expect(options.cliHome).toBe("home");
    expect(options.family).toBe(ArtifactFamily.Agent);
    expect(options.modelMapPath).toBe("map.json");
    expect(options.allowUnmappedModels).toBe(true);
  });

  test("reports missing values, unknown families and unknown options", () => {
    expect(parseFlags(["--source"]).errors[0]).toContain("Missing value");
    expect(parseFlags(["--family", "nope"]).errors[0]).toContain("Unknown family");
    expect(parseFlags(["--bogus"]).errors[0]).toContain("Unknown option");
  });

  test("parses the target scope enum and rejects unknown scopes", () => {
    expect(parseFlags(["--scope", "user"]).scope).toBe(TargetScope.User);
    expect(parseFlags(["--scope", "project"]).scope).toBe(TargetScope.Project);
    expect(parseFlags(["--scope", "global"]).errors[0]).toContain("Unknown scope");
  });

  test("parses the overwrite opt-in flag", () => {
    expect(parseFlags([]).allowOverwrite).toBe(false);
    expect(parseFlags(["--allow-overwrite"]).allowOverwrite).toBe(true);
  });

  test("advertises the scope flag in the usage text", () => {
    expect(formatUsage()).toContain("--scope <user|project>");
    expect(formatUsage()).toContain("--allow-overwrite");
  });

  test("recognises help", () => {
    expect(parseFlags(["--help"]).help).toBe(true);
    expect(parseFlags(["-h"]).help).toBe(true);
  });
});
