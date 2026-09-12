import { OFFICIAL_OPEN_CODE_NOTES_HEADER } from "../constants";

export interface OpenCodeNote {
  readonly label: string;
  readonly value: string;
}

export interface MigratedFile {
  readonly relativePath: string;
  readonly content: string;
}

export function renderOpenCodeNotes(notes: readonly OpenCodeNote[]): string {
  const lines = notes.map((note) => `- ${note.label}: ${note.value}`);
  return [OFFICIAL_OPEN_CODE_NOTES_HEADER, "", ...lines, ""].join("\n");
}

export function appendOpenCodeNotes(body: string, notes: readonly OpenCodeNote[]): string {
  const trimmedBody = body.replace(/\s+$/, "");
  return `${trimmedBody}\n\n${renderOpenCodeNotes(notes)}`;
}
