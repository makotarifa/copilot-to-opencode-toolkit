import {
  FRAGMENTS_DIR_NAME,
  INSTRUCTIONS_SNIPPET_FILE,
  MCP_FRAGMENT_FILE,
  OPENCODE_CONFIG_SCHEMA_URL,
  PLUGIN_FRAGMENT_FILE,
  PLUGIN_KEY,
  PROVIDER_FRAGMENT_FILE,
} from "../constants";
import { FrontmatterValue } from "../domain/copilot-artifact";
import { MigratedFile } from "../domain/opencode-artifact";
import { isFrontmatterRecord } from "../parse/frontmatter-values";
import { parseJsonc } from "../parse/jsonc";

const SCHEMA_KEY = "$schema";
const INSTRUCTIONS_KEY = "instructions";
const MCP_KEY = "mcp";
const PROVIDER_KEY = "provider";

type ConfigPatch = Record<string, FrontmatterValue>;

function fragment(files: readonly MigratedFile[], name: string): MigratedFile | undefined {
  const target = `${FRAGMENTS_DIR_NAME}/${name}`;
  return files.find((file) => file.relativePath === target);
}

function readValue(files: readonly MigratedFile[], name: string, key?: string): FrontmatterValue | undefined {
  const file = fragment(files, name);
  if (file === undefined) {
    return undefined;
  }
  const parsed = parseJsonc(file.content);
  if (key === undefined) {
    return parsed;
  }
  return isFrontmatterRecord(parsed) ? parsed[key] : undefined;
}

export function buildOpenCodeConfigPatch(files: readonly MigratedFile[]): ConfigPatch {
  const patch: ConfigPatch = { [SCHEMA_KEY]: OPENCODE_CONFIG_SCHEMA_URL };
  const instructions = readValue(files, INSTRUCTIONS_SNIPPET_FILE);
  if (instructions !== undefined) {
    patch[INSTRUCTIONS_KEY] = instructions;
  }
  const mcp = readValue(files, MCP_FRAGMENT_FILE, MCP_KEY);
  if (mcp !== undefined) {
    patch[MCP_KEY] = mcp;
  }
  const provider = readValue(files, PROVIDER_FRAGMENT_FILE, PROVIDER_KEY);
  if (provider !== undefined) {
    patch[PROVIDER_KEY] = provider;
  }
  const plugin = readValue(files, PLUGIN_FRAGMENT_FILE, PLUGIN_KEY);
  if (plugin !== undefined) {
    patch[PLUGIN_KEY] = plugin;
  }
  return patch;
}

