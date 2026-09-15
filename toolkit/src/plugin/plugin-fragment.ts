import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  FRAGMENTS_DIR_NAME,
  PLUGIN_FRAGMENT_FILE,
  PLUGIN_KEY,
  PROJECT_PLUGINS_DIR,
  USER_PLUGINS_DIR,
} from "../constants";
import { ArtifactFamily } from "../domain/artifact-family";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { TargetScope } from "../domain/target-scope";
import { PluginRecommendation, PluginSourceKind } from "./plugin-recommendations";

export interface PluginFragmentOptions {
  readonly scope: TargetScope;
  readonly sourceRoot: string;
}

export interface PluginFragmentBuild {
  readonly file?: MigratedFile;
  readonly rows: ReportRow[];
  readonly copiedFiles: MigratedFile[];
}

interface PluginBuildState {
  readonly specifiers: string[];
  readonly copiedFiles: MigratedFile[];
  readonly rows: ReportRow[];
}

function pluginsDirForScope(scope: TargetScope): string {
  return scope === TargetScope.User ? USER_PLUGINS_DIR : PROJECT_PLUGINS_DIR;
}

function missingLocalPluginsRow(specifier: string): ReportRow {
  return {
    code: ReportCode.ManualReview,
    severity: ReportSeverity.Warning,
    family: ArtifactFamily.Unknown,
    source: specifier,
    message: `Local plugin \`${specifier}\` could not be resolved; the entry was skipped.`,
  };
}

async function collectLocalPlugin(
  plugin: PluginRecommendation,
  options: PluginFragmentOptions,
  state: PluginBuildState,
): Promise<void> {
  const sourcePath = resolve(options.sourceRoot, plugin.specifier);
  let content: string;
  try {
    content = await readFile(sourcePath, "utf8");
  } catch {
    state.rows.push(missingLocalPluginsRow(plugin.specifier));
    return;
  }

  const pluginDir = pluginsDirForScope(options.scope);
  const fileName = basename(sourcePath);
  state.copiedFiles.push({ relativePath: `${pluginDir}/${fileName}`, content });
  state.specifiers.push(`./${pluginDir}/${fileName}`);
}

export async function buildPluginFragment(
  plugins: readonly PluginRecommendation[],
  options: PluginFragmentOptions,
): Promise<PluginFragmentBuild> {
  const state: PluginBuildState = { specifiers: [], copiedFiles: [], rows: [] };

  for (const plugin of plugins) {
    if (plugin.kind === PluginSourceKind.Npm) {
      state.specifiers.push(plugin.specifier);
      continue;
    }
    await collectLocalPlugin(plugin, options, state);
  }

  const file =
    state.specifiers.length === 0
      ? undefined
      : {
          relativePath: `${FRAGMENTS_DIR_NAME}/${PLUGIN_FRAGMENT_FILE}`,
          content: `${JSON.stringify({ [PLUGIN_KEY]: state.specifiers }, null, 2)}\n`,
        };
  return { file, rows: state.rows, copiedFiles: state.copiedFiles };
}
