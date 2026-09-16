# migration-toolkit.md — Interactive Copilot → OpenCode migration toolkit

`toolkit/` is a self-contained Node.js 22 + TypeScript (strict) CLI that
automates step 2 of the migration flow (`@docs/architecture.md`): it migrates
a frozen Copilot workspace into OpenCode-ready artifacts under the resolved
`--dest` (default `migrated/`). Entry: `toolkit/bin/migrate.ts`. Config:
`toolkit/package.json`, `toolkit/tsconfig.json`, `toolkit/model-map.json`.
Full reference: `toolkit/README.md`.

## Commands

```bash
npm --prefix toolkit test            # vitest (251 tests, 26 files)
npm --prefix toolkit run typecheck   # tsc --noEmit
npm --prefix toolkit run lint        # eslint
npx --prefix toolkit tsx toolkit/bin/migrate.ts            # interactive (default)
npx --prefix toolkit tsx toolkit/bin/migrate.ts --dry-run  # preview only
npx --prefix toolkit tsx toolkit/bin/migrate.ts --yes --source copilot-source --dest migrated
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

## Manual steps (what needs a human)

Every run that reaches the report stage prints a final `Manual steps required
(N):` summary — all modes, `--dry-run` included — and `_migration-report.md`
repeats it under `## Manual steps required` (with an explicit none line when the
run was fully automatic). `_migration-report.json` adds
`summary.manualSteps { mechanical, decision }` plus a `manualSteps[]` array;
`summary.counts` is unchanged. Manual work is either **mechanical**
(`SECRET_NORMALIZED`, `OVERWRITTEN`, `INFO_CONFIG_OVERWRITE`) or a **decision**
(`UNMAPPED_MODEL`, `STALE_MODEL_ID`, `MANUAL_REVIEW`, `MANUAL_REWRITE`,
`PARSE_FALLBACK`, `BUDGET_EXCEEDED`, `EXCLUDED_AGENT`, `MULTI_TEAM`,
`TEAM_SELECTION`, `ERR_PLUGIN_RECOMMENDATIONS`, `ERR_CONFIG_INVALID`).

