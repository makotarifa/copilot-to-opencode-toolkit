import { ArtifactFamily } from "../domain/artifact-family";
import { ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { TeamSelectionResolution, ALL_TEAMS_FLAG_VALUE } from "../domain/team-selection";
import { namespaceOf } from "../transform/transform-helpers";
import { TEAM_FLAG } from "./flag-parser";

const TEAM_BREAKDOWN_SOURCE = "(team breakdown)";
const TEAM_SELECTION_SOURCE = "(team selection)";
const MULTI_TEAM_SOURCE = "(all teams)";

function countFamilies(artifacts: readonly ParsedCopilotArtifact[]): Map<ArtifactFamily, number> {
  const counts = new Map<ArtifactFamily, number>();
  for (const artifact of artifacts) {
    const family = artifact.inventory.family;
    counts.set(family, (counts.get(family) ?? 0) + 1);
  }
  return counts;
}

function groupByTeam(
  artifacts: readonly ParsedCopilotArtifact[],
): Map<string, ParsedCopilotArtifact[]> {
  const teams = new Map<string, ParsedCopilotArtifact[]>();
  for (const artifact of artifacts) {
    const team = namespaceOf(artifact.inventory.relativePath);
    if (team.length === 0) {
      continue;
    }
    teams.set(team, [...(teams.get(team) ?? []), artifact]);
  }
  return teams;
}

function formatFamilyCounts(counts: ReadonlyMap<ArtifactFamily, number>): string {
  return [...counts.entries()].map(([family, count]) => `${family}: ${count}`).join(", ");
}

export function multiTeamRow(artifacts: readonly ParsedCopilotArtifact[]): ReportRow {
  const grouped = groupByTeam(artifacts);
  const detail = [...grouped.entries()]
    .map(([team, members]) => `${team} → ${formatFamilyCounts(countFamilies(members))}`)
    .join("; ");
  return {
    code: ReportCode.MultiTeam,
    severity: ReportSeverity.Warning,
    family: ArtifactFamily.Unknown,
    source: MULTI_TEAM_SOURCE,
    message: `Migrating ${grouped.size} teams without an explicit ${TEAM_FLAG} selection: ${detail}. Pass ${TEAM_FLAG} <name> (repeatable) or ${TEAM_FLAG} all.`,
  };
}

export function teamBreakdownRows(artifacts: readonly ParsedCopilotArtifact[]): ReportRow[] {
  return [...groupByTeam(artifacts).entries()].map(([team, members]) => ({
    code: ReportCode.Migrated,
    severity: ReportSeverity.Info,
    family: ArtifactFamily.Unknown,
    source: `${TEAM_BREAKDOWN_SOURCE}: ${team}`,
    message: `Team \`${team}\` selected: ${formatFamilyCounts(countFamilies(members))}.`,
  }));
}

export function unknownTeamRows(unknownTeams: readonly string[]): ReportRow[] {
  return unknownTeams.map((team) => ({
    code: ReportCode.ManualReview,
    severity: ReportSeverity.Warning,
    family: ArtifactFamily.Unknown,
    source: `${TEAM_SELECTION_SOURCE}: ${team}`,
    message: `${TEAM_FLAG} \`${team}\` matches no discovered team; no artifacts from it were migrated.`,
  }));
}

export function teamSelectionErrorRow(resolution: TeamSelectionResolution): ReportRow {
  const requested = [...(resolution.selection.teams ?? [])].join(", ");
  return {
    code: ReportCode.TeamSelection,
    severity: ReportSeverity.Error,
    family: ArtifactFamily.Unknown,
    source: TEAM_SELECTION_SOURCE,
    message: `None of the requested teams (${requested}) match a discovered team; the run migrated nothing.`,
  };
}

export function emptyTeamSelectionRow(): ReportRow {
  return {
    code: ReportCode.TeamSelection,
    severity: ReportSeverity.Error,
    family: ArtifactFamily.Unknown,
    source: TEAM_SELECTION_SOURCE,
    message: `No teams were selected; pass ${TEAM_FLAG} <name> (repeatable) or ${TEAM_FLAG} ${ALL_TEAMS_FLAG_VALUE}.`,
  };
}
