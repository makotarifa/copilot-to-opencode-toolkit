import { ArtifactFamily } from "../domain/artifact-family";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { TargetScope } from "../domain/target-scope";
import { buildPluginFragment } from "../plugin/plugin-fragment";
import { DEFAULT_PLUGIN_SOURCE_ROOT, DEFAULT_PLUGINS_DIR } from "../plugin/plugin-defaults";
import { loadRecommendedPlugins } from "../plugin/plugin-recommendations";
import { SessionDependencies } from "./session-types";

export interface PluginStageResult {
  readonly files: readonly MigratedFile[];
  readonly rows: readonly ReportRow[];
}

const PLUGIN_STAGE_SOURCE = "(recommended plugins)";

function pluginFailureRow(message: string): ReportRow {
  return {
    code: ReportCode.PluginRecommendations,
    severity: ReportSeverity.Error,
    family: ArtifactFamily.Unknown,
    source: PLUGIN_STAGE_SOURCE,
    message: `Recommended plugins could not be loaded: ${message}`,
  };
}

export async function runPluginStage(
  dependencies: SessionDependencies | undefined,
  scope: TargetScope,
): Promise<PluginStageResult> {
  try {
    const recommendations = await loadRecommendedPlugins(
      dependencies?.pluginsPath ?? DEFAULT_PLUGINS_DIR,
    );
    const build = await buildPluginFragment(recommendations, {
      scope,
      sourceRoot: dependencies?.pluginSourceRoot ?? DEFAULT_PLUGIN_SOURCE_ROOT,
    });
    return {
      files: [...build.copiedFiles, ...(build.file === undefined ? [] : [build.file])],
      rows: build.rows,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { files: [], rows: [pluginFailureRow(message)] };
  }
}
