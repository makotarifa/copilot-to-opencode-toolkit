import { ArtifactFamily } from "../domain/artifact-family";
import { Frontmatter, ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { appendOpenCodeNotes, MigratedFile, OpenCodeNote } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { directoriesForScope, TargetScope } from "../domain/target-scope";
import { getString } from "../parse/frontmatter-values";
import { serializeFrontmatter } from "../parse/frontmatter-serializer";
import { Migrator, TransformContext, TransformResult } from "./migrator";
import { parentDirectoryName, stringifyFrontmatterValue } from "./transform-helpers";

const SKILL_FILE_NAME = "SKILL.md";
const NAME_KEY = "name";
const DESCRIPTION_KEY = "description";
const METADATA_KEY = "metadata";
const PRESERVED_KEYS = new Set([NAME_KEY, DESCRIPTION_KEY]);
const DEFAULT_DESCRIPTION_PREFIX = "Migrated Copilot skill";

interface SkillRender {
  readonly directoryName: string;
  readonly content: string;
  readonly warnings: readonly string[];
}

function collectMetadata(frontmatter: Frontmatter): Record<string, string> {
  const metadata: Record<string, string> = {};
  for (const [key, value] of Object.entries(frontmatter)) {
    if (value === undefined || PRESERVED_KEYS.has(key)) {
      continue;
    }
    metadata[key] = stringifyFrontmatterValue(value);
  }
  return metadata;
}

function resolveDirectoryName(artifact: ParsedCopilotArtifact): string {
  const declaredName = getString(artifact.frontmatter, NAME_KEY);
  if (declaredName !== undefined && declaredName.trim().length > 0) {
    return declaredName.trim();
  }
  return parentDirectoryName(artifact.inventory.relativePath);
}

function buildFrontmatter(directoryName: string, description: string, metadata: Record<string, string>): Frontmatter {
  const frontmatter: Frontmatter = { [NAME_KEY]: directoryName, [DESCRIPTION_KEY]: description };
  if (Object.keys(metadata).length > 0) {
    frontmatter[METADATA_KEY] = metadata;
  }
  return frontmatter;
}

function renderSkill(artifact: ParsedCopilotArtifact): SkillRender {
  const directoryName = resolveDirectoryName(artifact);
  const declaredDescription = getString(artifact.frontmatter, DESCRIPTION_KEY);
  const warnings: string[] = [];

  if (declaredDescription === undefined) {
    warnings.push(`Skill \`${artifact.inventory.relativePath}\` has no description; a placeholder was generated.`);
  }

  const description = declaredDescription ?? `${DEFAULT_DESCRIPTION_PREFIX}: ${directoryName}`;
  const metadata = collectMetadata(artifact.frontmatter);
  const frontmatter = buildFrontmatter(directoryName, description, metadata);

  const notes: OpenCodeNote[] = [
    { label: "Source", value: `\`${artifact.inventory.relativePath}\`` },
    {
      label: "Frontmatter",
      value:
        "`name`/`description` preserved; extra Copilot fields moved under `metadata` (OpenCode ignores unknown top-level fields)",
    },
    {
      label: "Before promoting",
      value: "run `check-duplicates` so the OpenCode skill name stays unique",
    },
  ];

  const originalName = getString(artifact.frontmatter, NAME_KEY);
  if (originalName !== undefined && originalName !== directoryName) {
    notes.push({
      label: "Directory",
      value: `output directory \`${directoryName}\` derived from the declared skill name`,
    });
  }

  const content = `${serializeFrontmatter(frontmatter)}${appendOpenCodeNotes(artifact.body, notes)}`;
  return { directoryName, content, warnings };
}

export class SkillsMigrator implements Migrator {
  readonly family = ArtifactFamily.Skill;

  async transform(artifact: ParsedCopilotArtifact, context: TransformContext): Promise<TransformResult> {
    const rendered = renderSkill(artifact);
    const skillsDir = directoriesForScope(context.scope ?? TargetScope.Project).skills;
    const relativePath = `${skillsDir}/${rendered.directoryName}/${SKILL_FILE_NAME}`;
    const files: MigratedFile[] = [{ relativePath, content: rendered.content }];
    const rows: ReportRow[] = [
      {
        code: ReportCode.Migrated,
        severity: ReportSeverity.Info,
        family: this.family,
        source: artifact.inventory.relativePath,
        dest: relativePath,
        message: "Migrated skill near-literally; body preserved verbatim.",
      },
    ];

    return { files, rows, warnings: rendered.warnings };
  }
}