Always manual, after every run: review the generated output and merge it into
your project's `.opencode/` config yourself; merge the project-scope
`fragments/*.fragment.json` you want; fill the `.env.example` placeholders with
real values; run `check-duplicates` before merging skills. The toolkit never
writes `.opencode/`. Severity is not the exit code: an error-severity row can
still exit `0` (MCP unstrippable credentials). Canonical per-code action table
and exit-code note:
[`toolkit/README.md` → Manual steps](../toolkit/README.md#manual-steps-what-needs-a-human).

## Target scope

`--scope user|project` (default `project`) selects the write root:

- `project` — `resolve(repoRoot, --dest ?? "migrated")`, layout mirrors a
  project OpenCode tree (`commands/` plural); the staging directory you review
  before merging into your project config.
- `user` — the OpenCode config home (`--dest` override > `XDG_CONFIG_HOME` →
  `${XDG}/opencode` > `~/.config/opencode`; none → `ERR_NO_CONFIG_HOME`).
  Commands land in `command/` (singular) via per-scope constants
  (`USER_COMMANDS_DIR`/`PROJECT_COMMANDS_DIR`); provider/MCP/instructions
  fragments are deep-merged (tmp + rename) into `<config-home>/opencode.json`
  with unrelated keys preserved, and `<config-home>/AGENTS.md` is never written.

The toolkit's own `.opencode/` is never writable in either scope
(`ERR_WRITE_INSIDE_OUR_OPENCODE`).

User-scope `instructions[]` entries are emitted as **absolute** paths
(`<config-home>/instructions/*.md`). OpenCode resolves relative instruction
patterns against the project/worktree directory (`globUp` in upstream
`session/instruction.ts`), not the config home; only absolute (or `~/`)
patterns resolve predictably from a global config, so the absolute form is the
portable choice. A CLI test asserts the exact emitted values.

## Team namespacing and selection

Copilot workspaces can organise artifacts per team
(`github-copilot/<team>/{agents,instructions,prompts,skills}/…`). The toolkit
preserves that hierarchy instead of flattening by basename: the **namespace** is
the path between the source root and the family folder (`agents|prompts|instructions|skills`),
minus every **infra segment** — any segment whose name starts with `.`
(`.github`, `.config`, …). The rule is name-agnostic: no team or container name
is hardcoded, and every named container is kept verbatim. Classic layouts with
no team folder (`.github/instructions/x`, root `prompts/y`) keep the flat output.

```text
neo/instructions/generic.instructions.md            → instructions/neo/generic.md
common/agents/java-backend-developer.agent.md       → agents/common/java-backend-developer.md
common/skills/feign-client-integration/SKILL.md     → skills/common/feign-client-integration/SKILL.md
common/prompts/jira-review.prompt.md                → command/common/jira-review.md  (user scope)
.github/instructions/typescript.instructions.md     → instructions/typescript.md     (classic, flat)
```

Every instruction stays a **separate file** (one per origin, namespaced): origins
are never concatenated, merged, or written into any `AGENTS.md`.

Teams span every family, so selection filters the whole run:

- `--team <name>` is repeatable; `--team all` migrates everything. Root-level
  artifacts (no team) are always migrated.
- Interactive runs with more than one team prompt a per-team checkbox
  (unless `--team` is given).
- `--yes` with no explicit `--team` never migrates silently: it emits a visible
  `MULTI_TEAM` warning row with the per-team × per-family counts, plus one
  per-team breakdown row showing what was migrated;
  `_migration-report.{md,json}` carries both.
- A `--team` value matching no discovered team emits a `MANUAL_REVIEW` row; if
  none of the requested teams match, the run emits a `TEAM_SELECTION` error and
  exits `1` (`computeExitCode`). `--team all` migrates everything even when
  co-passed with other names, but each co-passed unmatched name is still flagged
  `MANUAL_REVIEW`. An empty interactive checkbox is an explicit error: the run
  emits a `TEAM_SELECTION` row and exits `1`.

At user scope only the selected teams' entries are merged into `opencode.json`.

### Agent reference rewriting

OpenCode derives an agent's ID from the path after `agents/`, so a namespaced
agent registers as `common/jira-reviewer`, not `jira-reviewer`. The session
builds one `AgentReferenceIndex` (source basename → namespaced ID) from the
agents selected for migration, then rewrites every agent-name site the toolkit
itself emits: the prompt frontmatter `agent:`, the generated `task(agent="…")`
blocks (prompt delegation + agent handoffs), the `excludeAgent` note and the
`fragments/excluded-agents.md` table.

Resolution is never a silent guess:

- **resolved** — exactly one migrated agent carries the basename → emit the
  namespaced ID (`agent: common/jira-reviewer`);
- **ambiguous** — two selected teams share the basename → keep the reference
  verbatim and emit one `MANUAL_REVIEW` row prefixed `AMBIGUOUS_AGENT_REF:` with
  the candidate IDs;
- **unknown** — the basename matches no migrated agent (e.g. a user-scope agent
  outside the selection) → keep it verbatim and emit `UNKNOWN_AGENT_REF:` in a
  `MANUAL_REVIEW` row.

Because the index is derived from the same `namespaceOf()` used to write the
files, emitted IDs and written paths cannot diverge; artifact bodies copied
verbatim are never rewritten.

## Model resolution

Model values resolve in two explicit modes (never a silent guess). Per-value
precedence: **map → pass-through → interactive → `--yes` fallback**.

**JSON mode (deterministic, no prompt).** A map entry
`{ "<copilot-model-name>": "<destination-id>" }` (keys case-insensitive)
resolves without interaction. The built-in `toolkit/model-map.json` **ships
opinionated defaults for this repo** (edit it), and `--model-map <path>` is
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
| `--source <dir>` | Copilot source root (default `copilot-source`). |
| `--dest <dir>` | Output root. Project scope: repo-rooted (default `migrated`). User scope: config-home override (default `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`). |
| `--scope <user\|project>` | Target scope (default `project`). |
| `--cli-home <dir>` | Optional Copilot CLI home to merge (dedup, no precedence). Defaults to `<source>/cli-home` when it exists. |
| `--family <name>` | Restrict the run to one family: `agent`, `prompt`, `instructions`, `skill`, `mcp`, `provider`, `hooks`. |
| `--team <name>` | Repeatable; only migrate artifacts of these teams (`all` = every team). Omit for interactive per-team selection, or a visible `MULTI_TEAM` warning in `--yes`. |
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
| `ERR_WRITE_INSIDE_OUR_OPENCODE` | This workspace's own `.opencode/` is never writable, in either scope. |
| `ERR_SOURCE_IS_REPO_ROOT` | Confirmation, not error: interactive asks, `--yes` refuses. |

Every write target is re-checked against the validated dest root before writing.

## Provider / MCP / instructions behavior

- **Provider:** emits `fragments/opencode-provider.fragment.json` using
  `{env:VAR}` (plaintext keys replaced, baseURL credentials stripped);
  never touches `.opencode/opencode.json` — merge the fragment into your
  project's config yourself.
- **MCP:** `${input:var}` and `${env:VAR}` → `{env:VAR}` into
  `fragments/mcp-snippet.json` (entries `enabled: false` by default);
  embedded-credential URLs are stripped, unstrippable cases fail closed to
  manual review; shared `.env.example` (placeholders only) merged from provider
  + MCP vars.
- **Instructions:** each `*.instructions.md` → `<dest>/instructions/<namespace>/<n>.md`
  (namespace empty for classic layouts; verbatim body + advisory `Scope:` header
  from `applyTo` + notes) plus `fragments/instructions-snippet.json`, whose
  entries and the demoted lazy-load pointers in
  `fragments/agents-index-snippet.md` target the post-promotion
  `.opencode/instructions/<namespace>/<n>.md` location; the default snippet glob
  is `**/*.md` (recursive, so namespaced subdirectories are covered);
  `excludeAgent` → `fragments/excluded-agents.md`, rewritten through the
  `AgentReferenceIndex` (unresolved references surface `*_AGENT_REF`
  `MANUAL_REVIEW` rows); past ~5 files / 8 kB the
  largest files are demoted. Never writes any `AGENTS.md`.
- **Recommended plugins:** `src/config/recommended-plugins.json` ships the
  curated plugin set (`{ "version": 1, "plugins": [{ "kind": "npm"|"local",
  "specifier": "…" }] }`). When it has content the toolkit emits
  `fragments/opencode-plugins.fragment.json` (`{ "plugin": [...] }`, mirroring
  the `mcp`/`provider` fragments) and, at user scope, unions the `plugin[]` into
  `opencode.json` (deduped, unrelated/pre-existing entries preserved). An
  absent file or an empty `plugins[]` array is a no-op: no `plugin` key is ever
  emitted. npm specifiers are emitted verbatim; local `.js` specifiers resolve
  **relative to the toolkit package root**, with the bundled sources shipped in
  the package (`toolkit/plugins/*.js`) so the published export resolves them
  without the consuming repo carrying `.opencode/plugins/`. Local entries are
  copied into the target plugins dir (`<dest>/.opencode/plugins/` project scope,
  `<dest>/plugins/` user scope) and referenced relative to the config root; a
  local source that cannot be resolved yields a `MANUAL_REVIEW` row and the
  entry is skipped. Invalid JSONC or schema is caught: the run emits an
  `ERR_PLUGIN_RECOMMENDATIONS` row and exits `1` instead of crashing.

## Boundary (invariants)

- `copilot-source/` is read-only; the toolkit never mutates it.
- The toolkit **never writes inside your project's `.opencode/`** (rejected in
  both scopes via `ERR_WRITE_INSIDE_OUR_OPENCODE`); merging the output into your
  `.opencode/` config happens on your side.
- All output goes under the resolved write root (`--dest`; project default
  `migrated/`, user default `~/.config/opencode`); no plaintext secrets are emitted.
- User scope never creates or modifies `<config-home>/AGENTS.md`; always-on rules
  go through the `instructions[]` merge into the global `opencode.json`.

The public [`copilot-to-opencode-toolkit`](https://github.com/makotarifa/copilot-to-opencode-toolkit)
export is a clean snapshot, not a fork: the next re-export picks up the
name-agnostic namespace rule and the agent-reference rewriting documented above.
