import { ArtifactFamily } from "../domain/artifact-family";
import { AgentsMigrator } from "./agents-migrator";
import { HooksMigrator } from "./hooks-migrator";
import { InstructionsMigrator } from "./instructions-migrator";
import { McpMigrator } from "./mcp-migrator";
import { Migrator } from "./migrator";
import { PromptsMigrator } from "./prompts-migrator";
import { ProviderMigrator } from "./provider-migrator";
import { SkillsMigrator } from "./skills-migrator";

export class MigratorRegistry {
  private readonly migrators = new Map<ArtifactFamily, Migrator>();

  register(migrator: Migrator): void {
    this.migrators.set(migrator.family, migrator);
  }

  get(family: ArtifactFamily): Migrator | undefined {
    return this.migrators.get(family);
  }

  has(family: ArtifactFamily): boolean {
    return this.migrators.has(family);
  }

  families(): ArtifactFamily[] {
    return [...this.migrators.keys()];
  }
}

export function buildDefaultRegistry(): MigratorRegistry {
  const registry = new MigratorRegistry();
  registry.register(new AgentsMigrator());
  registry.register(new PromptsMigrator());
  registry.register(new InstructionsMigrator());
  registry.register(new SkillsMigrator());
  registry.register(new McpMigrator());
  registry.register(new ProviderMigrator());
  registry.register(new HooksMigrator());
  return registry;
}

