# Copilot → OpenCode migration toolkit

Self-contained Node.js 22 + TypeScript CLI that migrates a frozen Copilot
workspace (`copilot-source/` by default) into OpenCode-ready artifacts
(`migrated/` by default). By default the run is interactive: it previews each
change and asks before writing, so nothing is written without consent;
`--dry-run` writes nothing at all; `--yes` writes non-interactively.

The target is chosen with `--scope` (default `project`): `project` keeps the
repo-local `migrated/` staging to review before merging into your project's
`.opencode/` config, while `user` emits straight into the OpenCode config home
(`$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`).

## Requirements

- Node.js 22+
- Install inside this package only: `npm --prefix toolkit install`

## Usage

```bash
# Interactive (default): preview + per-file consent, zero-config defaults
npx --prefix toolkit tsx toolkit/bin/migrate.ts

# Explicit dry run: preview only, writes nothing
npx --prefix toolkit tsx toolkit/bin/migrate.ts --dry-run

# Non-interactive run that writes the resolved dest
npx --prefix toolkit tsx toolkit/bin/migrate.ts \
  --yes --source copilot-source --dest migrated
```

The package exposes `copilot-migrate` as a `bin` entry when installed.

### Flags

| Flag | Meaning |
|---|---|
| `--source <dir>` | Copilot source root (default `copilot-source`). |
| `--dest <dir>` | Output root. Project scope: repo-rooted (default `migrated/`). User scope: explicit override of the config home (default `$XDG_CONFIG_HOME/opencode` or `~/.config/opencode`). Created if missing. |
| `--scope <user\|project>` | Target scope (default `project`). `project` keeps the repo-local staging flow; `user` writes to the OpenCode config home. |
| `--cli-home <dir>` | Optional Copilot CLI home to merge (dedup, no precedence). Defaults to `<source>/cli-home` when it exists. |
| `--family <name>` | Restrict the run to one family: `agent`, `prompt`, `instructions`, `skill`, `mcp`, `provider`, `hooks`. |
| `--team <name>` | Repeatable; only migrate artifacts of these teams (`all` = every team). Omit for interactive per-team selection, or a `MULTI_TEAM` warning in `--yes`. |
| `--model-map <path>` | JSON overlay merged over `toolkit/model-map.json`. |
| `--allow-unmapped-models` | Keep unmapped/stale model values and exit 0 in `--yes` mode. |
| `--allow-overwrite` | In `--yes` mode, replace existing targets and apply a colliding `opencode.json` merge instead of aborting. |
| `--dry-run` | Preview only; writes zero files. |
| `--yes` | Non-interactive run that writes the resolved dest. |
| `--help` | Print usage. |

### Target scope

`--scope` selects where the output tree is rooted:

- **`project`** (default) — the write root is `resolve(repoRoot, --dest ?? "migrated")`.
  Layout mirrors a project-scope OpenCode tree (`commands/` plural). This is the
  documented staging area to review before merging into your project's `.opencode/`.
- **`user`** — the write root is the OpenCode config home: `--dest` wins, else
  `$XDG_CONFIG_HOME/opencode`, else `~/.config/opencode`; with none of those the
  run fails fast with `ERR_NO_CONFIG_HOME`. Commands land in `command/`
  (singular — the directory the installed runtime reads), while every other
  family keeps its usual name. Provider/MCP/instructions fragments are
  deep-merged into the existing `<config-home>/opencode.json` (tmp + rename,
  unrelated keys preserved); the toolkit **never** creates or modifies
  `<config-home>/AGENTS.md`.

### Interactive flow

Without `--yes` the CLI asks for the target scope (default `project`), then for
the source and destination (pre-filled with the scope-derived defaults),
validates them, and re-prompts on invalid input up to 3 attempts. It then shows
a resolved-paths panel (including `scope → write root`) before anything is
transformed. Per-family choices (delegation pattern, unknown-model resolution)
are prompted as they arise, and every proposed file is previewed and written
only after per-file consent. At user scope the proposed `opencode.json` merge is
rendered as a diff and gated behind the same overwrite consent. Unknown models
can be persisted into the scope-resolved `model-map.json` after explicit
confirmation.

In `--yes` mode every choice uses the documented default (prompt pattern B; no
interactive model resolution) and any invalid path fails fast with a non-zero
exit.

### Team namespacing and selection

