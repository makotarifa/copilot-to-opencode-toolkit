import { ArtifactFamily } from "../domain/artifact-family";
import { ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { FRAGMENTS_DIR_NAME, PROVIDER_FRAGMENT_FILE } from "../constants";
import { parseStructuredDocument } from "../parse/frontmatter-parser";
import { Migrator, TransformContext, TransformResult } from "./migrator";
import { buildProviderFragment, readProviderConfig } from "./provider-fragment";

export { buildProviderFragment, readProviderConfig } from "./provider-fragment";
export type { ProviderConfig } from "./provider-fragment";

export class ProviderMigrator implements Migrator {
  readonly family = ArtifactFamily.Provider;

  async transform(artifact: ParsedCopilotArtifact, _context: TransformContext): Promise<TransformResult> {
    const config = readProviderConfig(await parseStructuredDocument(artifact.inventory.absolutePath));
    const relativePath = `${FRAGMENTS_DIR_NAME}/${PROVIDER_FRAGMENT_FILE}`;

    if (config === undefined) {
      return {
        files: [],
        rows: [
          {
            code: ReportCode.ManualReview,
            severity: ReportSeverity.Warning,
            family: this.family,
            source: artifact.inventory.relativePath,
            message: "Unrecognized provider config; needs manual review.",
          },
        ],
        warnings: [`Unknown provider config shape in \`${artifact.inventory.relativePath}\`.`],
      };
    }

    const build = buildProviderFragment(config);
    const files: MigratedFile[] = [
      { relativePath, content: `${JSON.stringify({ provider: build.fragment }, null, 2)}\n` },
    ];
    const rows: ReportRow[] = [
      {
        code: ReportCode.ProviderMigrated,
        severity: ReportSeverity.Info,
        family: this.family,
        source: artifact.inventory.relativePath,
        dest: relativePath,
        message: `Migrated provider \`${build.preview.providerId}\` with \`{env:VAR}\` secrets.`,
      },
      ...build.rows,
    ];

    return { files, rows, warnings: build.warnings, envVars: build.envVars, providerPreview: build.preview };
  }
}
