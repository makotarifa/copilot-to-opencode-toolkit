import { ArtifactFamily } from "../domain/artifact-family";
import { FrontmatterValue, ParsedCopilotArtifact } from "../domain/copilot-artifact";
import { EnvVarReference } from "../domain/env-var";
import { MigratedFile } from "../domain/opencode-artifact";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { FRAGMENTS_DIR_NAME, MCP_FRAGMENT_FILE } from "../constants";
import { getString, getStringArray, isFrontmatterRecord } from "../parse/frontmatter-values";
import { parseStructuredDocument } from "../parse/frontmatter-parser";
import {
  hasEmbeddedCredentials,
  hasPlaintextSecret,
  normalizeEnvReferences,
  stripEmbeddedCredentials,
  toEnvReference,
  toEnvVarName,
} from "../safety/secret-scanner";
import { Migrator, TransformContext, TransformResult } from "./migrator";

const SERVERS_KEYS = ["servers", "mcpServers"];
const ENV_KEY = "env";
const COMMAND_KEY = "command";
const ARGS_KEY = "args";
const URL_KEY = "url";

interface McpBuild {
  readonly entries: Record<string, FrontmatterValue>;
  readonly envVars: EnvVarReference[];
  readonly rows: ReportRow[];
  readonly warnings: string[];
}

function readServers(document: FrontmatterValue): Record<string, FrontmatterValue> {
  if (!isFrontmatterRecord(document)) {
    return {};
  }
  for (const key of SERVERS_KEYS) {
    const value = document[key];
    if (isFrontmatterRecord(value)) {
      return value;
    }
  }
  return {};
}

function buildEnvironment(
  serverName: string,
  server: Record<string, FrontmatterValue>,
  build: McpBuild,
): Record<string, FrontmatterValue> {
  const environment: Record<string, FrontmatterValue> = {};
  const env = server[ENV_KEY];
  if (!isFrontmatterRecord(env)) {
    return environment;
  }

  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string") {
      continue;
    }
    const normalized = normalizeEnvReferences(value);
    for (const variable of normalized.variables) {
      build.envVars.push({ name: variable, consumer: `mcp:${serverName}` });
    }
    if (normalized.variables.length === 0 && hasPlaintextSecret(value)) {
      const variable = toEnvVarName(`${serverName}_${key}`);
      const reference = toEnvReference(variable);
      environment[key] = reference;
      build.envVars.push({ name: variable, consumer: `mcp:${serverName}` });
      build.rows.push({
        code: ReportCode.SecretNormalized,
        severity: ReportSeverity.Warning,
        family: ArtifactFamily.Mcp,
        source: serverName,
        message: `Plaintext secret in \`${key}\` replaced with \`${reference}\`.`,
      });
      build.warnings.push(`SECRET_NORMALIZED: mcp server \`${serverName}\` \`${key}\` forced to \`${reference}\`.`);
      continue;
    }
    environment[key] = normalized.text;
  }
  return environment;
}

function buildRemoteEntry(
  serverName: string,
  url: string,
  build: McpBuild,
): Record<string, FrontmatterValue> | undefined {
  if (!hasEmbeddedCredentials(url)) {
    return { type: "remote", url, enabled: false };
  }

  const trimmed = url.trim();
  const stripped = stripEmbeddedCredentials(trimmed);
  if (stripped === trimmed || hasEmbeddedCredentials(stripped)) {
    build.rows.push({
      code: ReportCode.ManualReview,
      severity: ReportSeverity.Error,
      family: ArtifactFamily.Mcp,
      source: serverName,
      message: `MCP server \`${serverName}\` url carries embedded credentials that could not be stripped; no fragment emitted.`,
    });
    build.warnings.push(`EMBEDDED_CREDENTIALS: mcp server \`${serverName}\` url credentials could not be stripped; fragment rejected.`);
    return undefined;
  }

  build.rows.push({
    code: ReportCode.SecretNormalized,
    severity: ReportSeverity.Warning,
    family: ArtifactFamily.Mcp,
    source: serverName,
    message: `Embedded credentials stripped from \`url\`; supply them via \`{env:VAR}\` instead.`,
  });
  build.warnings.push(`EMBEDDED_CREDENTIALS: mcp server \`${serverName}\` url credentials stripped.`);
  return { type: "remote", url: stripped, enabled: false };
}

function buildServerEntry(
  serverName: string,
  server: Record<string, FrontmatterValue>,
  build: McpBuild,
): Record<string, FrontmatterValue> | undefined {
  const url = getString(server, URL_KEY);
  if (url !== undefined && url.length > 0) {
    return buildRemoteEntry(serverName, url, build);
  }

  const command = getString(server, COMMAND_KEY) ?? "";
  const args = getStringArray(server, ARGS_KEY);
  const entry: Record<string, FrontmatterValue> = {
    type: "local",
    command: [command, ...args].filter((part) => part.length > 0),
    enabled: false,
  };
  const environment = buildEnvironment(serverName, server, build);
  if (Object.keys(environment).length > 0) {
    entry.environment = environment;
  }
  return entry;
}

async function buildMcp(artifact: ParsedCopilotArtifact): Promise<McpBuild> {
  const build: McpBuild = { entries: {}, envVars: [], rows: [], warnings: [] };
  const servers = readServers(await parseStructuredDocument(artifact.inventory.absolutePath));

  for (const [serverName, server] of Object.entries(servers)) {
    if (!isFrontmatterRecord(server)) {
      continue;
    }
    const entry = buildServerEntry(serverName, server, build);
    if (entry === undefined) {
      continue;
    }
    build.entries[serverName] = entry;
  }

  if (Object.keys(build.entries).length === 0 && !build.rows.some((row) => row.severity === ReportSeverity.Error)) {
    build.warnings.push(`No \`servers\`/\`mcpServers\` entries found in \`${artifact.inventory.relativePath}\`.`);
  }
  return build;
}

export class McpMigrator implements Migrator {
  readonly family = ArtifactFamily.Mcp;

  async transform(artifact: ParsedCopilotArtifact, _context: TransformContext): Promise<TransformResult> {
    const build = await buildMcp(artifact);
    const relativePath = `${FRAGMENTS_DIR_NAME}/${MCP_FRAGMENT_FILE}`;
    const files: MigratedFile[] = [
      { relativePath, content: `${JSON.stringify({ mcp: build.entries }, null, 2)}\n` },
    ];
    const rows: ReportRow[] = [
      {
        code: ReportCode.Migrated,
        severity: ReportSeverity.Info,
        family: this.family,
        source: artifact.inventory.relativePath,
        dest: relativePath,
        message: "Migrated MCP servers into an OpenCode `mcp{}` fragment (disabled by default).",
      },
      ...build.rows,
    ];

    return { files, rows, warnings: build.warnings, envVars: build.envVars };
  }
}
