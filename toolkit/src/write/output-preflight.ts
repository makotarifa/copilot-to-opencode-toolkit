import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";

import { ArtifactFamily } from "../domain/artifact-family";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { TargetScope } from "../domain/target-scope";
import { OPENCODE_CONFIG_FILE_NAME } from "../constants";
import { parseJsonc } from "../parse/jsonc";
import { ConfigCollision, ConfigSection, detectConfigCollisions } from "./config-conflicts";
import { buildOpenCodeConfigPatch } from "./opencode-config";
import { resolveWithin } from "./writer";

export interface OutputPreflightInput {
  readonly destRoot: string;
  readonly files: readonly MigratedFile[];
  readonly scope: TargetScope;
  readonly isYes: boolean;
  readonly dryRun: boolean;
  readonly allowOverwrite: boolean;
}

export interface OutputPreflightResult {
  readonly rows: readonly ReportRow[];
  readonly blockers: readonly ReportRow[];
  readonly blocked: boolean;
}

const EMPTY: OutputPreflightResult = { rows: [], blockers: [], blocked: false };

function fileRow(code: ReportCode, relativePath: string, message: string): ReportRow {
  return {
    code,
    severity: ReportSeverity.Error,
    family: ArtifactFamily.Unknown,
    source: relativePath,
    dest: relativePath,
    message,
  };
}

async function readExisting(target: string): Promise<string | undefined> {
  try {
    return await readFile(target, "utf8");
  } catch {
    return undefined;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function collisionRow(collision: ConfigCollision, isBlocking: boolean): ReportRow {
  return {
    code: ReportCode.ConfigOverwrite,
    severity: isBlocking ? ReportSeverity.Error : ReportSeverity.Info,
    family: collision.section === ConfigSection.Provider ? ArtifactFamily.Provider : ArtifactFamily.Mcp,
    source: OPENCODE_CONFIG_FILE_NAME,
    dest: OPENCODE_CONFIG_FILE_NAME,
    message: `Merging would overwrite existing \`${collision.section}.${collision.key}\` in \`${OPENCODE_CONFIG_FILE_NAME}\`.`,
  };
}

async function configPreflight(input: OutputPreflightInput): Promise<OutputPreflightResult> {
  if (input.scope !== TargetScope.User) {
    return EMPTY;
  }
  const target = resolveWithin(input.destRoot, OPENCODE_CONFIG_FILE_NAME);
  const existing = await readExisting(target);
  if (existing === undefined || existing.trim().length === 0) {
    return EMPTY;
  }
  let parsed;
  try {
    parsed = parseJsonc(existing);
  } catch {
    const row = fileRow(
      ReportCode.ConfigInvalid,
      OPENCODE_CONFIG_FILE_NAME,
      `Existing \`${OPENCODE_CONFIG_FILE_NAME}\` is not valid JSONC; aborting with zero writes.`,
    );
    return { rows: [row], blockers: [row], blocked: true };
  }
  const collisions = detectConfigCollisions(parsed, buildOpenCodeConfigPatch(input.files));
  const blocked = input.isYes && collisions.length > 0 && !input.allowOverwrite;
  const rows = collisions.map((collision) => collisionRow(collision, blocked));
  return { rows, blockers: blocked ? rows : [], blocked };
}

async function existingTargetPreflight(input: OutputPreflightInput): Promise<OutputPreflightResult> {
  if (!input.isYes || input.allowOverwrite) {
    return EMPTY;
  }
  const blockers: ReportRow[] = [];
  for (const file of input.files) {
    if (await exists(resolveWithin(input.destRoot, file.relativePath))) {
      blockers.push(
        fileRow(
          ReportCode.Overwritten,
          file.relativePath,
          `Refusing to overwrite existing \`${file.relativePath}\`; pass --allow-overwrite to replace it.`,
        ),
      );
    }
  }
  return { rows: blockers, blockers, blocked: blockers.length > 0 };
}

export async function preflightOutputs(
  input: OutputPreflightInput,
): Promise<OutputPreflightResult> {
  if (input.dryRun) {
    return EMPTY;
  }
  const config = await configPreflight(input);
  const targets = await existingTargetPreflight(input);
  return {
    rows: [...config.rows, ...targets.rows],
    blockers: [...config.blockers, ...targets.blockers],
    blocked: config.blocked || targets.blocked,
  };
}
