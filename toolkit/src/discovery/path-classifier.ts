import { ArtifactFamily } from "../domain/artifact-family";

const AGENT_SUFFIX = ".agent.md";
const LEGACY_AGENT_SUFFIX = ".chatmode.md";
const PROMPT_SUFFIX = ".prompt.md";
const INSTRUCTIONS_SUFFIX = ".instructions.md";
const COPILOT_INSTRUCTIONS_BASENAME = "copilot-instructions.md";
const SKILL_BASENAME = "SKILL.md";
const HOOKS_SEGMENT = "hooks";
const SKILLS_SEGMENT = "skills";
const MCP_BASENAMES = new Set(["mcp.json", ".mcp.json", "mcp-config.json"]);
const PROVIDER_BASENAMES = new Set([
  "user-model-config.json",
  "model-config.json",
  "provider-config.json",
]);

export function toPosixPath(value: string): string {
  return value.split("\\").join("/");
}

export function basenameOf(relativePath: string): string {
  const normalized = toPosixPath(relativePath);
  const separatorIndex = normalized.lastIndexOf("/");
  return separatorIndex === -1 ? normalized : normalized.slice(separatorIndex + 1);
}

function hasSegment(relativePath: string, segment: string): boolean {
  return toPosixPath(relativePath).split("/").includes(segment);
}

export function classifyCopilotPath(relativePath: string): ArtifactFamily {
  const normalized = toPosixPath(relativePath);
  const basename = basenameOf(normalized);

  if (basename.endsWith(AGENT_SUFFIX) || basename.endsWith(LEGACY_AGENT_SUFFIX)) {
    return ArtifactFamily.Agent;
  }
  if (basename.endsWith(PROMPT_SUFFIX)) {
    return ArtifactFamily.Prompt;
  }
  if (basename.endsWith(INSTRUCTIONS_SUFFIX) || basename === COPILOT_INSTRUCTIONS_BASENAME) {
    return ArtifactFamily.Instructions;
  }
  if (basename === SKILL_BASENAME && hasSegment(normalized, SKILLS_SEGMENT)) {
    return ArtifactFamily.Skill;
  }
  if (MCP_BASENAMES.has(basename)) {
    return ArtifactFamily.Mcp;
  }
  if (PROVIDER_BASENAMES.has(basename)) {
    return ArtifactFamily.Provider;
  }
  if (hasSegment(normalized, HOOKS_SEGMENT)) {
    return ArtifactFamily.Hooks;
  }
  return ArtifactFamily.Unknown;
}
