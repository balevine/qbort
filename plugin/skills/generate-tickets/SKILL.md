---
name: generate-tickets
description: Generate fake customer support tickets with an LLM, driven by a TICKET_PROMPT.md file plus a short settings Q&A. Deals a distinct scenario to every ticket, then fans generation out to parallel subagents; a deterministic engine owns batching, validation/repair, id assignment, timestamp synthesis, and top-up rounds, writing a tickets.json. Use when the user wants to generate synthetic support tickets / a tickets dataset.
disable-model-invocation: true
---

# generate-tickets

Generates a `tickets.json` of fake customer support tickets. The **ambient Claude model** (via
subagents) produces ticket *content*, and a deterministic Node engine (`engine.mjs`) owns everything
structural: batching, validation and repair, sequential ids, `isStaff` role, synthesized
`createdAt` timestamps, per-batch capping, and top-up rounds. Never hand those structural jobs to
the model.

The engine lives next to this file. Let `SKILLDIR = ${CLAUDE_PLUGIN_ROOT}/skills/generate-tickets`
and `ENGINE = $SKILLDIR/engine.mjs`, both absolute. Run all `node "$ENGINE" ...` commands from the
user's working directory.

## Step 1: ensure TICKET_PROMPT.md exists

The user supplies the creative/distribution half of the prompt as `TICKET_PROMPT.md` in the working
directory. Check for it (`ls TICKET_PROMPT.md`).

- **If missing:** copy the starter template (`cp "$SKILLDIR/templates/TICKET_PROMPT.md" TICKET_PROMPT.md`)
  and tell the user you created it, that the starter is generic, and that editing it and running again
  is how they get tickets about their own product. Then continue: a first run off the starter is a
  cheap way to see what the whole pipeline produces.
- **If present:** continue.

## Step 2: collect settings via Q&A

Use the `AskUserQuestion` tool. All answers are re-clamped by the engine, so custom ("Other") values
are safe. Ask these, offering presets plus custom entry:

Round 1 (one `AskUserQuestion` call, up to 4 questions):
- **Number of tickets**: presets 25 / 100 / 500 (1–500).
- **Include staff responses?**: Yes / No.
- **Number of staff members**: presets 5 / 10 / 25 (1–100). The roster is auto-generated at this
  size (`Firstname Lastname` + `firstname.lastname@company.biz`), and custom names aren't collected here.
- **Max ticket age (days)**: presets 30 / 90 / 365 (1–3650). Opening times are spread across this window.

Round 2 (only if staff responses = Yes):
- **Average staff responses per ticket**: presets 1 / 2 / 4 (0–20). Poisson-distributed per ticket.

Keep counts modest by default. Content for every ticket round-trips back through your context when
subagents finish, so runs above a few hundred tickets get expensive. Steer large asks toward a
smaller first run unless the user insists.

500 is a hard cap (the engine clamps to it). The scenario list in Step 4 is written by one subagent
in one response, and much beyond that it stops being reliable. If the user wants more than 500,
tell them to do several runs (each gets its own independent scenario list) rather than asking for
a bigger number.

## Step 3: plan the run

```
node "$ENGINE" plan --prompt TICKET_PROMPT.md \
  --count <N> [--staff] [--avg <A>] --staff-members <M> --age-days <D>
```

Pass `--staff` only when staff responses are enabled (add `--avg <A>` with it). There is no output
flag: the engine always works out of `.qbort-run/` (scratch, wiped at the start of every `plan`) and
writes the finished file into `qbort-output/` (never wiped) in the working directory.

The command prints a `SCENARIO` block naming one `PROMPT=` file and one `OUT=` file for Step 4, and
a `WILL WRITE` line with the output path this run has claimed. That path is fixed now and does not
change for the rest of the run.

## Step 4: generate the scenario list (one subagent)

Batch prompts are otherwise byte-identical, so independent batches converge on the same handful of
topics and produce near-duplicate tickets. The fix is to generate one list of one-line scenarios up
front and deal one per ticket. Spawn **exactly one** subagent (same `ticket-batch` type as Step 5),
with this task, substituting the `PROMPT=` and `OUT=` paths from the `SCENARIO` block:

> Read the file `<PROMPT path>`. It contains complete instructions and the exact JSON output shape
> to produce. Follow it precisely. Write ONLY the resulting JSON object (no markdown fences, no
> commentary) to `<OUT path>`, overwriting it. Then reply with just `done`. Do not read or write any
> other files, and do not run any commands — in particular, do not verify, parse, re-read, or count
> what you wrote.

