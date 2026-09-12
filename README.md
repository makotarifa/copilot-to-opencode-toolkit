# copilot-to-opencode-toolkit

A standalone Node.js 22 + TypeScript CLI that migrates a **GitHub Copilot**
customization workspace (VSCode Copilot + Copilot CLI) to the **OpenCode**
format. It discovers the Copilot artifacts, transforms them into OpenCode-ready
files, and writes them under a configurable output root — with a preview/consent
step so nothing is written silently.

The toolkit is self-contained: no backend, client, or deploy.

## Repository layout

```text
.
  README.md                 # this file
  AGENTS.md                 # contributor / agent guide
  LICENSE                   # MIT
  .gitignore
  docs/
    migration-toolkit.md     # full toolkit specification
  toolkit/                   # the CLI package (bin/migrate.ts)
```

## Requirements

- Node.js 22+

Install and check the package:

```bash
npm --prefix toolkit install
npm --prefix toolkit run typecheck   # tsc --noEmit
npm --prefix toolkit run lint        # eslint
npm --prefix toolkit test            # vitest
```

## Quickstart

Run the CLI from the repository root. Without `--yes` or `--dry-run` the run is
interactive: it asks for the target scope (default `project`), then the source
and output directories (pre-filled with defaults), validates the paths, and
previews each file before writing it. `--dry-run` writes zero files; `--yes`
writes the resolved output root without interaction. In `--yes` mode existing
targets abort the run unless `--allow-overwrite` is passed.

### Project level (default, `--scope project`)

`--scope project` writes a project OpenCode tree (`commands/` plural) under the
output directory inside the repository (default `migrated/`). The toolkit never writes into the
repository's own `.opencode/`; copy the generated tree into your project's
OpenCode config when you are ready.

```bash
# 1) Preview with the built-in defaults (source: copilot-source/, dest: migrated/)
npx --prefix toolkit tsx toolkit/bin/migrate.ts --dry-run --scope project

# 2) Real run (interactive by default; writes only after per-file consent)
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope project

# 3) Explicit paths — the literal defaults, or your own
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope project --source copilot-source --dest migrated
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope project --source <copilot-workspace> --dest <output-dir>
```

### User level (`--scope user`)

Resolves the OpenCode config home (`$XDG_CONFIG_HOME/opencode`, falling back to
`~/.config/opencode`), writes `agents/` + `command/` (singular — the directory
the installed runtime reads) + `skills/` + `instructions/`, and deep-merges
`instructions[]`, `mcp`, and `provider` into the existing global `opencode.json`
(objects merged key-by-key, arrays unioned never replaced, unrelated keys
preserved; the global `AGENTS.md` is never created or modified). `--dest <dir>`
overrides the target.

```bash
# 1) Preview: writes zero files
npx --prefix toolkit tsx toolkit/bin/migrate.ts --dry-run --scope user

# 2) Real run (interactive by default; the opencode.json merge is diff-previewed + consent-gated)
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope user --source <copilot-workspace>

# Optional target override (explicit --dest wins over the config-home default)
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope user --source <copilot-workspace> --dest <dir>
```

### Main flags

| Flag | Meaning |
|---|---|
| `--source <dir>` | Copilot workspace to read (default: `copilot-source/` under the repo root). |
| `--dest <dir>` | Output directory (default: `migrated/`). Project scope: repo-rooted. User scope: overrides the config home (default `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`). Created if missing. |
| `--scope <user\|project>` | Target scope (default `project`). `project` writes the repo-local project tree; `user` writes to the OpenCode config home. |
| `--cli-home <dir>` | Optional Copilot CLI home to merge (dedup, no precedence). Default: `<source>/cli-home` when present. |
| `--family <name>` | Restrict to one family: `agent`, `prompt`, `instructions`, `skill`, `mcp`, `provider`, `hooks`. |
| `--model-map <path>` | JSON overlay merged over `toolkit/model-map.json`. |
| `--allow-unmapped-models` | Keep unmapped/stale models and exit 0 in `--yes` mode. |
| `--allow-overwrite` | In `--yes` mode, replace existing targets (and apply a colliding `opencode.json` merge) instead of aborting. |
| `--dry-run` | Preview only; writes zero files. |
| `--yes` | Non-interactive run that writes the resolved dest. |
| `--help` | Print usage. |

## What it migrates

Copilot inputs → OpenCode artifacts:

