import { ArtifactFamily } from "../domain/artifact-family";
import { ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { Migrator, TransformContext, TransformResult } from "./migrator";

export class HooksMigrator implements Migrator {
  readonly family = ArtifactFamily.Hooks;

  async transform(artifact: ParsedCopilotArtifact, _context: TransformContext): Promise<TransformResult> {
    const source = artifact.inventory.relativePath;
    const rows: ReportRow[] = [
      {
        code: ReportCode.ManualRewrite,
        severity: ReportSeverity.Warning,
        family: this.family,
        source,
        message: "Copilot hooks need a manual rewrite to OpenCode plugins; nothing was migrated automatically.",
      },
    ];

    return {
      files: [],
      rows,
      warnings: [`MANUAL_REWRITE: hooks from \`${source}\` require a manual plugin rewrite.`],
    };
  }
}
