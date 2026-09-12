# migration-toolkit.md — Interactive Copilot → OpenCode migration toolkit

`toolkit/` is a self-contained Node.js 22 + TypeScript (strict) CLI that
migrates a GitHub Copilot workspace into OpenCode-ready artifacts under the
resolved `--dest` (a repo-local `migrated/` tree by default). Entry:
`toolkit/bin/migrate.ts`. Config: `toolkit/package.json`,
`toolkit/tsconfig.json`, `toolkit/model-map.json`. Full reference:
`toolkit/README.md`.

## Commands

```bash
npm --prefix toolkit test            # vitest
npm --prefix toolkit run typecheck   # tsc --noEmit
npm --prefix toolkit run lint        # eslint
npx --prefix toolkit tsx toolkit/bin/migrate.ts            # interactive (default)
npx --prefix toolkit tsx toolkit/bin/migrate.ts --dry-run  # preview only
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope project   # literal defaults: copilot-source/ → migrated/
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --scope project --source <copilot-workspace> --dest <output-dir>
```

## Pipeline

discover → parse → model-resolver → provider-migrator → transform → validate →
interactive confirm/preview → write → report (`_migration-report.md/.json`).

## Modes

Without `--yes`/`--dry-run` the run is interactive: it prompts for the target
scope (default `project`), then source/dest (pre-filled defaults, 3 attempts),
shows a resolved-paths panel (including `scope → write root`), previews every
file and writes only after per-file consent. `--dry-run` writes zero files;
`--yes` writes the resolved dest non-interactively.

`--yes` is overwrite-safe: an existing migrated target emits an `OVERWRITTEN`
blocker, and a colliding `provider.<id>`/`mcp.<id>` in an existing user-scope
`opencode.json` emits `INFO_CONFIG_OVERWRITE`; both exit `1` without writing
unless `--allow-overwrite` is passed. A non-JSONC existing `opencode.json`
emits `ERR_CONFIG_INVALID` and aborts with zero writes in either mode.

## Target scope

`--scope user|project` (default `project`) selects the write root:

- `project` — `resolve(repoRoot, --dest ?? migrated/)`, layout
  mirrors a project OpenCode tree (`commands/` plural) — a staging tree you copy
  into your project's `.opencode/` config.
- `user` — the OpenCode config home (`--dest` override > `XDG_CONFIG_HOME` →
  `${XDG}/opencode` > `~/.config/opencode`; none → `ERR_NO_CONFIG_HOME`).
  Commands land in `command/` (singular) via per-scope constants
  (`USER_COMMANDS_DIR`/`PROJECT_COMMANDS_DIR`); provider/MCP/instructions
  fragments are deep-merged (tmp + rename) into `<config-home>/opencode.json`
  with unrelated keys preserved, and `<config-home>/AGENTS.md` is never written.

The repository's own `.opencode/` is never writable in either scope
(`ERR_WRITE_INSIDE_OUR_OPENCODE`).

User-scope `instructions[]` entries are emitted as **absolute** paths
(`<config-home>/instructions/*.md`). OpenCode resolves relative instruction
patterns against the project/worktree directory (`globUp` in upstream
`session/instruction.ts`), not the config home; only absolute (or `~/`)
patterns resolve predictably from a global config, so the absolute form is the
portable choice. A CLI test asserts the exact emitted values.

## Model resolution

Model values resolve in two explicit modes (never a silent guess). Per-value
precedence: **map → pass-through → interactive → `--yes` fallback**.

**JSON mode (deterministic, no prompt).** A map entry
`{ "<copilot-model-name>": "<destination-id>" }` (keys case-insensitive)
resolves without interaction. The built-in `toolkit/model-map.json` **ships
opinionated defaults** (edit it), and `--model-map <path>` is
merged over it, so overlay keys win even when they differ from a built-in key
only by case:

```json
{ "gpt-4o": "litellm/litellm-default", "claude-3.5-sonnet": "litellm/litellm-builder" }
```

**Interactive mode (TTY, no `--yes`).** When a `model:` has no map entry and is
not already a valid destination catalog ID, the toolkit asks you to choose from
the catalog, type a custom ID, or keep the original for manual review; it may
persist the choice into `toolkit/model-map.json` only after explicit
confirmation.

Precedence for a single value:

1. **explicit map entry** — `--model-map` overlay first, then
   `toolkit/model-map.json`; the target must exist in the catalog;
2. **pass-through** — a value already in the destination catalog (`litellm/*`
   from `.opencode/agents/*.md` + `opencode.json`) is kept, no map lookup;
3. **interactive prompt** — interactive runs only;
4. **`--yes` fallback** — keep the original, emit `UNMAPPED_MODEL`, exit
   non-zero unless `--allow-unmapped-models`.

A map entry whose target is absent from the catalog is `STALE_MODEL_ID` (gated
like unmapped). Every substitution also emits an `info` `MODEL_MAPPED` report row
with `<original> → <dest>` and the source (`model-map.json` or
`--model-map <path>`); in `--yes` mode the model rows are echoed to stdout.
`model:[A,B]` still collapses to the first mappable member, with the original
preserved in `## OpenCode notes`.

