---
name: generate-tickets
description: Generate fake customer-support tickets with an LLM, driven by a TICKET_PROMPT.md file plus a short settings Q&A. Fans generation out to parallel subagents; a deterministic engine owns batching, validation/repair, id assignment, timestamp synthesis, and top-up rounds, writing a tickets.json. Use when the user wants to generate synthetic support tickets / a tickets dataset.
---

# generate-tickets

Generates a `tickets.json` of fake customer-support tickets. This is a headless re-imagining of
the Qbort desktop app: the **ambient Claude model** (via subagents) produces ticket *content*, and
a deterministic Node engine (`engine.mjs`) owns everything structural — batching, validation and
repair, sequential ids, `isStaff` role, synthesized `createdAt` timestamps, per-batch capping, and
top-up rounds. Never hand those structural jobs to the model.

The engine lives next to this file. Let `ENGINE = .claude/skills/generate-tickets/engine.mjs` and
`SKILLDIR = .claude/skills/generate-tickets` (adjust if the skill is installed elsewhere). Run all
`node "$ENGINE" ...` commands from the user's working directory.

## Step 1 — ensure TICKET_PROMPT.md exists

The user supplies the creative/distribution half of the prompt as `TICKET_PROMPT.md` in the working
directory. Check for it (`ls TICKET_PROMPT.md`).

- **If missing:** copy the starter template (`cp "$SKILLDIR/templates/TICKET_PROMPT.md" TICKET_PROMPT.md`),
  tell the user you created it, and **stop** so they can edit it before generating. Do not proceed to
  generation on the same turn — the starter is generic and they'll usually want to tailor it.
- **If present:** continue.

## Step 2 — collect settings via Q&A

Use the `AskUserQuestion` tool. All answers are re-clamped by the engine, so custom ("Other") values
are safe. Ask these, offering presets plus custom entry:

Round 1 (one `AskUserQuestion` call, up to 4 questions):
- **Number of tickets** — presets 25 / 100 / 500 (1–5000).
- **Include staff responses?** — Yes / No.
- **Number of staff members** — presets 5 / 10 / 25 (1–100). The roster is auto-generated at this
  size (`Firstname Lastname` + `firstname.lastname@company.biz`); custom names aren't collected here.
- **Max ticket age (days)** — presets 30 / 90 / 365 (1–3650). Opening times are spread across this window.

Round 2 (only if staff responses = Yes):
- **Average staff responses per ticket** — presets 1 / 2 / 4 (0–20). Poisson-distributed per ticket.

Keep counts modest by default. Content for every ticket round-trips back through your context when
subagents finish, so runs above a few hundred tickets get expensive — steer large asks toward a
smaller first run unless the user insists.

## Step 3 — plan the run

```
node "$ENGINE" plan --prompt TICKET_PROMPT.md --out .qbort-run \
  --count <N> [--staff] [--avg <A>] --staff-members <M> --age-days <D>
```

Pass `--staff` only when staff responses are enabled (add `--avg <A>` with it). The command prints a
`ROUND 0` block listing one batch per line, each with an absolute `PROMPT=` file and `BATCH=` file.

## Step 4 — fan out subagents (one per batch)

Spawn **all** of a round's batches as subagents **in a single message** (parallel), using the
`Agent` tool.

Prefer `subagent_type: ticket-batch` — a restricted agent (`Read`/`Write` only) that ships alongside
this skill at `.claude/agents/ticket-batch.md`. If that agent type isn't registered (the skill folder
was copied without `.claude/agents/`), fall back to `subagent_type: general-purpose`. The task text
below stands on its own either way.

Give each subagent exactly this task, substituting its own PROMPT and BATCH paths:

> Read the file `<PROMPT path>`. It contains complete instructions and the exact JSON output shape
> to produce. Follow it precisely and generate the tickets. Write ONLY the resulting JSON object
> (no markdown fences, no commentary) to `<BATCH path>`, overwriting it. Then reply with just
> `done`. Do not read or write any other files, and do not run any commands — in particular, do not
> verify, parse, re-read, or count what you wrote. The engine validates and repairs every batch in a
> later step, so checking your own output is wasted work.

If a subagent fails or writes nothing, don't worry — the engine treats a missing/garbled batch file
as zero tickets and the top-up loop (Step 6) makes up the shortfall.

## Step 5 — assemble

```
node "$ENGINE" assemble --out .qbort-run --round 0
```

This validates/repairs each batch, assigns ids + roles + timestamps, caps to the requested count,
appends to the accumulator, and (re)writes `.qbort-run/tickets.json`. It prints a
`KEPT … REQUESTED … DROPPED … SHORTFALL …` line and the final `FILE` path.

## Step 6 — top-up rounds (if short)

If `SHORTFALL > 0`, run up to **3** additional rounds (round 1, 2, 3). For each round `R`:

```
node "$ENGINE" topup --out .qbort-run --round R      # prints a ROUND R batch block
# → spawn that round's subagents in parallel (Step 4)
node "$ENGINE" assemble --out .qbort-run --round R   # prints the updated SHORTFALL
```

Stop when `SHORTFALL` reaches 0 or after round 3 (a persistently failing model just returns fewer
than requested — that's expected, not an error).

## Step 7 — report

Tell the user the final `tickets.json` path, the kept vs. requested count, and how many rounds ran.
Offer to preview a few tickets (read and summarize the file) or to copy it somewhere. Do not print
the whole file.

## Notes / invariants

- The engine assigns `id` (sequential), `isStaff` (from the `@company.biz` domain, opener always the
  customer), and `createdAt` (ascending by id, strictly increasing within a ticket). The model is
  never trusted with these — don't post-edit them.
- Everything is deterministic given the run's seed (printed by `plan`); pass `--seed <n>` to `plan`
  to reproduce a run.
- Requires Node (`node --version`). No npm install — the engine is dependency-free ESM.
