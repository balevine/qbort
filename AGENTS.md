# AGENTS.md

Guidance for agentic coding tools working in this repo. Keep changes consistent with what's here.

`README.md` is the canonical description of how the plugin behaves. When behavior changes, that is the file to update, along with this one and the skill's own README for anything they cover.

`.plans/` is **gitignored, local-only** scratch and is not a source of truth. `.plans/PROJECT_SPEC.md` in particular is a **historical document** (the spec the original Electron app was built from). Read it for background if it's there, but **do not keep it in sync**. It won't exist in a fresh clone. This file plus the two READMEs are the whole picture.

## What this is

A **Claude Code plugin** that generates fake customer-support tickets. The user supplies a `TICKET_PROMPT.md` and answers a short settings Q&A; the ambient Claude model (via parallel subagents) writes ticket content; a deterministic, dependency-free Node engine owns everything structural and writes a `tickets.json`. No app, no UI, no provider, no API key. The only product is the JSON file.

It used to be an Electron desktop app with Anthropic and Ollama providers. That app is deleted, not deprecated. The output format is unchanged, so old files still load in the viewers that read them.

## Structure & the engine/model boundary

- `plugin/lib/*.mjs`: **the logic**, one copy, dependency-free ESM on bare `node`. `args`, `constants`, `fsUtil` (`atomicWriteJson`/`atomicWriteText`/`readJson`/`readText`), `paths` (the two directory names + the timestamped output filename), `promptCompiler`, `scratch` (`clearScratch`), `settings` (`LIMITS`/`clampGeneration`), `staff` (roster + Poisson sampler), `ticketFile` (the `tickets.json` format), `time`, `types` (JSDoc typedefs), `validate` (repair/drop + id/role/timestamp assignment), `version` (reads the plugin manifest).
- `plugin/skills/generate-tickets/engine.mjs`: the CLI (`plan | batches | topup | assemble`). **Orchestration only.**
- `plugin/skills/generate-tickets/SKILL.md`: instructions Claude follows. The only thing that can spawn a subagent, which is the only way a model gets called.
- `plugin/agents/ticket-batch.md`: the restricted (`Read`/`Write` only) batch agent, registered namespaced as `qbort:ticket-batch`.
- `test/`: vitest, in TypeScript, importing `plugin/lib` through the `@lib/*` alias.
- `scripts/`: repo-local dev tools, outside the shipped plugin. `view-tickets.mjs` reads a tickets file in the terminal (list, thread, filter, `--stats`), defaulting to the newest run in `qbort-output/` and loading it through `lib/ticketFile.mjs` so the viewer and the writer agree on the format. Nothing under `plugin/` imports it.

**Hard rule:** the engine owns structure, the model owns content. `id` (sequential int), `isStaff` (from the `@company.biz` domain, opener always the customer), and `createdAt` (synthesized, ascending by id, strictly increasing within a ticket) are assigned by the engine and never trusted from the model. Ticket shape: `{ id, subject, status, messages: [{ from, body, isStaff, createdAt }] }` (opening message is `messages[0]`). The engine never touches the network and has no credentials.

**Second hard rule:** if a change *decides* something (a bound, a shape, a repair rule), it belongs in `lib/`, not in `engine.mjs`.

## Generation pipeline

`plan` (wipe the scratch, clamp settings, generate roster, draw opening times, compile the static prefix, stamp the output filename, emit the scenario prompt) → one subagent writes `scenarios.json` → `batches` (validate + shuffle the list, deal one scenario per ticket, compile per-batch prompts) → fan out one `qbort:ticket-batch` subagent per batch, all in a single message → `assemble` (`validateTickets` → cap → `assembleTickets` → validate our own file through `parseTicketFile` → atomic write) → `topup` + `assemble` again while short, up to 3 extra rounds.

The scenario pass exists because batch prompts are otherwise byte-identical and independent batches converge on the same topics. A missing or short scenario list **fails the run** (`batches` exits non-zero) rather than producing duplicate-heavy tickets at full cost; a reserve that runs dry mid-top-up does not, because most of the output already exists by then.

**Two directories, neither configurable.** `.qbort-run/` is scratch and `qbort-output/` is the product, both hardcoded relative to the working directory (`lib/paths.mjs`). There is no `--out`: the engine takes no path from its caller, which is what makes `plan`'s unconditional wipe of `.qbort-run/` safe. The wipe is the point of the split. Batch files sit at fixed names that *subagents*, not the engine, are expected to write, so a leftover `batch-0-0.json` from a previous run is byte-indistinguishable from a fresh one and would be assembled into the new output silently. Output filenames are timestamped (`tickets-YYYYMMDD-HHMMSS.json`) and **stamped once, at `plan`**, then carried in `run-context.json`. `assemble` runs again after every top-up round, so naming the file at write time would leave a run that needed two top-ups with three files, all looking finished and only the last complete.