Then build the batch prompts:

```
node "$ENGINE" batches
```

This validates and shuffles the list and prints a `ROUND 0` block listing one batch per line, each
with an absolute `PROMPT=` file and `BATCH=` file.

If `batches` exits non-zero (`NO_SCENARIOS`, `BAD_SCENARIOS`, or `SHORT_SCENARIOS`), retry the
scenario subagent **once**, then re-run `batches`. If it fails again, **stop and report**. Do not
fan out without scenarios. A full-cost run of duplicate-heavy tickets is worse than no output,
because the user gets no signal that anything went wrong.

## Step 5: fan out subagents (one per batch)

Spawn **all** of a round's batches as subagents **in a single message** (parallel), using the
`Agent` tool.

Use `subagent_type: qbort:ticket-batch`, a restricted agent (`Read`/`Write` only) that ships in this
plugin at `agents/ticket-batch.md`, so it is registered wherever the plugin is installed. The
restriction is the point: with no other tools available, the subagent writes its batch and stops
instead of re-reading and verifying its own output, which is both slower and wasted work (the engine
validates every batch anyway). If that type isn't in the available agent list, check for a bare
`ticket-batch`, and only then fall back to `subagent_type: general-purpose`. The task text below
stands on its own either way.

Give each subagent exactly this task, substituting its own PROMPT and BATCH paths:

> Read the file `<PROMPT path>`. It contains complete instructions and the exact JSON output shape
> to produce. Follow it precisely and generate the tickets. Write ONLY the resulting JSON object
> (no markdown fences, no commentary) to `<BATCH path>`, overwriting it. Then reply with just
> `done`. Do not read or write any other files, and do not run any commands — in particular, do not
> verify, parse, re-read, or count what you wrote. The engine validates and repairs every batch in a
> later step, so checking your own output is wasted work.

If a subagent fails or writes nothing, don't worry. The engine treats a missing/garbled batch file
as zero tickets and the top-up loop (Step 7) makes up the shortfall.

## Step 6: assemble

```
node "$ENGINE" assemble --round 0
```

This validates/repairs each batch, assigns ids + roles + timestamps, caps to the requested count,
appends to the accumulator, and (re)writes this run's file in `qbort-output/`. It prints a
`KEPT … REQUESTED … DROPPED … SHORTFALL …` line and the `FILE` path. Every round of a run rewrites
that same file, so a run leaves exactly one file behind no matter how many top-ups it takes.

## Step 7: top-up rounds (if short)

If `SHORTFALL > 0`, run up to **3** additional rounds (round 1, 2, 3). For each round `R`:

```
node "$ENGINE" topup --round R      # prints a ROUND R batch block
# → spawn that round's subagents in parallel (Step 5)
node "$ENGINE" assemble --round R   # prints the updated SHORTFALL
```

Top-ups draw scenarios from the reserve the scenario list was over-generated with (Step 4 asks for
~30% more than requested). No extra scenario call is needed. If the reserve runs dry, `topup` says so
and those tickets are generated without a scenario. That's expected, not an error.

Stop when `SHORTFALL` reaches 0 or after round 3 (a persistently failing model just returns fewer
than requested, which is expected, not an error).

## Step 8: report

Echo the **full path** from the last `assemble`'s `FILE` line back to the user, verbatim. The
filename is timestamped, so it is different every run and the user cannot guess it. Also give the
kept vs. requested count and how many rounds ran. Offer to preview a few tickets (read and summarize
the file) or to copy it somewhere. Do not print the whole file.

## Notes / invariants

- `plan` wipes `.qbort-run/` before it does anything else. That is deliberate (a leftover batch file
  from an earlier run sits at exactly the path this run's subagent is meant to write, and would be
  assembled into the output as if it were fresh), so never work around it by staging files there
  before planning. `qbort-output/` is never touched by the wipe, so earlier runs' files survive.
- The engine assigns `id` (sequential), `isStaff` (from the `@company.biz` domain, opener always the
  customer), and `createdAt` (ascending by id, strictly increasing within a ticket). The model is
  never trusted with these, so don't post-edit them.
- Runs are not reproducible, by design. Ticket content and the scenario list both come from the
  model, so nothing downstream of them could be reproduced anyway. The engine's own random choices
  (opening times, per-ticket reply targets, scenario deal order) just use `Math.random`.
- Requires Node (`node --version`). No npm install, because the engine is dependency-free ESM.
