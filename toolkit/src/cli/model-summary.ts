import { ReportCode } from "../domain/report";
import { MigrationReport } from "../report/migration-report";

const MODEL_SUMMARY_CODES = new Set<ReportCode>([
  ReportCode.ModelMapped,
  ReportCode.ModelFallback,
  ReportCode.UnmappedModel,
  ReportCode.StaleModelId,
]);

export function printModelSummary(report: MigrationReport): void {
  const rows = report.rows.filter((row) => MODEL_SUMMARY_CODES.has(row.code));
  if (rows.length === 0) {
    return;
  }
  console.log("Model resolution:");
  for (const row of rows) {
    console.log(`  [${row.code}] ${row.message}`);
  }
}
