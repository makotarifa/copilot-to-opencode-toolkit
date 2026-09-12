import { ArtifactFamily } from "../domain/artifact-family";
import { ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import {
  AGENTS_INDEX_SNIPPET_FILE,
  EXCLUDED_AGENTS_FILE,
  FRAGMENTS_DIR_NAME,
  INSTRUCTIONS_DIR_NAME,
  INSTRUCTIONS_SNIPPET_FILE,
  PROMOTED_INSTRUCTIONS_DIR,
} from "../constants";
import {
  buildInstructionRows,
  InstructionRecord,
  renderInstructionContent,
  toInstructionRecord,
} from "./instructions-migrator";
import { BudgetEntry, decideDemoted, DEFAULT_INSTRUCTIONS_BUDGET, InstructionsBudget } from "./instructions-budget";
import { sharedPrefixSlug } from "./instructions-prefix";

export { DEFAULT_INSTRUCTIONS_BUDGET } from "./instructions-budget";
export type { InstructionsBudget } from "./instructions-budget";
export { sharedPrefixSlug } from "./instructions-prefix";

const INDEX_PREAMBLE =
  "CRITICAL: use your Read tool on a need-to-know basis; do NOT preload all references";

export interface InstructionsBundleOptions {
  readonly budget?: InstructionsBudget;
  readonly overrideBudget?: boolean;
  readonly promotedInstructionsDir?: string;
}

export interface InstructionsBundle {
  readonly files: readonly MigratedFile[];
  readonly rows: readonly ReportRow[];
  readonly warnings: readonly string[];
}

interface BundleEntry extends BudgetEntry {
  readonly artifact: ParsedCopilotArtifact;
  readonly record: InstructionRecord;
  readonly content: string;
}

function buildEntries(
  artifacts: readonly ParsedCopilotArtifact[],
  prefixSlug: string | undefined,
): BundleEntry[] {
  return artifacts.map((artifact) => {
    const record = toInstructionRecord(artifact);
    const outputName = prefixSlug === undefined ? record.baseName : `${prefixSlug}-${record.baseName}`;
    const content = renderInstructionContent(artifact);
    return { artifact, record, outputName, content, bytes: Buffer.byteLength(content, "utf8") };
  });
}

function buildSnippet(
  entries: readonly BundleEntry[],
  demoted: ReadonlySet<string>,
  prefixSlug: string | undefined,
  promotedInstructionsDir: string,
): MigratedFile {
  const selected = entries.filter((entry) => !demoted.has(entry.outputName));
  const entriesValue =
    demoted.size > 0
      ? selected.map((entry) => `${promotedInstructionsDir}/${entry.outputName}`)
      : [`${promotedInstructionsDir}/${prefixSlug ? `${prefixSlug}-` : ""}*.md`];

  return {
    relativePath: `${FRAGMENTS_DIR_NAME}/${INSTRUCTIONS_SNIPPET_FILE}`,
    content: `${JSON.stringify(entriesValue, null, 2)}\n`,
  };
}

function buildIndex(
  entries: readonly BundleEntry[],
  demoted: ReadonlySet<string>,
  promotedInstructionsDir: string,
): MigratedFile {
  const lines = [INDEX_PREAMBLE, ""];
  for (const entry of entries) {
    if (demoted.has(entry.outputName)) {
      lines.push(
        `- When editing files matching \`${entry.record.applyTo ?? "**"}\`, read \`${promotedInstructionsDir}/${entry.outputName}\``,
      );
    }
  }
  lines.push("");
  return { relativePath: `${FRAGMENTS_DIR_NAME}/${AGENTS_INDEX_SNIPPET_FILE}`, content: lines.join("\n") };
}

function buildExcludedAgents(entries: readonly BundleEntry[]): MigratedFile {
  const withExclusions = entries.filter((entry) => entry.record.excludeAgent !== undefined);
  const lines = [
    "# Excluded agents",
    "",
    "Copilot `excludeAgent` has no native OpenCode equivalent; this table is advisory.",
    "",
    "| Instruction | Excluded agent | Suggested enforcement |",
    "|---|---|---|",
  ];
  if (withExclusions.length === 0) {
    lines.push("| _(none)_ | | |");
  }
  for (const entry of withExclusions) {
    lines.push(
      `| \`${entry.record.source}\` | \`${entry.record.excludeAgent}\` | post-/review \`agent.<n>.permission\` |`,
    );
  }
  lines.push("");
  return { relativePath: `${FRAGMENTS_DIR_NAME}/${EXCLUDED_AGENTS_FILE}`, content: lines.join("\n") };
}

function fragmentRow(relativePath: string, message: string): ReportRow {
  return {
    code: ReportCode.Migrated,
    severity: ReportSeverity.Info,
    family: ArtifactFamily.Instructions,
    source: "(aggregate)",
    dest: relativePath,
    message,
  };
}

export function buildInstructionsBundle(
  artifacts: readonly ParsedCopilotArtifact[],
  options: InstructionsBundleOptions,
): InstructionsBundle {
  const prefixSlug = sharedPrefixSlug(artifacts.map(toInstructionRecord));
  const entries = buildEntries(artifacts, prefixSlug);
  const budget = options.budget ?? DEFAULT_INSTRUCTIONS_BUDGET;
  const promotedInstructionsDir = options.promotedInstructionsDir ?? PROMOTED_INSTRUCTIONS_DIR;
  const demoted =
    options.overrideBudget === true ? new Set<string>() : decideDemoted(entries, budget);
  const warnings: string[] = [];
  const rows: ReportRow[] = [];

  const files: MigratedFile[] = entries.map((entry) => ({
    relativePath: `${INSTRUCTIONS_DIR_NAME}/${entry.outputName}`,
    content: entry.content,
  }));
  for (const entry of entries) {
    rows.push(...buildInstructionRows(entry.record, `${INSTRUCTIONS_DIR_NAME}/${entry.outputName}`));
  }

  files.push(buildSnippet(entries, demoted, prefixSlug, promotedInstructionsDir));
  rows.push(fragmentRow(`${FRAGMENTS_DIR_NAME}/${INSTRUCTIONS_SNIPPET_FILE}`, "instructions[] fragment generated."));

  files.push(buildExcludedAgents(entries));
  rows.push(fragmentRow(`${FRAGMENTS_DIR_NAME}/${EXCLUDED_AGENTS_FILE}`, "excluded-agents table generated."));

  if (demoted.size > 0) {
    files.push(buildIndex(entries, demoted, promotedInstructionsDir));
    rows.push(fragmentRow(`${FRAGMENTS_DIR_NAME}/${AGENTS_INDEX_SNIPPET_FILE}`, "lazy-load index generated."));
    rows.push({
      code: ReportCode.BudgetExceeded,
      severity: ReportSeverity.Warning,
      family: ArtifactFamily.Instructions,
      source: "(aggregate)",
      message: `Instruction budget exceeded (${budget.maxFiles} files / ${budget.maxBytes} bytes); ${demoted.size} file(s) demoted to lazy-load pointers.`,
    });
    warnings.push(
      `BUDGET_EXCEEDED: ${demoted.size} instruction file(s) demoted; pass an interactive override to keep them always-on.`,
    );
  }

  return { files, rows, warnings };
}
