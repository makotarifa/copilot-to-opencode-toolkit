export enum ArtifactFamily {
  Agent = "agent",
  Prompt = "prompt",
  Instructions = "instructions",
  Skill = "skill",
  Mcp = "mcp",
  Provider = "provider",
  Hooks = "hooks",
  Unknown = "unknown",
}

export const FAMILY_LABELS: Record<ArtifactFamily, string> = {
  [ArtifactFamily.Agent]: "custom agent",
  [ArtifactFamily.Prompt]: "prompt",
  [ArtifactFamily.Instructions]: "instructions",
  [ArtifactFamily.Skill]: "skill",
  [ArtifactFamily.Mcp]: "mcp config",
  [ArtifactFamily.Provider]: "model provider config",
  [ArtifactFamily.Hooks]: "hooks",
  [ArtifactFamily.Unknown]: "unknown file",
};
