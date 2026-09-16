import { MigrationReport } from "../report/migration-report";
import { deriveManualSteps, ManualStep, ManualStepKind } from "../report/manual-steps";

const HEADING_PREFIX = "Manual steps required";
const NONE_MESSAGE = "No manual steps required — review + promote as usual.";

function kindLabel(kind: ManualStepKind): string {
  switch (kind) {
    case ManualStepKind.Mechanical:
      return "do this by hand";
    case ManualStepKind.Decision:
      return "needs a decision";
    case ManualStepKind.Automatic:
      return "handled automatically";
    default: {
      const exhaustiveCheck: never = kind;
      throw new Error(`Unhandled manual step kind: ${exhaustiveCheck}`);
    }
  }
}

function formatStep(step: ManualStep, index: number): string {
  return `  ${index + 1}. [${kindLabel(step.kind)}] ${step.title}: ${step.detail} (${step.sources.length} source(s))`;
}

export function printManualStepsSummary(report: MigrationReport): void {
  const steps = deriveManualSteps(report.rows);
  if (steps.length === 0) {
    console.log(NONE_MESSAGE);
    return;
  }
  console.log(`${HEADING_PREFIX} (${steps.length}):`);
  steps.forEach((step, index) => console.log(formatStep(step, index)));
}
