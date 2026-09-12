export enum SecretFindingKind {
  InputReference = "copilot-input",
  TokenPattern = "token-pattern",
  ProviderKey = "provider-plaintext-key",
  EmbeddedCredentials = "embedded-credentials",
}

export interface SecretFinding {
  readonly kind: SecretFindingKind;
  readonly label: string;
  readonly match: string;
}

const TOKEN_PATTERNS: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  { label: "OpenAI-style key", pattern: /sk-[A-Za-z0-9_-]{16,}/g },
  { label: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{20,}/g },
  { label: "GitHub fine-grained PAT", pattern: /github_pat_[A-Za-z0-9_]{20,}/g },
  { label: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/g },
];

const INPUT_REFERENCE_PATTERN = /\$\{input:([A-Za-z0-9_-]+)\}/g;
const ENV_REFERENCE_PATTERN = /\$\{env:([A-Za-z0-9_-]+)\}/g;
const BARE_REFERENCE_PATTERN = /\$\{([A-Z0-9_]+)\}/g;
const RESOLVED_REFERENCE_PATTERN = /^\$\{[A-Z0-9_]+\}$|^\{(?:env|file):[^}]+\}$/;
const EMBEDDED_CREDENTIALS_PATTERN = /^[a-z][a-z0-9+.-]*:\/\/[^/@\s]+:[^/@\s]+@/i;

export interface InputNormalization {
  readonly text: string;
  readonly variables: readonly string[];
}

export function toEnvVarName(reference: string): string {
  const sanitized = reference.replace(/[^A-Za-z0-9]+/g, "_").replace(/^([0-9])/, "_$1");
  return sanitized.toUpperCase();
}

export function toEnvReference(variable: string): string {
  return `{env:${variable}}`;
}

function replaceWithEnvReferences(text: string, pattern: RegExp, variables: Set<string>): string {
  return text.replace(pattern, (_match, name: string) => {
    const variable = toEnvVarName(name);
    variables.add(variable);
    return toEnvReference(variable);
  });
}

export function normalizeEnvReferences(text: string): InputNormalization {
  const variables = new Set<string>();
  let normalized = replaceWithEnvReferences(text, INPUT_REFERENCE_PATTERN, variables);
  normalized = replaceWithEnvReferences(normalized, ENV_REFERENCE_PATTERN, variables);
  normalized = replaceWithEnvReferences(normalized, BARE_REFERENCE_PATTERN, variables);
  return { text: normalized, variables: [...variables] };
}

export function isSecretReference(value: string): boolean {
  return RESOLVED_REFERENCE_PATTERN.test(value.trim());
}

export function isPlaintextProviderKey(value: string | undefined): boolean {
  if (value === undefined || value.trim().length === 0) {
    return false;
  }
  return !isSecretReference(value);
}

const ENV_REFERENCE_NAME_PATTERN = /^\$\{([A-Z0-9_]+)\}$|^\{env:([A-Za-z0-9_]+)\}$/;

export function extractEnvVarName(value: string): string | undefined {
  const match = ENV_REFERENCE_NAME_PATTERN.exec(value.trim());
  return match?.[1] ?? match?.[2];
}

export function stripEmbeddedCredentials(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@\s]+@/i, "$1");
}

export function findTokenSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const { label, pattern } of TOKEN_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      findings.push({ kind: SecretFindingKind.TokenPattern, label, match: match[0] });
    }
  }
  return findings;
}

export function findInputReferences(text: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  for (const match of text.matchAll(INPUT_REFERENCE_PATTERN)) {
    findings.push({ kind: SecretFindingKind.InputReference, label: "Copilot input reference", match: match[0] });
  }
  return findings;
}

export function scanSecrets(text: string): SecretFinding[] {
  return [...findTokenSecrets(text), ...findInputReferences(text)];
}

export function hasPlaintextSecret(text: string): boolean {
  return findTokenSecrets(text).length > 0;
}

export function hasEmbeddedCredentials(url: string): boolean {
  return EMBEDDED_CREDENTIALS_PATTERN.test(url.trim());
}
