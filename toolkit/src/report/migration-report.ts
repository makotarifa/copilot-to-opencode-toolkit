import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { deriveManualSteps, ManualStep, ManualStepKind } from "./manual-steps";

export interface MigrationReport {
  readonly rows: readonly ReportRow[];
  readonly warnings: readonly string[];
}

export type ReportCounts = Partial<Record<ReportCode, number>>;

export function countRows(rows: readonly ReportRow[]): ReportCounts {
  const counts: ReportCounts = {};
  for (const row of rows) {
    counts[row.code] = (counts[row.code] ?? 0) + 1;
  }
  return counts;
}

export function hasBlockingRows(rows: readonly ReportRow[]): boolean {
  return rows.some((row) => row.severity === ReportSeverity.Error);
}

function escapeCell(value: string): string {
  return value.split("|").join("\\|");
}

function manualStepLine(step: ManualStep, index: number): string {
  return `${index + 1}. **[${step.kind}]** \`${step.title}\` — ${step.detail} (${step.sources.length} source(s))`;
}

function renderManualStepsSection(steps: readonly ManualStep[]): string[] {
  if (steps.length === 0) {
    return ["- _(none — the toolkit completed every step automatically)_"];
  }
  return steps.map((step, index) => manualStepLine(step, index));
}

function countStepsOfKind(steps: readonly ManualStep[], kind: ManualStepKind): number {
  return steps.filter((step) => step.kind === kind).length;
}

export function renderReportMarkdown(report: MigrationReport): string {
  const manualSteps = deriveManualSteps(report.rows);
  const lines = [
    "# Copilot to OpenCode migration report",
    "",
    `- Rows: ${report.rows.length}`,
    `- Warnings: ${report.warnings.length}`,
    `- Manual steps: ${manualSteps.length}`,
    "",
    "## Rows",
    "",
    "| Code | Severity | Family | Source | Dest | Message |",
    "|---|---|---|---|---|---|",
  ];
  for (const row of report.rows) {
    lines.push(
      `| ${row.code} | ${row.severity} | ${row.family} | ${escapeCell(row.source)} | ${escapeCell(row.dest ?? "")} | ${escapeCell(row.message)} |`,
    );
  }
  lines.push("", "## Manual steps required", "");
  lines.push(...renderManualStepsSection(manualSteps));
  lines.push("", "## Warnings", "");
  lines.push(...(report.warnings.length > 0 ? report.warnings.map((warning) => `- ${warning}`) : ["- _(none)_"]));
  lines.push("");
  return lines.join("\n");
}

export function renderReportJson(report: MigrationReport): string {
  const manualSteps = deriveManualSteps(report.rows);
  const payload = {
    summary: {
      rows: report.rows.length,
      warnings: report.warnings.length,
      counts: countRows(report.rows),
      manualSteps: {
        mechanical: countStepsOfKind(manualSteps, ManualStepKind.Mechanical),
        decision: countStepsOfKind(manualSteps, ManualStepKind.Decision),
      },
    },
    rows: report.rows,
    warnings: report.warnings,
    manualSteps,
  };
  return `${JSON.stringify(payload, null, 2)}\n`;
}
