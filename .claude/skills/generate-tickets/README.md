# generate-tickets (Claude Code skill)

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) skill that generates fake customer-support tickets and writes them to a `tickets.json`. It's a headless re-imagining of the [Qbort](../../../README.md) desktop app: instead of calling a hosted/local LLM API, it uses the **ambient Claude model** (via parallel subagents) to produce ticket content, while a small, dependency-free Node engine owns everything structural.

This is a developer/Claude-Code tool, not the desktop app. If you want a GUI with a keychain, providers, and a cost estimate, use the app. If you're already in Claude Code and want a tickets dataset from a prompt file plus a few questions, use this.

## Requirements

- **Claude Code** (the skill runs inside it).
- **Node.js** on your `PATH` (`node --version`). No `npm install` — the engine is dependency-free ESM.

## Install

- **Project-scoped** (this repo): it already lives at `.claude/skills/generate-tickets/`.
- **Global** (any project on your machine): copy the whole folder to `~/.claude/skills/generate-tickets/`.

Optionally also copy `.claude/agents/ticket-batch.md` alongside it (to `~/.claude/agents/` for a global install). That's the restricted `Read`/`Write`-only agent the skill prefers for batch generation, which keeps batch subagents from shelling out to verify their own output. It's not required — without it the skill falls back to the general-purpose agent and instructs it not to self-verify.

## Usage

1. `cd` into the directory where you want the output (the skill reads/writes there).
2. Create a **`TICKET_PROMPT.md`** describing what you're supporting (product context, ticket categories, and the kinds of users who file tickets). This is the creative half of the prompt; the app-enforced output requirements (JSON schema, per-batch counts, allowed statuses, staff rules) are appended automatically at generation time. If the file is missing, the skill scaffolds a starter from `templates/TICKET_PROMPT.md` and stops so you can edit it.
3. Invoke the skill — type **`/generate-tickets`**, or just ask (e.g. "generate some fake support tickets").
4. Answer the short **settings Q&A**: ticket count, whether to include staff reply threads (and the average per ticket), staff-roster size, and how far back to spread ticket open times. Every answer is re-clamped to safe ranges.
5. The skill generates in parallel batches and writes **`.qbort-run/tickets.json`**.

`.qbort-run/` is scratch (run state, per-batch prompts and outputs, the final file). Add it to `.gitignore` if you don't want it tracked.

## What you get

`tickets.json` matches the Qbort ticket shape: `{ meta, tickets: [{ id, subject, status, messages: [{ from, body, isStaff, createdAt }] }] }`. The engine assigns the `id` (sequential), `isStaff` (staff = `@company.biz` domain; the opener is always the customer), and `createdAt` (ascending by id, strictly increasing within a ticket, never in the future).

The file loads directly into the **Qbort desktop app** via **LOAD TICKETS**: its `meta.provider` is `claude-skill` and it has no `usage` block (ambient generation has no token/cost accounting), which the app tolerates. The viewer shows `—` for the token/cost stats.

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

The engine owns the deterministic/error-handling spine (validation and repair, over-delivery capping, sequential ids, timestamp synthesis, top-up accounting); the subagents only produce content. A failed or garbled batch is treated as empty and the top-up loop makes up the shortfall. Runs are deterministic given the seed printed by `plan` (pass `--seed <n>` to reproduce one).

The scenario pass exists because batch prompts are otherwise byte-identical, so independent batches converge on the same handful of topics. One call sees the whole list while writing it (so it self-diversifies) and is asked for ~30% more scenarios than there are tickets (so it has to invent past the examples in `TICKET_PROMPT.md`). The surplus is the reserve top-up rounds draw from. If the scenario call fails or returns fewer scenarios than there are tickets, `batches` exits non-zero and the run stops rather than silently producing duplicate-heavy output at full cost.

Most of the pure logic in `lib/` is ported from the app's `src/shared` and `src/main/generation` (`staff`, `time`, `promptCompiler`, `validate`, settings clamping), with zod's parse-and-repair replaced by equivalent plain-JS guards.

## Files

```
SKILL.md                 instructions Claude follows (not human docs)
engine.mjs               CLI: plan | batches | topup | assemble
lib/                     ported pure logic (constants, settings, staff, time, promptCompiler, validate, rng)
templates/TICKET_PROMPT.md   starter prompt, scaffolded when you have none
```

## Caveats

- **500 tickets per run (hard cap).** The engine clamps `--count` to 500. The whole scenario list is written by one subagent in one response, and much past that a single response stops being reliable — a short list fails the run at `batches` rather than silently producing duplicate-heavy tickets. For more than 500, do several runs; each gets its own independent scenario list.
- **Cost/scale.** Each finished batch's content round-trips back through Claude's context at assemble time, so large runs (many hundreds+) get token-heavy. Start small.
- **Cross-batch duplication.** Each batch is generated by an independent subagent that can't see the others, so a run spread across multiple batches used to produce near-duplicate tickets. The scenario pass is the fix: every ticket gets its own scenario off one globally-visible list, so no two batches can be handed the same topic. It bounds *what* tickets are about, not how they're written, so two tickets on genuinely adjacent scenarios can still read alike. `--batch-size` (default 20) remains a secondary lever, since a run that fits in one batch is generated with full visibility.
- **No custom roster.** The staff roster is auto-generated from the roster-size answer; names aren't collected in the Q&A.
