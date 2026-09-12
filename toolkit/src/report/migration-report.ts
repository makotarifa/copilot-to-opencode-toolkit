import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";

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

export function renderReportMarkdown(report: MigrationReport): string {
  const lines = [
    "# Copilot to OpenCode migration report",
    "",
    `- Rows: ${report.rows.length}`,
    `- Warnings: ${report.warnings.length}`,
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
  lines.push("", "## Warnings", "");
  lines.push(...(report.warnings.length > 0 ? report.warnings.map((warning) => `- ${warning}`) : ["- _(none)_"]));
  lines.push("");
  return lines.join("\n");
}

export function renderReportJson(report: MigrationReport): string {
  return `${JSON.stringify(
    { summary: { rows: report.rows.length, warnings: report.warnings.length, counts: countRows(report.rows) }, rows: report.rows, warnings: report.warnings },
    null,
    2,
  )}\n`;
}
