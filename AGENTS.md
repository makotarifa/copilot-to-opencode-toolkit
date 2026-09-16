# copilot-to-opencode-toolkit — agent guide

Contributor guide for this repository. Read it before making changes.

## What this is

A self-contained Node.js 22 + TypeScript (strict) CLI that migrates a GitHub
Copilot customization workspace (VSCode Copilot + Copilot CLI artifacts) into
OpenCode configuration. It discovers, parses, transforms, validates, previews,
and writes OpenCode artifacts.

Copilot inputs it understands:

- `.github/agents/*.agent.md` (and legacy `*.chatmode.md`) → `agents/*.md`
- `.github/prompts/*.prompt.md` → `commands/*.md`
- `.github/instructions/*.instructions.md` and `.github/copilot-instructions.md` → `instructions/*.md`
- `.github/skills/*/SKILL.md` → `skills/<name>/SKILL.md`
- `.vscode/mcp.json` (and other `mcp*.json` files / CLI homes) → `fragments/mcp-snippet.json`
- provider/model configs (`user-model-config.json`, `model-config.json`, `provider-config.json`) → `fragments/opencode-provider.fragment.json`
- `.github/hooks/*` → manual-rewrite warnings only (no automatic migration)

## Repo layout

```text
.
  README.md                 # user-facing overview, quickstart, flags
  AGENTS.md                 # this contributor guide
  LICENSE                   # MIT
  .gitignore
  docs/
    migration-toolkit.md     # full toolkit specification
  toolkit/                   # the CLI package
    bin/migrate.ts           # entry point
    src/                     # cli, discovery, domain, model, parse, safety, transform, write
    test/                    # vitest unit + integration tests and fixtures
    model-map.json           # built-in model map
    package.json
```

## Develop and test

Requires Node.js 22+. Install and run everything from the repository root, only
inside the package:

```bash
npm --prefix toolkit install
npm --prefix toolkit run typecheck
npm --prefix toolkit run lint
npm --prefix toolkit test
```

Run the CLI directly:

```bash
npx --prefix toolkit tsx toolkit/bin/migrate.ts --help
```

## Pipeline

`discover → parse → model-resolver → provider-migrator → transform → validate →
preview/consent → write → report`.

Every run ends with `_migration-report.md` and `_migration-report.json` under the
write root. Interactive runs preview each file and write only after per-file
consent; `--dry-run` writes nothing; `--yes` writes the resolved write root
non-interactively.

## Manual steps (what needs a human)

Every run that reaches the report stage prints a final `Manual steps required
(N):` summary (all modes, `--dry-run` included) and writes it into
`_migration-report.md` under `## Manual steps required`;
`_migration-report.json` adds `summary.manualSteps { mechanical, decision }` and
a `manualSteps[]` array. **Mechanical** steps are deterministic; **decision**
steps need human judgement. Always manual: review the generated output and merge
it into your project's `.opencode/` config yourself (the toolkit never writes
your `.opencode/` or `AGENTS.md`); merge project-scope
`fragments/*.fragment.json` into `opencode.json` (user scope merges
automatically); fill `.env.example` placeholders with real values. Full table:
[toolkit/README.md](toolkit/README.md#manual-steps-what-needs-a-human).

## Target scope (`--scope user|project`)

- `project` (default) — writes a project OpenCode tree (`commands/` plural)
  under the output directory inside the repository. Copy the result into your
  project's `.opencode/` config when you are ready.
- `user` — writes to the OpenCode config home (`$XDG_CONFIG_HOME/opencode`,
  falling back to `~/.config/opencode`) with `command/` singular, and deep-merges
  `instructions[]`, `mcp`, and `provider` into the existing `opencode.json`
  (unrelated keys preserved, arrays unioned). It never creates or modifies
  `<config-home>/AGENTS.md`.

## Teams and recommended plugins

- **Team namespacing** — a source organised per team
  (`<root>/<team>/{agents,instructions,prompts,skills}/…`) keeps that hierarchy
  in the output (`instructions/<team>/<name>.md`,
  `skills/<team>/<name>/SKILL.md`); classic layouts stay flat and each
  instruction is written as its own `.md` file (never concatenated).
- **`--team <name>`** (repeatable, or `all`) filters the whole run. With more
  than one team an interactive run asks via checkbox; `--yes` without an explicit
  selection emits a visible `MULTI_TEAM` warning with per-team/per-family counts
  rather than migrating silently. Unknown names are flagged for manual review.
- **Recommended plugins** — `toolkit/src/config/recommended-plugins.json`
  (`{ version, plugins: [{ kind: "npm"|"local", specifier }] }`) drives
  `fragments/opencode-plugins.fragment.json` and, at user scope, a union merge
  into `opencode.json`; an empty/absent file emits no `plugin` key. Bundled local
  `.js` sources live in `toolkit/plugins/`.

## Safety

- `--dry-run` performs zero writes.
- `--yes` aborts on existing targets or colliding `opencode.json` entries unless
  `--allow-overwrite` is passed.
- Path validation rejects a destination inside the toolkit's own `.opencode/`
  (`ERR_WRITE_INSIDE_OUR_OPENCODE` at either scope) and, at project scope, a
  destination inside (or equal to) your project's `.opencode/`
  (`ERR_DEST_IN_OPENCODE`) or outside the repo (`ERR_DEST_OUTSIDE_REPO`).
- No plaintext secrets: MCP and provider credentials are emitted as `{env:VAR}`,
  and `.env.example` carries placeholders only.

## Conventions

- strict TypeScript: no `any`/`unknown`, no `eslint-disable`.
- One responsibility per class/function; max 200 lines per file, 30-40 per
  function. Extract helpers into modules.
- No magic numbers/strings; enumerated strings are TypeScript `enum`s (not
  string-literal unions), with explicit string initializers.
- Self-documenting code; comment only when removing the comment would cause a bug.

## Pointers

- [README.md](README.md) — install, quickstart, flags, install prompts.
- [docs/migration-toolkit.md](docs/migration-toolkit.md) — full toolkit spec.
- [toolkit/README.md](toolkit/README.md) — CLI package reference.
