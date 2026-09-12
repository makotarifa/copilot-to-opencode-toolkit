import { describe, expect, test } from "vitest";

import {
  findTokenSecrets,
  hasEmbeddedCredentials,
  hasPlaintextSecret,
  isSecretReference,
  normalizeEnvReferences,
  SecretFindingKind,
  toEnvVarName,
} from "../src/safety/secret-scanner";

const FAKE_OPENAI = ["sk", "abcdefghijklmnop", "1234"].join("-");
const FAKE_AWS = ["AKIA", "IOSFODNN7EXAMPLE"].join("");
const FAKE_GITHUB = ["ghp", "abcdefghijklmnopqrstuvwx1234567890"].join("_");

describe("secret scanner", () => {
  test("detects known token patterns", () => {
    const findings = findTokenSecrets(`token=${FAKE_OPENAI} and ${FAKE_AWS}`);

    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.every((finding) => finding.kind === SecretFindingKind.TokenPattern)).toBe(true);
    expect(hasPlaintextSecret(FAKE_GITHUB)).toBe(true);
  });

  test("normalizes Copilot references into OpenCode {env:VAR} before use", () => {
    const result = normalizeEnvReferences(
      "Bearer ${input:api-token} ${input:9lives} ${env:GITHUB_TOKEN} ${PLAIN_VAR}",
    );

    expect(result.variables).toEqual(["API_TOKEN", "_9LIVES", "GITHUB_TOKEN", "PLAIN_VAR"]);
    expect(result.text).toContain("{env:API_TOKEN}");
    expect(result.text).toContain("{env:_9LIVES}");
    expect(result.text).toContain("{env:GITHUB_TOKEN}");
    expect(result.text).toContain("{env:PLAIN_VAR}");
    expect(result.text).not.toContain("${");
  });

  test("leaves already-normalized OpenCode references untouched", () => {
    const result = normalizeEnvReferences("Bearer {env:API_TOKEN}");

    expect(result.text).toBe("Bearer {env:API_TOKEN}");
    expect(result.variables).toEqual([]);
  });

  test("recognises resolved secret references and embedded credentials", () => {
    expect(isSecretReference("${API_TOKEN}")).toBe(true);
    expect(isSecretReference("{env:API_TOKEN}")).toBe(true);
    expect(isSecretReference("{file:~/.secrets/key}")).toBe(true);
    expect(isSecretReference("plain-value")).toBe(false);
    expect(hasEmbeddedCredentials("https://user:pass@example.com")).toBe(true);
    expect(hasEmbeddedCredentials("https://example.com")).toBe(false);
  });

  test("sanitizes arbitrary reference names into env var names", () => {
    expect(toEnvVarName("api-token")).toBe("API_TOKEN");
    expect(toEnvVarName("server name")).toBe("SERVER_NAME");
  });
});