A source organised per team (`github-copilot/<team>/{agents,instructions,prompts,skills}/…`)
is migrated preserving that hierarchy: the team becomes the first output level
below the family dir (`instructions/neo/generic.md`,
`skills/common/feign-client-integration/SKILL.md`). Classic layouts with no team
folder stay flat, and every instruction remains a separate file (never merged
into an `AGENTS.md`). Teams span all families, so selection filters the whole
run: `--team <name>` (repeatable) or `--team all`, an interactive per-team
checkbox when more than one team is discovered, or — in `--yes` without an
explicit selection — a visible `MULTI_TEAM` warning row with per-team ×
per-family counts plus per-team breakdown rows in the report. An unknown
`--team` is `MANUAL_REVIEW`; when none of the requested teams match, the run
emits a `TEAM_SELECTION` error and exits `1`. `--team all` migrates everything
even when co-passed with other names, but every co-passed name that matches no
team is still flagged `MANUAL_REVIEW` (never silently swallowed). Confirming an
empty interactive checkbox is an explicit error too: the run emits a
`TEAM_SELECTION` row and exits `1` rather than silently migrating only
root-level artifacts.

The namespace rule is name-agnostic: any segment starting with `.` is infra and
dropped (`.github`, `.config`, …), while named containers are kept verbatim and
no team/container name is hardcoded. OpenCode derives an agent's ID from its
path, so the session also builds one `AgentReferenceIndex` (basename → namespaced
ID) from the selected agents and rewrites the agent-name sites the toolkit emits
(prompt `agent:`, generated `task(agent="…")` blocks, `excludeAgent`
notes/table). A basename shared by two teams is **ambiguous**: the reference
stays verbatim and the report gains a `MANUAL_REVIEW` row prefixed
`AMBIGUOUS_AGENT_REF:`; a basename matching no migrated agent gets
`UNKNOWN_AGENT_REF:`. Emitted IDs and written paths can never diverge because the
index reuses the same namespace computation.

### `--yes` overwrite safety

Non-interactive runs never silently replace what is already there:

- If any migrated target file already exists under the dest, the run emits an
  `OVERWRITTEN` blocker and exits `1` without writing anything. Pass
  `--allow-overwrite` to replace existing targets.
- If merging the user-scope `opencode.json` would overwrite an existing
  `provider.<id>` or `mcp.<id>` whose value differs, the run emits
  `INFO_CONFIG_OVERWRITE` rows and exits `1` unless `--allow-overwrite` is given.
- If the existing `opencode.json` is not valid JSONC, the run emits
  `ERR_CONFIG_INVALID` and writes zero files in either mode.

Interactive runs keep the per-file preview + consent flow, so the flag is only
needed for `--yes`.

## Model resolution

Copilot model values resolve in two explicit modes. Neither ever guesses
silently; a substitution is always visible in the report.

### JSON mode (deterministic, no prompt)

An explicit map entry resolves the model with no interaction. The map format is
`{ "<copilot-model-name>": "<destination-id>" }`, keyed case-insensitively:

```json
{
  "gpt-4o": "litellm/litellm-default",
  "claude-3.5-sonnet": "litellm/litellm-builder"
}
```

- **Built-in:** `toolkit/model-map.json`. It ships opinionated defaults for this
  repo — edit it to change the defaults.
- **Overlay:** `--model-map <path>` is merged **over** the built-in map, so an
  overlay key wins. Use it for CI or one-off runs without touching the built-in.
- A map value absent from the catalog is flagged `STALE_MODEL_ID` (gated like an
  unmapped model) and is never written out.

### Interactive mode (TTY, no `--yes`)

When a `model:` has no map entry and is not already a valid destination catalog
ID, an interactive run asks you to choose from the catalog, type a custom ID, or
keep the original for manual review. The choice may be persisted into
`toolkit/model-map.json` only after explicit confirmation, so the next run
resolves it deterministically.

### Precedence (single value)

1. **Explicit map entry** — `--model-map <path>` overlay first, then
   `toolkit/model-map.json`; the mapped value must exist in the catalog.
2. **Pass-through** — a value already present in the destination catalog
   (`litellm/*`, read from `.opencode/agents/*.md` + `opencode.json`; no IDs are
   invented) is kept unchanged, with no map lookup and no prompt.
3. **Interactive choice** — only on an interactive run (TTY, no `--yes`), from
   the catalog or a typed ID.
4. **`--yes` fallback** — with no map entry, no valid catalog ID and no prompt,
   the original value is preserved and an `UNMAPPED_MODEL` row is emitted; the
   run exits non-zero unless `--allow-unmapped-models` is given.

### Visibility

- Every substitution emits an `info` report row `MODEL_MAPPED` with
  `` `<original>` → `<dest>` (from <source>) ``, where source is `model-map.json`
  or `--model-map <path>`. Rows land in `_migration-report.md/.json`.
