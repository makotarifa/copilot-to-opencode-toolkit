import { describe, expect, test } from "vitest";

import { ArtifactFamily } from "../src/domain/artifact-family";
import { ReportCode } from "../src/domain/report";
import { HooksMigrator } from "../src/transform/hooks-migrator";

const DEST_ROOT = "/tmp/toolkit-dest";

describe("HooksMigrator", () => {
  test("emits a manual-rewrite report entry and no files", async () => {
    const result = await new HooksMigrator().transform(
      {
        inventory: {
          family: ArtifactFamily.Hooks,
          absolutePath: "/source/.github/hooks/pre-tool.json",
          relativePath: ".github/hooks/pre-tool.json",
          sha: "x",
        },
        frontmatter: {},
        body: "",
      },
      { destRoot: DEST_ROOT },
    );

    expect(result.files).toEqual([]);
    expect(result.rows[0]?.code).toBe(ReportCode.ManualRewrite);
    expect(result.warnings[0]).toContain("MANUAL_REWRITE");
  });
});