## Flags

| Flag | Meaning |
|---|---|
| `--source <dir>` | Copilot workspace to read (default: `copilot-source/` under the repo root). |
| `--dest <dir>` | Output directory (default: `migrated/`). Project scope: repo-rooted. User scope: overrides the config home (default `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`). |
| `--scope <user\|project>` | Target scope (default `project`). |
| `--cli-home <dir>` | Optional Copilot CLI home to merge (dedup, no precedence). Defaults to `<source>/cli-home` when it exists. |
| `--family <name>` | Restrict the run to one family: `agent`, `prompt`, `instructions`, `skill`, `mcp`, `provider`, `hooks`. |
| `--model-map <path>` | JSON overlay merged over `toolkit/model-map.json`. |
| `--allow-unmapped-models` | Keep unmapped/stale model values and exit 0 in `--yes` mode. |
| `--allow-overwrite` | In `--yes` mode, replace existing targets and apply a colliding `opencode.json` merge instead of aborting. |
| `--dry-run` | Preview only; writes zero files. |
| `--yes` | Non-interactive run that writes the resolved dest. |
| `--help` | Print usage. |

## Family migrators (`src/transform/`)

One migrator per Copilot family: skills (near-literal + metadata), prompts →
commands (Usage block, pattern A/B delegation choice), agents (model
resolution, default `mode: primary` — `user-invocable: false` maps to
`subagent`, legacy `infer`/`disable-model-invocation` documented in notes,
handoffs → `task()` notes), instructions (see below), mcp, provider,
hooks (**stub**: emits `MANUAL_REWRITE` warnings, migrates zero files —
hooks need a manual plugin rewrite).

## Source/dest validation (`safety/path-validator.ts`)

| Code | Rule |
|---|---|
| `ERR_SOURCE_READABLE` | Source must exist and be a readable directory. |
| `ERR_CLI_HOME_READABLE` | A provided CLI home must exist and be readable. |
| `ERR_CLI_HOME_OVERLAP` | CLI home must not contain the source or touch the dest. |
| `ERR_SOURCE_EQUALS_DEST` / `ERR_DEST_INSIDE_SOURCE` / `ERR_SOURCE_INSIDE_DEST` | Source and dest must not be equal or nested. |
| `ERR_DEST_OUTSIDE_REPO` | Project scope only: dest must resolve inside the repository root. |
| `ERR_DEST_IN_OPENCODE` | Project scope only: dest inside (or equal to) `.opencode/` is rejected outright. |
| `ERR_NO_CONFIG_HOME` | User scope only: no `--dest` and no resolvable `XDG_CONFIG_HOME`/`HOME`. |
| `ERR_WRITE_INSIDE_OUR_OPENCODE` | The repository's own `.opencode/` is never writable, in either scope. |
| `ERR_SOURCE_IS_REPO_ROOT` | Confirmation, not error: interactive asks, `--yes` refuses. |

Every write target is re-checked against the validated dest root before writing.

## Provider / MCP / instructions behavior

- **Provider:** emits `fragments/opencode-provider.fragment.json` using
  `{env:VAR}` (plaintext keys replaced, baseURL credentials stripped); it never
  edits an existing `.opencode/opencode.json` — copy or merge the fragment when
  you promote the output. (At user scope the run deep-merges the fragment into
  the config-home `opencode.json` automatically.)
- **MCP:** `${input:var}` and `${env:VAR}` → `{env:VAR}` into
  `fragments/mcp-snippet.json` (entries `enabled: false` by default);
  embedded-credential URLs are stripped, unstrippable cases fail closed to
  manual review; shared `.env.example` (placeholders only) merged from provider
  + MCP vars.
- **Instructions:** each `*.instructions.md` → `<dest>/instructions/<n>.md`
  (verbatim body + advisory `Scope:` header from `applyTo` + notes) plus
  `fragments/instructions-snippet.json`, whose entries and the demoted
  lazy-load pointers in `fragments/agents-index-snippet.md` target the
  post-promotion `.opencode/instructions/<n>.md` location; `excludeAgent` →
  `fragments/excluded-agents.md`; past ~5 files / 8 kB the largest files are
  demoted. Never writes any `AGENTS.md`.

## Boundary (invariants)

- The source workspace is read-only; the toolkit never mutates it.
- The toolkit **never writes inside the repository's own `.opencode/`** (rejected
  in both scopes via `ERR_WRITE_INSIDE_OUR_OPENCODE`). Promotion of the generated
  files is manual.
- All output goes under the resolved write root (`--dest`; project scope defaults
  to `migrated/`, user scope to `~/.config/opencode`); no
  plaintext secrets are emitted.
- User scope never creates or modifies `<config-home>/AGENTS.md`; always-on rules
  go through the `instructions[]` merge into the global `opencode.json`.