- In `--yes` mode the model rows are also echoed to stdout after the run
  (previously `--yes` printed no model information).
- `model: [A, B, C]` collapses to the **first** mappable member (array contract
  unchanged). The full original array and the remaining members stay in
  `## OpenCode notes`.
- The original Copilot model value is always preserved in `## OpenCode notes`.
- A mapped ID absent from the catalog snapshot is flagged `STALE_MODEL_ID`.

## Agent migration

Each `.github/agents/<n>.agent.md` (and legacy `*.chatmode.md`) becomes
`<dest>/agents/<n>.md`. A migrated custom agent defaults to `mode: primary`
(user-selectable); only an explicit `user-invocable: false` in the source maps it
to `mode: subagent`. Deprecated/legacy fields are never dropped silently:
`disable-model-invocation` and `infer` are recorded verbatim in `## OpenCode notes`
and do not override the default mode. Model arrays collapse to the first mappable
member, and `handoffs` become explicit `task()` snippets in the body with their
`agent` rewritten to the namespaced ID (unresolved handoffs stay verbatim and
surface an `*_AGENT_REF` `MANUAL_REVIEW` row).

## Provider migration

Copilot BYOK/Azure/custom provider config (`user-model-config.json` style) is
parsed into an OpenCode `provider{}` JSON fragment written under the resolved
dest (`fragments/opencode-provider.fragment.json`):

```json
{
  "provider": {
    "<provider-id>": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "<display name>",
      "options": { "baseURL": "…", "apiKey": "{env:VAR}" },
      "models": { "<model-id>": { "name": "<display>" } }
    }
  }
}
```

- Secrets are always emitted as `{env:VAR}` (or honoured `{file:…}`); plaintext
  API keys are replaced and flagged, and embedded baseURL credentials are
  stripped.
- A single `<dest>/.env.example` is merged from provider and MCP env vars,
  deduplicated, with placeholder values only.
- The toolkit never edits `.opencode/opencode.json`; merge the fragment into your
  project's config yourself.

## Instructions migration

Each `.github/instructions/<n>.instructions.md` (and
`.github/copilot-instructions.md`) becomes
`<dest>/instructions/<namespace>/<n>.md` (namespace empty for classic layouts)
with the body preserved verbatim, an advisory `Scope:` header derived from
`applyTo`, and a `## OpenCode notes` trailer. `fragments/instructions-snippet.json`
holds the `instructions[]` entries to review and merge into your config:

- a single `.opencode/instructions/**/*.md` glob by default (the post-promotion
  location; recursive so namespaced subdirectories are covered);
- narrowed per prefix only when every `applyTo` shares one static directory
  (`**/<prefix>-*.md`);
- an explicit file list once the budget is exceeded.

`excludeAgent` has no native OpenCode enforcement and is recorded in each file's
notes plus `fragments/excluded-agents.md`, with the agent name rewritten to its
namespaced ID when it resolves (otherwise the reference stays verbatim and an
`AMBIGUOUS_AGENT_REF:`/`UNKNOWN_AGENT_REF:` `MANUAL_REVIEW` row is emitted).

If the set exceeds ~5 files or 8 kB the toolkit warns (interactive override
available) and demotes the largest files to lazy-load pointers in
`fragments/agents-index-snippet.md` that read `.opencode/instructions/<n>.md`,
dropping them from the snippet. Nothing is ever concatenated into any `AGENTS.md`,
and no `AGENTS.md` is written.

At user scope the `instructions[]` glob targets the **absolute** config-home
path (`<config-home>/instructions/**/*.md`, or per-file absolute namespaced
paths once demoted): OpenCode resolves relative instruction patterns against the
project directory, not the config home, so only absolute (or `~/`) paths are
reliable in a global config.

## Recommended plugins

`src/config/recommended-plugins.json` ships the curated plugin set:

```json
{
  "version": 1,
  "plugins": [
    { "kind": "local", "specifier": "plugins/graphify.js" },
    { "kind": "npm", "specifier": "@zenobius/opencode-skillful@latest" }
  ]
}
```

