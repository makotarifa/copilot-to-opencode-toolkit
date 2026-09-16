import { ArtifactFamily } from "../domain/artifact-family";
import { ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { EnvVarReference } from "../domain/env-var";
import { MigratedFile } from "../domain/opencode-artifact";
import { PromptPattern } from "../domain/prompt-pattern";
import { ProviderPreview } from "../domain/provider-preview";
import { ReportRow } from "../domain/report";
import { TargetScope } from "../domain/target-scope";
import { ModelResolverPort } from "../model/model-resolver";
import { AgentReferenceIndex } from "./reference-index";

export interface TransformContext {
  readonly destRoot: string;
  readonly scope?: TargetScope;
  readonly promptPattern?: PromptPattern;
  readonly models?: ModelResolverPort;
  readonly agentReferences?: AgentReferenceIndex;
}

export interface TransformResult {
  readonly files: readonly MigratedFile[];
  readonly rows: readonly ReportRow[];
  readonly warnings: readonly string[];
  readonly envVars?: readonly EnvVarReference[];
  readonly providerPreview?: ProviderPreview;
}

export interface Migrator {
  readonly family: ArtifactFamily;
  transform(
    artifact: ParsedCopilotArtifact,
    context: TransformContext,
  ): Promise<TransformResult>;
}
