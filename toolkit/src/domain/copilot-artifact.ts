import { ArtifactFamily } from "./artifact-family";

export type FrontmatterValue =
  | string
  | number
  | boolean
  | null
  | FrontmatterValue[]
  | { [key: string]: FrontmatterValue };

export type Frontmatter = Record<string, FrontmatterValue>;

export interface InventoryItem {
  readonly family: ArtifactFamily;
  readonly absolutePath: string;
  readonly relativePath: string;
  readonly sha: string;
}

export interface FrontmatterParseNotice {
  readonly droppedLines: readonly string[];
}

export interface ParsedCopilotArtifact {
  readonly inventory: InventoryItem;
  readonly frontmatter: Frontmatter;
  readonly body: string;
  readonly parseNotice?: FrontmatterParseNotice;
}
