import { MigratedFile } from "../domain/opencode-artifact";

export enum ConflictKind {
  DuplicatePath = "duplicate-path",
  DuplicateSkill = "duplicate-skill",
}

export interface Conflict {
  readonly kind: ConflictKind;
  readonly path: string;
  readonly message: string;
}

const SKILL_PATH_PATTERN = /^skills\/[^/]+\/SKILL\.md$/;

export function detectConflicts(files: readonly MigratedFile[]): Conflict[] {
  const seenPaths = new Set<string>();
  const conflicts: Conflict[] = [];

  for (const file of files) {
    if (seenPaths.has(file.relativePath)) {
      const isSkill = SKILL_PATH_PATTERN.test(file.relativePath);
      conflicts.push({
        kind: isSkill ? ConflictKind.DuplicateSkill : ConflictKind.DuplicatePath,
        path: file.relativePath,
        message: isSkill
          ? `Duplicate skill name in \`${file.relativePath}\`.`
          : `Two artifacts target the same path \`${file.relativePath}\`.`,
      });
    }
    seenPaths.add(file.relativePath);
  }

  return conflicts;
}
