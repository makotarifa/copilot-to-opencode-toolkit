// security-hooks OpenCode plugin (harness-neutral, Node stdlib only).
// Secret scan + review-before-push reminder. Warn-first; fail-closed on
// high-confidence secrets in edit/write. Throwing inside tool.execute.before
// cancels the call (verified against the OpenCode Plugins API).
//
// Vendored and adapted from ECC <https://github.com/affaan-m/ecc> v2.2.0
//   Source: hooks/README.md (git-push reminder, pre-commit secret detection)
//   SPDX-License-Identifier: MIT
//   Copyright (c) 2026 Affaan Mustafa
//   Adapted for this kit: see THIRD_PARTY.md. Do not remove this attribution.

const KILL_SWITCH = "KIT_SECURITY_HOOKS";

const SECRET_PATTERNS = [
  { name: "private key block", re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "OpenAI API key", re: /sk-proj-[A-Za-z0-9_-]{20,}/ },
  { name: "Anthropic API key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "AWS access key id", re: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9]{36,}/ },
  { name: "Slack token", re: /xox[baprs]-[A-Za-z0-9-]{10,}/ },
];

const PUSH_REMINDER =
  '[security-hooks] review the diff before pushing — `git diff --stat` and `git log -p @{push}..` (if an upstream exists).';

const findSecret = (text) => {
  if (!text) return null;
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(text)) return pattern.name;
  }
  return null;
};

export const SecurityHooksPlugin = async ({ directory }) => {
  if (process.env[KILL_SWITCH] === "off") return {};

  let pushReminded = false;

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input?.tool;
      const args = output?.args ?? {};

      try {
        if (tool === "bash") {
          const command = args.command ?? "";

          const secretName = findSecret(command);
          if (secretName) {
            args.command =
              `echo "[security-hooks] WARNING: a high-confidence secret pattern (${secretName}) was found in this command. Verify it is not a real credential before running." && ` +
              command;
          }

          if (!pushReminded && /\bgit\b[^&|;]*\bpush\b/.test(command)) {
            pushReminded = true;
            args.command = `echo "${PUSH_REMINDER}" && ` + command;
          }
          return;
        }

        if (tool === "edit" || tool === "write") {
          const content = args.newString ?? args.content ?? "";
          const secretName = findSecret(content);
          if (secretName) {
            const where = args.filePath ?? args.file_path ?? "the target file";
            throw new Error(
              `Blocked by security-hooks: high-confidence secret pattern (${secretName}) detected in ${where}. Refusing to write.`,
            );
          }
        }
      } catch (err) {
        // Edit/write throws are intentional (fail-closed) — re-throw them.
        if (tool === "edit" || tool === "write") throw err;
        // Bash path must never throw: swallow internal errors so the tool proceeds.
      }
    },
  };
};
