import { ArtifactFamily } from "../domain/artifact-family";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { ModelResolutionResult, ModelResolutionStatus } from "./model-resolver";

export function modelResultRows(
  result: ModelResolutionResult,
  family: ArtifactFamily,
  source: string,
): ReportRow[] {
  const rows: ReportRow[] = [];

  if (result.mappedFrom !== undefined) {
    const { original, dest, mapSource } = result.mappedFrom;
    rows.push({
      code: ReportCode.ModelMapped,
      severity: ReportSeverity.Info,
      family,
      source,
      message: `Model \`${original}\` → \`${dest}\` (from ${mapSource}).`,
    });
  }
  if (result.status === ModelResolutionStatus.Unmapped) {
    rows.push({
      code: ReportCode.UnmappedModel,
      severity: ReportSeverity.Error,
      family,
      source,
      message: `Unmapped Copilot model \`${result.originalMembers[0] ?? ""}\`; original value preserved.`,
    });
  }
  if (result.status === ModelResolutionStatus.Stale) {
    rows.push({
      code: ReportCode.StaleModelId,
      severity: ReportSeverity.Warning,
      family,
      source,
      message: `Stale model-map entry for \`${result.originalMembers[0] ?? ""}\`; gated like an unmapped model.`,
    });
  }
  if (result.originalMembers.length > 1) {
    rows.push({
      code: ReportCode.ModelFallback,
      severity: ReportSeverity.Info,
      family,
      source,
      message: `Ordered fallback list collapsed; original array \`[${result.originalMembers.join(", ")}]\` preserved in the OpenCode notes.`,
    });
  }

  return rows;
}
