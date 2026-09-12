import { ArtifactFamily } from "../domain/artifact-family";
import { FrontmatterValue } from "../domain/copilot-artifact";
import { EnvVarReference } from "../domain/env-var";
import { ProviderPreview } from "../domain/provider-preview";
import { ReportCode, ReportRow, ReportSeverity } from "../domain/report";
import { getString, getStringArray, isFrontmatterRecord } from "../parse/frontmatter-values";
import {
  extractEnvVarName,
  hasEmbeddedCredentials,
  isPlaintextProviderKey,
  isSecretReference,
  stripEmbeddedCredentials,
  toEnvVarName,
} from "../safety/secret-scanner";

const PROVIDER_TYPE_KEY = "providerType";
const TYPE_KEY = "type";
const PROVIDER_ID_KEY = "providerId";
const DISPLAY_NAME_KEY = "name";
const BASE_URL_KEY = "baseURL";
const API_KEY_ENV_VAR_KEY = "apiKeyEnvVar";
const API_KEY_KEY = "apiKey";
const MODELS_KEY = "models";
const CUSTOM_PROVIDER_TYPE = "custom";
const API_KEY_SUFFIX = "API_KEY";
const DEFAULT_PROVIDER_NPM = "@ai-sdk/openai-compatible";
const PROVIDER_NPM_BY_TYPE: readonly { readonly match: string; readonly npm: string }[] = [
  { match: "anthropic", npm: "@ai-sdk/anthropic" },
  { match: "google", npm: "@ai-sdk/google" },
  { match: "gemini", npm: "@ai-sdk/google" },
];

export interface ProviderConfig {
  readonly providerType: string;
  readonly providerId?: string;
  readonly displayName?: string;
  readonly baseURL?: string;
  readonly apiKeyEnvVar?: string;
  readonly apiKey?: string;
  readonly models: readonly string[];
}

export interface ProviderBuild {
  readonly fragment: Record<string, FrontmatterValue>;
  readonly envVars: EnvVarReference[];
  readonly rows: ReportRow[];
  readonly warnings: string[];
  preview: ProviderPreview;
}

export function readProviderConfig(document: FrontmatterValue): ProviderConfig | undefined {
  if (!isFrontmatterRecord(document)) {
    return undefined;
  }
  const providerType =
    getString(document, PROVIDER_TYPE_KEY) ?? getString(document, TYPE_KEY) ?? CUSTOM_PROVIDER_TYPE;
  return {
    providerType,
    providerId: getString(document, PROVIDER_ID_KEY),
    displayName: getString(document, DISPLAY_NAME_KEY),
    baseURL: getString(document, BASE_URL_KEY),
    apiKeyEnvVar: getString(document, API_KEY_ENV_VAR_KEY),
    apiKey: getString(document, API_KEY_KEY),
    models: getStringArray(document, MODELS_KEY),
  };
}

function npmForProvider(providerType: string): string {
  const normalized = providerType.toLowerCase();
  return PROVIDER_NPM_BY_TYPE.find((entry) => normalized.includes(entry.match))?.npm ?? DEFAULT_PROVIDER_NPM;
}

function providerIdOf(config: ProviderConfig): string {
  if (config.providerId !== undefined && config.providerId.trim().length > 0) {
    return config.providerId.trim();
  }
  return toEnvVarName(config.providerType).toLowerCase().split("_").join("-");
}

function resolveApiKey(config: ProviderConfig, consumer: string, build: ProviderBuild): string | undefined {
  if (config.apiKeyEnvVar !== undefined) {
    build.envVars.push({ name: config.apiKeyEnvVar, consumer });
    return `{env:${config.apiKeyEnvVar}}`;
  }
  if (config.apiKey === undefined || config.apiKey.trim().length === 0) {
    return undefined;
  }
  if (isSecretReference(config.apiKey) && !isPlaintextProviderKey(config.apiKey)) {
    const envName = extractEnvVarName(config.apiKey);
    if (envName !== undefined) {
      build.envVars.push({ name: envName, consumer });
    }
    return config.apiKey.trim();
  }

  const variable = toEnvVarName(`${config.providerType}_${API_KEY_SUFFIX}`);
  build.envVars.push({ name: variable, consumer });
  build.rows.push({
    code: ReportCode.SecretNormalized,
    severity: ReportSeverity.Warning,
    family: ArtifactFamily.Provider,
    source: config.providerType,
    message: `Plaintext API key replaced with \`{env:${variable}}\`.`,
  });
  build.warnings.push(`SECRET_NORMALIZED: provider \`${config.providerType}\` apiKey forced to \`{env:${variable}}\`.`);
  return `{env:${variable}}`;
}

function resolveBaseUrl(config: ProviderConfig, build: ProviderBuild): string | undefined {
  if (config.baseURL === undefined || config.baseURL.trim().length === 0) {
    return undefined;
  }
  if (!hasEmbeddedCredentials(config.baseURL)) {
    return config.baseURL;
  }
  build.warnings.push(
    `EMBEDDED_CREDENTIALS: provider \`${config.providerType}\` baseURL contained inline credentials; they were stripped.`,
  );
  return stripEmbeddedCredentials(config.baseURL);
}

function buildModels(config: ProviderConfig): Record<string, FrontmatterValue> {
  const models: Record<string, FrontmatterValue> = {};
  for (const model of config.models) {
    models[model] = { name: model };
  }
  return models;
}

export function buildProviderFragment(config: ProviderConfig): ProviderBuild {
  const providerId = providerIdOf(config);
  const consumer = `provider:${providerId}`;
  const build: ProviderBuild = {
    fragment: {},
    envVars: [],
    rows: [],
    warnings: [],
    preview: {
      providerId,
      displayName: config.displayName ?? providerId,
      baseURL: config.baseURL,
      models: config.models,
    },
  };

  const options: Record<string, FrontmatterValue> = {};
  const baseURL = resolveBaseUrl(config, build);
  if (baseURL !== undefined) {
    options.baseURL = baseURL;
  }
  const apiKey = resolveApiKey(config, consumer, build);
  if (apiKey !== undefined) {
    options.apiKey = apiKey;
  }

  const provider: Record<string, FrontmatterValue> = {
    npm: npmForProvider(config.providerType),
    name: config.displayName ?? providerId,
  };
  if (Object.keys(options).length > 0) {
    provider.options = options;
  }
  if (config.models.length > 0) {
    provider.models = buildModels(config);
  }

  build.fragment[providerId] = provider;
  build.preview = { ...build.preview, apiKeyEnv: extractEnvVarName(apiKey ?? "") };
  return build;
}
