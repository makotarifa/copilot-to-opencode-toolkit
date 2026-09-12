import { OpenCodeNote } from "../domain/opencode-artifact";
import { ModelResolutionResult, ModelResolutionStatus } from "./model-resolver";

export function formatOriginalModel(value: string | string[] | undefined): string {
  return Array.isArray(value) ? `[${value.join(", ")}]` : (value ?? "");
}

export function buildModelNotes(resolution: ModelResolutionResult): OpenCodeNote[] {
  if (resolution.status === ModelResolutionStatus.NotSet) {
    return [];
  }

  const notes: OpenCodeNote[] = [
    { label: "Model (original)", value: `\`${formatOriginalModel(resolution.originalValue)}\`` },
  ];
  if (resolution.resolved !== undefined) {
    notes.push({ label: "Model (resolved)", value: `\`${resolution.resolved}\`` });
  }
  if (resolution.remainingMembers.length > 0) {
    notes.push({
      label: "Model fallback members",
      value: resolution.remainingMembers.map((member) => `\`${member}\``).join(", "),
    });
  }
  return notes;
}
