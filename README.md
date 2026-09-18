# Qbort

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that generates realistic, **fake customer-support tickets**, driven by a prompt file you write and a handful of numeric settings. It's useful for seeding demos, load-testing a helpdesk UI, or producing sample data without touching real customer information.

There's no app to install, no API key, and no `npm install`. Ticket content is written by the Claude you're already talking to (through parallel subagents). A small, dependency-free Node engine owns everything structural (batching, validation and repair, sequential ids, staff/customer roles, and synthesized timestamps) and writes a `tickets.json`.

**Highlights**

- Install as a plugin, invoke with `/qbort:generate-tickets`, answer four questions, get a file.
- The creative half of the prompt is **yours**: a `TICKET_PROMPT.md` in your working directory describing your product, your categories, and the people who file tickets.
- Every ticket gets its own one-line scenario off a globally-visible list, so batches can't converge on the same handful of topics.
- Output is a self-describing `tickets.json` with full conversation threads (`{ id, subject, status, messages: [...] }`).

---

## Requirements

- **Claude Code**: the plugin runs inside it.
- **Node.js 20+** on your `PATH` (`node --version`). No `npm install`: the engine is dependency-free ESM.

## Install

```
/plugin marketplace add balevine/qbort
/plugin install qbort@qbort
```

That registers the `generate-tickets` skill and the restricted `ticket-batch` agent it spawns for each batch.

---

## Usage

1. `cd` into the directory where you want the output. The plugin reads and writes there.
2. Type **`/qbort:generate-tickets`**.

Asking in natural language ("generate some fake support tickets") does **not** trigger it. The skill sets `disable-model-invocation: true`, which keeps its description out of every session's startup context at the cost of only firing when you name it.

### The prompt file

The first run scaffolds a starter **`TICKET_PROMPT.md`** into your working directory and stops, so you can edit it before spending a run. This file is the creative and distribution half of the prompt: what your product is, who files tickets about it, the categories and roughly what share of tickets each should get, the tone, and anything else that shapes the content.

The engine appends its own output requirements below a clear delimiter: the exact JSON shape, the per-batch count, the allowed statuses, the staff roster, and the per-ticket reply targets. Your text is never overridden. Every compiled prompt is a plain file at `.qbort-run/prompt-<round>-<batch>.txt` if you want to read exactly what a subagent was sent.

### The settings Q&A

| Setting | Default | Range | What it does |
|---|---|---|---|
| **Number of tickets** | 100 | 1 – 500 | How many tickets to generate in a run. |
| **Include staff responses** | off | n/a | When off, each ticket has only the customer's opening message. |
| **Average staff responses** | 0 | 0 – 20 | Mean replies per ticket; the actual count is a Poisson draw around it. |
| **Number of staff members** | 10 | 1 – 100 | Size of the staff roster used to author replies. |
| **Max ticket age (days)** | 90 | 1 – 3650 | How far back ticket open times are spread. Each ticket opens somewhere in this window, with replies following later. |

Every answer, including a free-typed one, is re-clamped into range before it reaches the engine, so an out-of-range value is impossible rather than merely discouraged.

**Staff roster.** The roster is generated from the count you give: each member is a `Firstname Lastname` with a derived `firstname.lastname@company.biz` email. That fixed domain is how staff messages are told apart from customer ones. Custom names aren't collected.

### What happens during a run

The run opens with a single call that writes a list of one-line ticket scenarios (about 30% more than you asked for), which is then shuffled and dealt one per ticket. Then batches fan out in parallel, each written by its own subagent, and the engine validates, repairs, and assembles what comes back into `.qbort-run/tickets.json`. If validation drops tickets, up to 3 top-up rounds regenerate just the shortfall, drawing fresh scenarios from the surplus.

`.qbort-run/` is scratch: run state, the per-batch prompts, the raw subagent output, and the final file. Add it to your `.gitignore` if you don't want it tracked.

**Why a run is capped at 500 tickets.** Batches are written by separate subagents that can't see each other. Left alone, they converge on the same obvious topics and produce near-duplicate tickets, which is what the scenario list prevents. That list has to come back in a single response, and much past 500 one-liners a single response stops being reliable, so a short list fails the run rather than quietly producing duplicates at full cost. If you need more than 500, do several runs: each gets its own independent scenario list.

---

## What you get

`.qbort-run/tickets.json`, shaped like this:

```jsonc
{
  "meta": {
    "generatedAt": "2026-06-30T12:00:00.000Z",
    "provider": "claude-skill",
    "model": "Claude Code subagents",
    "requestedCount": 100,
    "generatedCount": 98,
    "rounds": 2
  },
  "tickets": [
    {
      "id": 1,
      "subject": "Can't log in after password reset",
      "status": "open",
      "messages": [
        { "from": { "name": "Sarah Kim", "email": "sarah.kim@fake.techcorp.com" },
          "body": "...", "isStaff": false, "createdAt": "2026-06-28T09:14:00.000Z" },
        { "from": { "name": "Avery Adams", "email": "avery.adams@company.biz" },
          "body": "...", "isStaff": true, "createdAt": "2026-06-28T15:42:00.000Z" }
      ]
    }
  ]
}
```

Every message in a ticket, including the customer's opening one, lives in a single ordered `messages[]` array, oldest first. The engine assigns the `id` (sequential integer), `isStaff` (staff = the `@company.biz` domain; the opener is always the customer), and `createdAt` (ascending by id, strictly increasing within a ticket, never in the future). `status` is one of `new`, `open`, `pending`, `on-hold`, `solved`, `closed`. The model is never trusted with any of that.

There's no token or cost breakdown (`meta.usage` is absent), because ambient generation isn't a metered API call and produces no token or cost numbers. The block is optional in the format, so a file without it is still valid.

The file is just JSON, so `jq` it, load it into your own fixtures, or open it in a viewer that reads the format.

---

## Contributing

Contributions are welcome, but please note:

> **Open an Issue before opening a Pull Request.** Discuss the bug or feature in a GitHub Issue first so we can agree on the approach. **PRs without an associated Issue will be closed without review.**

To work on the plugin locally, clone the repo, `npm install` (dev dependencies only, vitest and typescript), and add the checkout as a local marketplace: `/plugin marketplace add ~/projects/qbort` then `/plugin install qbort@qbort`. The skill deliberately lives in `plugin/skills/`, not `.claude/skills/`, so a checkout doesn't shadow the installed copy. `AGENTS.md` has the development loop and the behavior rules worth knowing before you change anything. Before submitting, please make sure `npm run typecheck` and `npm test` pass.

**Previously a desktop app.** Qbort used to be a local-first Electron app with Anthropic and Ollama providers, keychain-stored API keys, and a built-in viewer. That app has been removed and there are no more `.dmg` releases. The `tickets.json` format is unchanged, so files generated by the old app still load anywhere they did before.

---

## License

[MIT](LICENSE)