- `.github/agents/*.agent.md` (and legacy `*.chatmode.md`) → `agents/*.md`
- `.github/prompts/*.prompt.md` → `commands/*.md`
- `.github/instructions/*.instructions.md` and `.github/copilot-instructions.md` → `instructions/*.md`
- `.github/skills/*/SKILL.md` → `skills/<name>/SKILL.md`
- `.vscode/mcp.json` (and other `mcp*.json` files / CLI homes) → `fragments/mcp-snippet.json`
- provider/model configs (`user-model-config.json`, `model-config.json`, `provider-config.json`) → `fragments/opencode-provider.fragment.json`
- `.github/hooks/*` → manual-rewrite warnings only (no automatic migration)

## How it works

Pipeline: `discover → parse → model-resolver → provider-migrator → transform →
validate → preview/consent → write → report` (`_migration-report.md/.json`).

One family per migrator:

- **skills** — near-literal copy + metadata.
- **prompts → commands** — adds a `Usage` block; picks delegation pattern A/B.
- **agents** — resolves the model and converts `handoffs` into `task()` notes.
- **instructions** — verbatim body + `Scope:` header from `applyTo` + notes.
- **mcp** — `${input:var}` and `${env:VAR}` → `{env:VAR}` into `fragments/mcp-snippet.json`.
- **provider** — `fragments/opencode-provider.fragment.json` with `{env:VAR}` keys.
- **hooks** — stub: emits `MANUAL_REWRITE` warnings and migrates zero files (they need a manual plugin rewrite).

## Limits and invariants

- The toolkit **never** writes to the repository's own `.opencode/` or any
  `AGENTS.md`; both scopes carry a path-validation wall that refuses writing the
  repository's `.opencode/` (`ERR_WRITE_INSIDE_OUR_OPENCODE`), and at project
  scope any `--dest` inside (or equal to) `.opencode/` is rejected outright
  (`ERR_DEST_IN_OPENCODE`).
- All paths are validated (readable source, source ≠ dest, no nesting, in-repo
  dest at project scope, resolvable config home at user scope) with named error
  codes; every write is re-checked against the validated dest.
- The source workspace is read-only: the toolkit never mutates it.
- No plaintext secrets: MCP `${input:var}`/`${env:VAR}` → `{env:VAR}`, provider
  keys to `{env:VAR}`, and `.env.example` with placeholders only.
- Full spec: [docs/migration-toolkit.md](docs/migration-toolkit.md) and
  [toolkit/README.md](toolkit/README.md).

## Install prompts (copy-paste for an AI agent)

Copy one of these blocks into an agent chat to run the migration. Both follow
the safe defaults: preview with `--dry-run` first, and never overwrite without
`--allow-overwrite`.

### Project-level install prompt

```text
Goal: migrate this Copilot workspace to OpenCode at project level
(default scope).

Steps:
1. Install toolkit deps (inside the package only):
   npm --prefix toolkit install
2. Preview first (writes zero files):
   npx --prefix toolkit tsx toolkit/bin/migrate.ts --dry-run --scope project
3. Real run (interactive by default; writes only after per-file consent):
   npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope project --source copilot-source --dest migrated
   # or, for a different workspace/output:
   # npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope project --source <copilot-workspace> --dest <output-dir>

Follow-up: review the generated tree, then copy it into your project's
OpenCode config (.opencode/). The toolkit itself never writes .opencode/.

Safety: --dry-run first; do not pass --allow-overwrite unless I explicitly
ask to replace existing targets.
```

### User-level install prompt

```text
Goal: migrate this Copilot workspace to OpenCode at user level
(global config home).

Steps:
1. Install toolkit deps (inside the package only):
   npm --prefix toolkit install
2. Preview first (writes zero files):
   npx --prefix toolkit tsx toolkit/bin/migrate.ts --dry-run --scope user
3. Real run (interactive by default; the opencode.json merge is
   diff-previewed and consent-gated):
   npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope user --source <copilot-workspace>

What this does: resolves the config home ($XDG_CONFIG_HOME/opencode,
falling back to ~/.config/opencode), writes agents/, command/ (singular —
the directory the installed runtime reads), skills/ and instructions/ there,
and deep-merges instructions[], mcp and provider into the existing global
opencode.json (objects merged key-by-key, arrays unioned never replaced,
unrelated keys preserved; the global AGENTS.md is never created or
modified). Use --dest <dir> only to override the target.

Safety: --dry-run first; do not pass --allow-overwrite unless I explicitly
ask to replace existing targets or apply a colliding opencode.json merge.
```

## Links

- [AGENTS.md](AGENTS.md) — contributor / agent guide for this repository.
- [docs/migration-toolkit.md](docs/migration-toolkit.md) — full toolkit specification.
- [toolkit/README.md](toolkit/README.md) — CLI package reference.
- [LICENSE](LICENSE) — MIT.
