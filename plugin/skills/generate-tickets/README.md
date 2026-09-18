# generate-tickets (Claude Code skill)

The skill inside the [Qbort](../../../README.md) plugin. It generates fake customer-support tickets and writes them to a `tickets.json`: the **ambient Claude model** (via parallel subagents) produces ticket content, while a small, dependency-free Node engine owns everything structural.

There is no API key and no `npm install`. If you're in [Claude Code](https://docs.anthropic.com/en/docs/claude-code) and want a tickets dataset from a prompt file plus a few questions, this is the whole product.

## Requirements

- **Claude Code** (the skill runs inside it).
- **Node.js** on your `PATH` (`node --version`). No `npm install`, because the engine is dependency-free ESM.

## Install

The skill ships inside the `qbort` plugin, not as a loose folder, because it needs the `ticket-batch` agent and `plugin/lib/` alongside it:

```
/plugin marketplace add balevine/qbort
/plugin install qbort@qbort
```

`ticket-batch` is the restricted `Read`/`Write`-only agent the skill spawns for batch generation, which keeps batch subagents from shelling out to verify their own output. Installing via the plugin registers it (namespaced, as `qbort:ticket-batch`) wherever the plugin goes.

## Usage

1. `cd` into the directory where you want the output (the skill reads/writes there).
2. Create a **`TICKET_PROMPT.md`** describing what you're supporting (product context, ticket categories, and the kinds of users who file tickets). This is the creative half of the prompt. The engine-enforced output requirements (JSON schema, per-batch counts, allowed statuses, staff rules) are appended automatically at generation time. If the file is missing, the skill scaffolds a starter from `templates/TICKET_PROMPT.md` and stops so you can edit it.
3. Invoke the skill by typing **`/qbort:generate-tickets`**. Asking in natural language ("generate some fake support tickets") does *not* trigger it: the skill sets `disable-model-invocation: true`, which keeps its description out of every session's startup context at the cost of only firing when you name it.
4. Answer the short **settings Q&A**: ticket count, whether to include staff reply threads (and the average per ticket), staff-roster size, and how far back to spread ticket open times. Every answer is re-clamped to safe ranges.
5. The skill generates in parallel batches and writes **`.qbort-run/tickets.json`**.

`.qbort-run/` is scratch (run state, per-batch prompts and outputs, the final file). Add it to `.gitignore` if you don't want it tracked.

## What you get

`tickets.json` matches the Qbort ticket shape: `{ meta, tickets: [{ id, subject, status, messages: [{ from, body, isStaff, createdAt }] }] }`. The engine assigns the `id` (sequential), `isStaff` (staff = `@company.biz` domain; the opener is always the customer), and `createdAt` (ascending by id, strictly increasing within a ticket, never in the future).

Its `meta.provider` is `claude-skill` and it has no `usage` block, because ambient generation isn't a metered API call and produces no token or cost numbers. That block is optional in the format, so a file without it is still valid.

## How it works

```
skill (SKILL.md drives Claude):
  ├─ ensure TICKET_PROMPT.md            (scaffold + stop if missing)
  ├─ settings Q&A                       (AskUserQuestion; re-clamped by the engine)
  ├─ engine.mjs plan                    (roster, opening times, scenario prompt, run-context.json)
  ├─ one subagent writes scenarios.json (a one-line scenario per ticket, plus a reserve)
  ├─ engine.mjs batches                 (validate + shuffle the scenarios, deal them into batch prompts)
  ├─ fan out one subagent per batch     (parallel; each writes its raw JSON to a batch file)
  ├─ engine.mjs assemble                (validate/repair, assign id/role/timestamps, cap, write tickets.json)
  └─ top-up rounds while short          (engine.mjs topup + assemble, up to 3 extra rounds)
```

The engine owns the deterministic/error-handling spine (validation and repair, over-delivery capping, sequential ids, timestamp synthesis, top-up accounting); the subagents only produce content. A failed or garbled batch is treated as empty and the top-up loop makes up the shortfall. Runs are not reproducible and don't try to be: ticket content and the scenario list both come from the model, so a seeded engine could only ever reproduce the scaffolding around tickets that themselves differ every time. The engine's own random choices (opening times, per-ticket reply targets, scenario deal order) use `Math.random`.

The scenario pass exists because batch prompts are otherwise byte-identical, so independent batches converge on the same handful of topics. One call sees the whole list while writing it (so it self-diversifies) and is asked for ~30% more scenarios than there are tickets (so it has to invent past the examples in `TICKET_PROMPT.md`). The surplus is the reserve top-up rounds draw from. If the scenario call fails or returns fewer scenarios than there are tickets, `batches` exits non-zero and the run stops rather than silently producing duplicate-heavy output at full cost.

`engine.mjs` is orchestration only. Everything it decides (settings bounds, roster generation, opening times, prompt compilation, validation and repair, the tickets-file format) lives one directory up in `plugin/lib/`, as dependency-free ESM that runs on bare `node`. That is the single copy of the logic and the code the repo's test suite points at. `assemble` runs its own finished file back through `lib/ticketFile.mjs` before writing it, so the producer can't quietly drift away from the format a viewer expects.

## Files

```
SKILL.md                 instructions Claude follows (not human docs)
engine.mjs               CLI: plan | batches | topup | assemble
templates/TICKET_PROMPT.md   starter prompt, scaffolded when you have none
../../lib/               the logic (args, fsUtil, constants, settings, staff, time,
                         promptCompiler, validate, ticketFile, types)
```

## Caveats

- **500 tickets per run (hard cap).** The engine clamps `--count` to 500. The whole scenario list is written by one subagent in one response, and much past that a single response stops being reliable. A short list fails the run at `batches` rather than silently producing duplicate-heavy tickets. For more than 500, do several runs; each gets its own independent scenario list.
- **Cost/scale.** Each finished batch's content round-trips back through Claude's context at assemble time, so large runs (many hundreds+) get token-heavy. Start small.
- **Cross-batch duplication.** Each batch is generated by an independent subagent that can't see the others, so a run spread across multiple batches used to produce near-duplicate tickets. The scenario pass is the fix: every ticket gets its own scenario off one globally-visible list, so no two batches can be handed the same topic. It bounds *what* tickets are about, not how they're written, so two tickets on genuinely adjacent scenarios can still read alike. `--batch-size` (default 20) remains a secondary lever, since a run that fits in one batch is generated with full visibility.
- **No custom roster.** The staff roster is auto-generated from the roster-size answer; names aren't collected in the Q&A.
