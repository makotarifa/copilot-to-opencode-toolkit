const MAX_INSTRUCTIONS_FILES = 5;
const MAX_INSTRUCTIONS_BYTES = 8192;

export interface InstructionsBudget {
  readonly maxFiles: number;
  readonly maxBytes: number;
}

export const DEFAULT_INSTRUCTIONS_BUDGET: InstructionsBudget = {
  maxFiles: MAX_INSTRUCTIONS_FILES,
  maxBytes: MAX_INSTRUCTIONS_BYTES,
};

export interface BudgetEntry {
  readonly outputName: string;
  readonly bytes: number;
}

export function decideDemoted(entries: readonly BudgetEntry[], budget: InstructionsBudget): Set<string> {
  const demoted = new Set<string>();
  let count = entries.length;
  let bytes = entries.reduce((total, entry) => total + entry.bytes, 0);
  const bySizeDesc = [...entries].sort((left, right) => right.bytes - left.bytes);

  for (const entry of bySizeDesc) {
    if ((count <= budget.maxFiles && bytes <= budget.maxBytes) || count <= 1) {
      break;
    }
    demoted.add(entry.outputName);
    count -= 1;
    bytes -= entry.bytes;
  }
  return demoted;
}
