import { TARGET_SCOPE_FLAG } from "../constants";
import { ArtifactFamily } from "../domain/artifact-family";
import { parseTargetScope, TargetScope } from "../domain/target-scope";

export interface CliOptions {
  readonly dryRun: boolean;
  readonly yes: boolean;
  readonly source?: string;
  readonly dest?: string;
  readonly cliHome?: string;
  readonly family?: ArtifactFamily;
  readonly scope?: TargetScope;
  readonly modelMapPath?: string;
  readonly teams?: readonly string[];
  readonly allowUnmappedModels: boolean;
  readonly allowOverwrite: boolean;
  readonly help: boolean;
  readonly errors: readonly string[];
}

const SOURCE_FLAG = "--source";
const DEST_FLAG = "--dest";
const CLI_HOME_FLAG = "--cli-home";
const FAMILY_FLAG = "--family";
const MODEL_MAP_FLAG = "--model-map";
export const TEAM_FLAG = "--team";
const YES_FLAG = "--yes";
const DRY_RUN_FLAG = "--dry-run";
const ALLOW_UNMAPPED_FLAG = "--allow-unmapped-models";
const ALLOW_OVERWRITE_FLAG = "--allow-overwrite";
const HELP_FLAGS = new Set(["--help", "-h"]);
const VALUE_FLAGS = new Set([
  SOURCE_FLAG,
  DEST_FLAG,
  CLI_HOME_FLAG,
  FAMILY_FLAG,
  MODEL_MAP_FLAG,
  TARGET_SCOPE_FLAG,
  TEAM_FLAG,
]);

const FAMILY_VALUES = new Set(Object.values(ArtifactFamily));

function isKnownFamily(value: string): value is ArtifactFamily {
  return FAMILY_VALUES.has(value as ArtifactFamily);
}

export function formatUsage(): string {
  return [
    "Usage: copilot-migrate [options]",
    "",
    "  --source <dir>            Copilot source root (default: copilot-source)",
    "  --dest <dir>              Output root (default: migrated; user scope: config home)",
    "  --scope <user|project>    Emit to the repo dest or the OpenCode config home (default: project)",
    "  --cli-home <dir>          Copilot CLI home to merge (optional)",
    "  --family <name>           Restrict to one artifact family",
    "  --team <name>             Repeatable; only migrate these teams (\"all\" = everything;",
    "                            omit = interactive selection or a visible multi-team warning)",
    "  --model-map <path>        Extra model-map overlay JSON",
    "  --allow-unmapped-models   Exit 0 despite unmapped/stale models",
    "  --allow-overwrite         --yes may replace existing targets instead of aborting",
    "  --dry-run                 Preview only; writes zero files",
    "  --yes                     Non-interactive run that writes the resolved dest",
    "  --help                    Show this help",
    "",
    "Without --dry-run or --yes the run is interactive: it previews every change",
    "and writes only the files you consent to. --yes writes non-interactively.",
  ].join("\n");
}

export function parseFlags(argv: readonly string[]): CliOptions {
  const errors: string[] = [];
  let source: string | undefined;
  let dest: string | undefined;
  let cliHome: string | undefined;
  let modelMapPath: string | undefined;
  const teams: string[] = [];
  let family: ArtifactFamily | undefined;
  let scope: TargetScope | undefined;
  let yes = false;
  let sawDryRun = false;
  let allowUnmappedModels = false;
  let allowOverwrite = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";
    if (HELP_FLAGS.has(token)) {
      help = true;
      continue;
    }
    if (token === YES_FLAG) {
      yes = true;
      continue;
    }
    if (token === DRY_RUN_FLAG) {
      sawDryRun = true;
      continue;
    }
    if (token === ALLOW_UNMAPPED_FLAG) {
      allowUnmappedModels = true;
      continue;
    }
    if (token === ALLOW_OVERWRITE_FLAG) {
      allowOverwrite = true;
      continue;
    }
    if (VALUE_FLAGS.has(token)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        errors.push(`Missing value for ${token}.`);
        continue;
      }
      index += 1;
      if (token === SOURCE_FLAG) source = value;
      else if (token === DEST_FLAG) dest = value;
      else if (token === CLI_HOME_FLAG) cliHome = value;
      else if (token === MODEL_MAP_FLAG) modelMapPath = value;
      else if (token === TEAM_FLAG) teams.push(value);
      else if (token === TARGET_SCOPE_FLAG) {
        const parsed = parseTargetScope(value);
        if (parsed === undefined) {
          errors.push(`Unknown scope \`${value}\`.`);
        } else {
          scope = parsed;
        }
      } else if (token === FAMILY_FLAG) {
        if (!isKnownFamily(value)) {
          errors.push(`Unknown family \`${value}\`.`);
        } else {
          family = value;
        }
      }
      continue;
    }
    errors.push(`Unknown option \`${token}\`.`);
  }

  return {
    dryRun: sawDryRun,
    yes,
    source,
    dest,
    cliHome,
    family,
    scope,
    modelMapPath,
    teams: teams.length > 0 ? teams : undefined,
    allowUnmappedModels,
    allowOverwrite,
    help,
    errors,
  };
}