Every engine write is atomic, and every named failure has an exit code `SKILL.md` can branch on (`MISSING_PROMPT`, `NO_CONTEXT`, `NO_SCENARIOS`, `BAD_SCENARIOS`, `SHORT_SCENARIOS`, `BAD_ROUND`, `NO_ROUND` → 2; `BAD_OUTPUT` → 3).

**The version has one home:** `plugin/.claude-plugin/plugin.json`. The plugin system requires that file and installs by the version in it, so anything else that needs the number reads it through `lib/version.mjs`, never a literal. `package.json` is the test harness and is `private` with no version at all.

## Code style

- `plugin/` is **zero-dependency ESM on bare `node` (20+)**. No npm imports, no build step, no post-20 APIs (`toSorted`, `Object.groupBy`, `globSync`, and friends).
- Types are **JSDoc** on the exported `lib/` signatures, with the data model itself in `lib/types.mjs`. `checkJs` stays off, so a wrong annotation degrades to `any` silently rather than erroring. Keep them correct by hand.
- **camelCase** everywhere (data model + code).
- Tests are **Vitest**, and they all live in `test/` (nothing under `plugin/`, which would drag vitest and typescript into an installed plugin). They point at the shipped `plugin/lib/*.mjs` through the `@lib/*` alias, so the tested code is the code that ships. Tests are deterministic: `rng`/`now` are injectable, and the engine tests run the real CLI over `child_process` with hand-written files standing in for subagents. Keep them that way.
- TypeScript strict in `test/`. `noUnusedLocals` is on, so no dead vars/imports.
- Prefer pure, testable helpers; keep side effects (fs, process) at the edges. Writes go through `fsUtil`.
- Comments explain **why**, not what; match the surrounding density.
- When writing comments and markdown files, prefer periods and parenthesis over semi-colons and em-dashes.

## Development loop (the plugin)

The skill lives in `plugin/skills/generate-tickets/`, **not** in `.claude/skills/`, so Claude Code does not discover it from the working tree. It is picked up only through a plugin install, and the repo root is its own marketplace (`.claude-plugin/marketplace.json` pointing at `./plugin`). To work on it here:

```
/plugin marketplace add ~/projects/qbort
/plugin install qbort@qbort
```

A bare `.` is not enough for the `marketplace add`. Give it a real path to the repo root.

The plugin's agent registers **namespaced**, as `qbort:ticket-batch`, not as the bare `name:` in its frontmatter. `SKILL.md` spawns it by that name, so a rename of the plugin renames the agent type too.

Then invoke it as `/qbort:generate-tickets`. The install resolves `${CLAUDE_PLUGIN_ROOT}` to the plugin directory, which is how `SKILL.md` finds `engine.mjs` and `templates/` wherever it is installed. Never hardcode a path back to this repo.

**The install is a copy, not a symlink.** Even from a local directory marketplace, `/plugin install` snapshots `plugin/` into `~/.claude/plugins/cache/qbort/qbort/<version>/`, and `${CLAUDE_PLUGIN_ROOT}` points at that snapshot. **No** working-tree edit reaches an installed plugin on its own, not `SKILL.md`, not the manifests, not `agents/`, and not `engine.mjs` or `lib/` either. After editing anything under `plugin/`, re-run `/plugin marketplace update qbort`, reinstall, and **restart the session**. Check `~/.claude/plugins/cache/qbort/qbort/<version>/` against `plugin/` when a run behaves like older code (it probably is older code).

The engine itself needs none of this. It is plain `node` with no dependencies, so the fastest loop for engine work is running its subcommands directly in a temp dir (`node plugin/skills/generate-tickets/engine.mjs plan --prompt TICKET_PROMPT.md --count 6`), which is also what the tests do. Run it from a scratch directory, not the repo root: it reads and writes `.qbort-run/` and `qbort-output/` in whatever directory it is invoked from, and `plan` wipes the first of them.

## Commands

`npm test` · `npm run test:watch` · `npm run typecheck`. There is no build, no dev server, and no packaging step, because the plugin ships the sources it runs. Run `typecheck` + `test` before considering a change done.

To read a run's output without leaving the terminal: `node scripts/view-tickets.mjs --stats`, then `--id 7` for a thread or `--page 2` for the next page of the list. `--help` prints the flags. It defaults to the newest file in `qbort-output/` (pass a path for an older run) and pages by default, so pointing it at a several-hundred-ticket run is safe.

## Notes

- A run touches exactly two directories in the working directory, both gitignored: `.qbort-run/` (scratch, wiped at the start of every run) and `qbort-output/` (the timestamped tickets files, never wiped). Don't add a third, and don't move anything across the line between them.
- `README.md` is user-facing, and its paragraphs are single-line (soft-wrap). Match that. `plugin/skills/generate-tickets/README.md` is the skill's own human docs and follows the same rule. `.notes/` is gitignored scratch.
- CI (`.github/workflows/ci.yml`) is typecheck + test on Node 20. No build job.
- Contribution rule: open an Issue before a PR.
