import { stringify as stringifyYaml } from "yaml";

import { Frontmatter } from "../domain/copilot-artifact";

export function serializeFrontmatter(frontmatter: Frontmatter): string {
  const yaml = stringifyYaml(frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n`;
}