When it has content the toolkit emits
`fragments/opencode-plugins.fragment.json` (`{ "plugin": ["…"] }`, mirroring the
`mcp`/`provider` fragments); at user scope the `plugin[]` is union-merged
(deduped) into `opencode.json`, preserving unrelated and pre-existing entries. An
absent file or an empty `plugins[]` array is a **no-op** — no `plugin` key is
ever emitted. npm specifiers are emitted verbatim (never fetched or copied);
local `.js` specifiers resolve **relative to the toolkit package root**, and the
bundled local sources ship inside the package itself (`toolkit/plugins/*.js`), so
the published `toolkit/` export resolves them without depending on the consuming
repo. They are copied into the target plugins dir
(`<dest>/.opencode/plugins/` project scope, `<dest>/plugins/` user scope) and
referenced relative to the config root. A local source that cannot be resolved
emits a `MANUAL_REVIEW` row and the entry is skipped. A malformed
`recommended-plugins.json` (invalid JSONC or schema) is not fatal-to-the-process:
the run emits an `ERR_PLUGIN_RECOMMENDATIONS` report row and exits `1`.

## Path validation

Rejections use named error codes and appear in the report/stderr:

| Code | Rule |
|---|---|
| `ERR_SOURCE_READABLE` | Source must exist and be a readable directory. |
| `ERR_CLI_HOME_READABLE` | A provided CLI home must exist and be readable. |
| `ERR_CLI_HOME_OVERLAP` | CLI home must not contain the source or touch the dest (a CLI home nested inside the source is allowed). |
| `ERR_SOURCE_EQUALS_DEST` | Source and dest must differ. |
| `ERR_DEST_INSIDE_SOURCE` | Dest must not sit inside source. |
| `ERR_SOURCE_INSIDE_DEST` | Source must not sit inside dest. |
| `ERR_DEST_OUTSIDE_REPO` | Project scope only: dest must resolve inside the repository root. |
| `ERR_DEST_IN_OPENCODE` | Project scope only: dest inside (or equal to) `.opencode/` is rejected outright. |
| `ERR_NO_CONFIG_HOME` | User scope only: no `--dest` and neither `XDG_CONFIG_HOME` nor `HOME` resolves a config home. |
| `ERR_WRITE_INSIDE_OUR_OPENCODE` | The toolkit's own `.opencode/` is never writable, in either scope. |
| `ERR_SOURCE_IS_REPO_ROOT` | Confirmation, not an error: source equal to the repo root needs explicit confirmation interactively and is refused in `--yes`. |

Every write target is re-checked against the validated dest root before writing.

## Boundaries (invariants)

- `copilot-source/` is read-only; the toolkit never mutates it.
- The toolkit never writes inside the toolkit's own `.opencode/` — rejected in both
  scopes via `ERR_WRITE_INSIDE_OUR_OPENCODE`; review the generated output and
  merge it into your project's `.opencode/` config yourself.
- All output goes under the resolved write root (`--dest`; project default
  `migrated/`, user default `~/.config/opencode`).
- User scope never creates or modifies `<config-home>/AGENTS.md`; always-on rules
  flow exclusively through the `instructions[]` merge into the global
  `opencode.json`.
- No plaintext secrets: MCP `${input:var}` and `${env:VAR}` become `{env:VAR}`;
  provider keys become `{env:VAR}`; `.env.example` carries placeholders only.

## Output layout (default dest)

Project scope (`--scope project`, default):

```text
migrated/
  agents/[<team>/]*.md
  commands/[<team>/]*.md
  skills/[<team>/]<name>/SKILL.md
  instructions/[<team>/]*.md
  .opencode/plugins/*.js             (only when recommended-plugins.json has local entries)
  fragments/
    instructions-snippet.json
    excluded-agents.md
    agents-index-snippet.md          (only past the budget)
    mcp-snippet.json
    opencode-provider.fragment.json
    opencode-plugins.fragment.json   (only when recommended-plugins.json has content)
  .env.example
  _migration-report.md
  _migration-report.json
```

`[<team>/]` appears only for per-team sources (see above); classic layouts stay
flat. User scope (`--scope user`) uses the same layout under the config home,
except commands land in `command/` (singular), local plugins live in `plugins/`,
and the owned fragments are additionally deep-merged into `opencode.json`:

```text
~/.config/opencode/
  opencode.json                    (deep-merged with existing keys preserved)
  agents/[<team>/]*.md
  command/[<team>/]*.md
  skills/[<team>/]<name>/SKILL.md
  instructions/[<team>/]*.md
  plugins/*.js                     (only when recommended-plugins.json has local entries)
  fragments/…
  _migration-report.md
  _migration-report.json
```

## Tests

```bash
npm --prefix toolkit run lint
npm --prefix toolkit run typecheck
npm --prefix toolkit test
```

Fixtures live in `toolkit/test/fixtures/copilot/` and
`toolkit/test/fixtures/cli-home/`; integration tests use atomically created temp
dirs for both source and dest, so the repo's `copilot-source/` and `migrated/`
defaults are never touched.
