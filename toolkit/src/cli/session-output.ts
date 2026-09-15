import { readFile } from "node:fs/promises";

import { OPENCODE_CONFIG_FILE_NAME } from "../constants";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportCode, ReportRow } from "../domain/report";
import { TargetScope } from "../domain/target-scope";
import { renderDiff } from "../write/diff-preview";
import { mergeJsonContent, mergeJsonInto } from "../write/merge-json";
import { buildOpenCodeConfigPatch } from "../write/opencode-config";
import { resolveWithin, WriteOutcome, writeFiles } from "../write/writer";
import { CliOptions } from "./flag-parser";
import { InteractivePrompts } from "./prompts";
import { SessionInput } from "./session-types";

const ALWAYS_FATAL_CODES = new Set<ReportCode>([
  ReportCode.TeamSelection,
  ReportCode.PluginRecommendations,
]);

export function computeExitCode(options: CliOptions, rows: readonly ReportRow[]): number {
  if (rows.some((row) => ALWAYS_FATAL_CODES.has(row.code))) {
    return 1;
  }
  if (!options.yes || options.allowUnmappedModels) {
    return 0;
  }
  const gated = rows.some(
    (row) => row.code === ReportCode.UnmappedModel || row.code === ReportCode.StaleModelId,
  );
  return gated ? 1 : 0;
}

async function readExisting(destRoot: string, relativePath: string): Promise<string | undefined> {
  try {
    return await readFile(resolveWithin(destRoot, relativePath), "utf8");
  } catch {
    return undefined;
  }
}

const MAX_PREVIEW_LINES = 60;

async function consentToWrite(
  file: MigratedFile,
  existing: string | undefined,
  prompts: InteractivePrompts,
): Promise<boolean> {
  const preview = renderDiff(existing, file.content, `--- ${file.relativePath}`);
  prompts.showPanel(`Proposed change: ${file.relativePath}`, preview.split("\n").slice(0, MAX_PREVIEW_LINES));
  if (existing !== undefined) {
    return prompts.confirmOverwrite(file.relativePath);
  }
  return prompts.confirm(`Write new file \`${file.relativePath}\`?`, false);
}

async function mergeUserOpenCodeConfig(files: readonly MigratedFile[], input: SessionInput): Promise<void> {
  if ((input.options.scope ?? TargetScope.Project) !== TargetScope.User) {
    return;
  }
  const patch = buildOpenCodeConfigPatch(files);
  await mergeJsonInto(input.paths.dest, OPENCODE_CONFIG_FILE_NAME, patch);
}

async function consentToMergeConfig(
  files: readonly MigratedFile[],
  input: SessionInput,
  prompts: InteractivePrompts,
): Promise<WriteOutcome> {
  if ((input.options.scope ?? TargetScope.Project) !== TargetScope.User) {
    return { written: [], refused: [] };
  }
  const patch = buildOpenCodeConfigPatch(files);
  const existing = await readExisting(input.paths.dest, OPENCODE_CONFIG_FILE_NAME);
  const proposed = mergeJsonContent(existing, patch);
  const preview = renderDiff(existing, proposed, `--- ${OPENCODE_CONFIG_FILE_NAME}`);
  prompts.showPanel(
    `Proposed change: ${OPENCODE_CONFIG_FILE_NAME}`,
    preview.split("\n").slice(0, MAX_PREVIEW_LINES),
  );
  const consented =
    existing !== undefined
      ? await prompts.confirmOverwrite(OPENCODE_CONFIG_FILE_NAME)
      : await prompts.confirm(`Write new file \`${OPENCODE_CONFIG_FILE_NAME}\`?`, false);
  if (!consented) {
    return { written: [], refused: [OPENCODE_CONFIG_FILE_NAME] };
  }
  await mergeJsonInto(input.paths.dest, OPENCODE_CONFIG_FILE_NAME, patch);
  return { written: [OPENCODE_CONFIG_FILE_NAME], refused: [] };
}

export async function writeOutputs(
  files: readonly MigratedFile[],
  input: SessionInput,
  prompts: InteractivePrompts,
): Promise<{ written: readonly string[]; refused: readonly string[] }> {
  if (input.options.dryRun) {
    return { written: [], refused: [] };
  }
  if (input.options.yes) {
    const outcome = await writeFiles(input.paths.dest, files, true);
    await mergeUserOpenCodeConfig(files, input);
    return outcome;
  }

  const declined = new Set<string>();
  for (const file of files) {
    const existing = await readExisting(input.paths.dest, file.relativePath);
    if (!(await consentToWrite(file, existing, prompts))) {
      declined.add(file.relativePath);
    }
  }
  const accepted = files.filter((file) => !declined.has(file.relativePath));
  const outcome = await writeFiles(input.paths.dest, accepted, true);
  const config = await consentToMergeConfig(accepted, input, prompts);
  return { written: [...outcome.written, ...config.written], refused: [...declined, ...config.refused] };
}
