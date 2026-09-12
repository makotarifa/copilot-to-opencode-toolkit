const MAX_DIFF_LINES = 400;

export enum DiffOperationKind {
  Context = "context",
  Remove = "remove",
  Add = "add",
}

interface DiffOperation {
  readonly kind: DiffOperationKind;
  readonly line: string;
}

function buildLcsTable(left: readonly string[], right: readonly string[]): number[][] {
  const table: number[][] = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0),
  );
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      const row = table[i] ?? [];
      const diagonal = table[i + 1]?.[j + 1] ?? 0;
      const down = table[i + 1]?.[j] ?? 0;
      const rightward = table[i]?.[j + 1] ?? 0;
      row[j] = left[i] === right[j] ? diagonal + 1 : Math.max(down, rightward);
    }
  }
  return table;
}

function matchingSegments(left: readonly string[], right: readonly string[]): DiffOperation[] {
  const table = buildLcsTable(left, right);
  const operations: DiffOperation[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      operations.push({ kind: DiffOperationKind.Context, line: left[i] ?? "" });
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      operations.push({ kind: DiffOperationKind.Remove, line: left[i] ?? "" });
      i += 1;
    } else {
      operations.push({ kind: DiffOperationKind.Add, line: right[j] ?? "" });
      j += 1;
    }
  }
  while (i < left.length) {
    operations.push({ kind: DiffOperationKind.Remove, line: left[i] ?? "" });
    i += 1;
  }
  while (j < right.length) {
    operations.push({ kind: DiffOperationKind.Add, line: right[j] ?? "" });
    j += 1;
  }
  return operations;
}

const PREFIX: Record<DiffOperationKind, string> = {
  [DiffOperationKind.Context]: " ",
  [DiffOperationKind.Remove]: "-",
  [DiffOperationKind.Add]: "+",
};

export function renderDiff(existing: string | undefined, proposed: string, header: string): string {
  const proposedLines = proposed.split("\n");
  if (existing === undefined) {
    return [`${header} (new file)`, ...proposedLines.map((line) => `+${line}`)].join("\n");
  }

  const existingLines = existing.split("\n");
  if (existingLines.length > MAX_DIFF_LINES || proposedLines.length > MAX_DIFF_LINES) {
    return `${header} (diff too large; proposed content follows)\n${proposed}`;
  }

  const operations = matchingSegments(existingLines, proposedLines);
  return [header, ...operations.map((operation) => `${PREFIX[operation.kind]}${operation.line}`)].join("\n");
}
