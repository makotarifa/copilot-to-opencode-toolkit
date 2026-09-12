import { ArtifactFamily } from "../../src/domain/artifact-family";
import { InventoryItem, ParsedCopilotArtifact } from "../../src/domain/copilot-artifact";
import { parseFrontmatterFile } from "../../src/parse/frontmatter-parser";

import { join } from "node:path";

export async function loadMarkdownArtifact(
  root: string,
  relativePath: string,
  family: ArtifactFamily,
): Promise<ParsedCopilotArtifact> {
  const absolutePath = join(root, relativePath);
  const parsed = await parseFrontmatterFile(absolutePath);
  const inventory: InventoryItem = {
    family,
    absolutePath,
    relativePath,
    sha: "fixture-sha",
  };
  return { inventory, frontmatter: parsed.frontmatter, body: parsed.body };
}
