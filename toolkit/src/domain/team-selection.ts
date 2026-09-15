import { ArtifactFamily } from "./artifact-family";
import { InventoryItem } from "./copilot-artifact";

export enum TeamSelectionMode {
  Explicit = "explicit",
  AllImplicit = "all-implicit",
}

export interface TeamSelection {
  readonly mode: TeamSelectionMode;
  readonly teams: ReadonlySet<string> | undefined;
}

export interface TeamSelectionResolution {
  readonly selection: TeamSelection;
  readonly unknownTeams: readonly string[];
}

export type TeamNamespaceResolver = (item: InventoryItem) => string;

export const ALL_TEAMS_FLAG_VALUE = "all";

export function computeTeams(
  items: readonly InventoryItem[],
  namespace: TeamNamespaceResolver,
): Map<string, ReadonlySet<ArtifactFamily>> {
  const teams = new Map<string, Set<ArtifactFamily>>();
  for (const item of items) {
    const team = namespace(item);
    if (team.length === 0) {
      continue;
    }
    const families = teams.get(team) ?? new Set<ArtifactFamily>();
    families.add(item.family);
    teams.set(team, families);
  }
  return teams;
}

export function resolveTeamSelection(
  requested: readonly string[],
  discovered: ReadonlySet<string>,
): TeamSelectionResolution {
  if (requested.length === 0) {
    return { selection: { mode: TeamSelectionMode.AllImplicit, teams: undefined }, unknownTeams: [] };
  }
  if (requested.includes(ALL_TEAMS_FLAG_VALUE)) {
    return {
      selection: { mode: TeamSelectionMode.Explicit, teams: undefined },
      unknownTeams: requested.filter(
        (name) => name !== ALL_TEAMS_FLAG_VALUE && !discovered.has(name),
      ),
    };
  }
  return {
    selection: { mode: TeamSelectionMode.Explicit, teams: new Set(requested) },
    unknownTeams: requested.filter((name) => !discovered.has(name)),
  };
}

export function isTeamSelected(team: string, selection: TeamSelection): boolean {
  if (team.length === 0) {
    return true;
  }
  return selection.teams === undefined || selection.teams.has(team);
}

export function hasNoMatchingExplicitTeam(resolution: TeamSelectionResolution): boolean {
  const teams = resolution.selection.teams;
  return teams !== undefined && teams.size > 0 && resolution.unknownTeams.length === teams.size;
}

export function isEmptySelection(selection: TeamSelection): boolean {
  return selection.teams !== undefined && selection.teams.size === 0;
}
