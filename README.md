# Qbort

A [Claude Code](https://docs.anthropic.com/en/docs/claude-code) plugin that generates realistic, **fake customer support tickets**, driven by a prompt file you write and a handful of numeric settings. It's useful for seeding demos, testing helpdesk automations, or producing sample data without touching real customer information.

There's no app to install, no API key, and no `npm install`. Ticket content is written within your local installation of Claude Code (through parallel subagents). A small, dependency-free Node engine owns everything structural (batching, validation and repair, sequential ids, staff/customer roles, and synthesized timestamps) and writes a `tickets.json` file.

**Highlights**

- Install as a plugin, invoke with `/qbort:generate-tickets`, answer four questions, get a file.
- The creative half of the prompt is **yours**: a `TICKET_PROMPT.md` file in your working directory describing your product, your ticket categories, and the people who file tickets.
- Every ticket gets its own one-line scenario off a globally-visible list, so batches can't converge on the same handful of topics.
- Output is a single `tickets.json` file with full conversation threads (`{ id, subject, status, messages: [...] }`).

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
2. Type `/qbort:generate-tickets`.

Asking in natural language ("generate some fake support tickets") does **not** trigger it. The skill sets `disable-model-invocation: true`, which keeps its description out of every session's startup context at the cost of only firing when you name it.

### The prompt file

If there's no **`TICKET_PROMPT.md`** file in your working directory, the first run scaffolds a starter one and generates from it, so you can see what the pipeline produces without writing anything first. The starter is generic, though, so edit it and run again to get tickets about your own product. This file is the creative and distribution half of the prompt: what your product is, who files tickets about it, the ticket categories and roughly what share of tickets each should get, the tone, and anything else that shapes the content.

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

The run opens with a single call that writes a list of one-line ticket scenarios (about 30% more than you asked for), which is then shuffled and dealt one per ticket. Then batches fan out in parallel, each written by its own subagent, and the engine validates, repairs, and assembles what comes back into a timestamped file under `qbort-output/`. If validation drops tickets, up to 3 top-up rounds regenerate just the shortfall, drawing fresh scenarios from the surplus. Every round rewrites the same file, so a run leaves exactly one behind however many rounds it takes.

A run uses two directories in your working directory, and adding both to your `.gitignore` file is usually what you want:

- **`.qbort-run/`** is scratch: run state, the per-batch prompts, and the raw subagent output. It is **wiped at the start of every run**, so don't keep anything there. The wipe is deliberate: the batch files sit at fixed names that subagents write, so a leftover file from an earlier run would otherwise be folded into the new output as though it were fresh.
- **`qbort-output/`** holds the finished tickets files, and is never wiped. Earlier runs stay where they are.

**Why a run is capped at 500 tickets.** Batches are written by separate subagents that can't see each other. Left alone, they converge on the same obvious topics and produce near-duplicate tickets, which is what the scenario list prevents. That list has to come back in a single response, and much past 500 one-liners a single response stops being reliable, so a short list fails the run rather than quietly producing duplicates at full cost. If you need more than 500, do several runs: each gets its own independent scenario list.

---

## Output format

One file per run at `qbort-output/tickets-YYYYMMDD-HHMMSS.json` (the skill tells you the exact path when it finishes), shaped like this:

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

Every message in a ticket, including the customer's opening message, lives in a single ordered `messages[]` array, oldest first. The engine assigns the `id` (sequential integer), `isStaff` (staff = the `@company.biz` domain; the opener is always the customer), and `createdAt` (ascending by id, strictly increasing within a ticket, never in the future). `status` is one of `new`, `open`, `pending`, `on-hold`, `solved`, `closed`. The model is never trusted with any of that.

The file is just JSON, so `jq` it, load it into your own fixtures, or open it in a viewer that reads the format.

---

## MCP Server

In addition to the Claude Code plugin skill, Qbort includes a standalone **Model Context Protocol (MCP)** server (`plugin/mcp/server.mjs`). This allows any MCP-capable host (Claude Desktop, Cursor, Windsurf, Antigravity, or Claude Code via MCP) to plan, generate, inspect, and analyze ticket datasets with zero external runtime dependencies on bare Node.js 20+.

### Client configuration

**Claude Code plugin:** Installing the plugin registers the MCP server automatically via `plugin/.mcp.json`.

**Cursor / Windsurf (`.mcp.json` or `.cursor/mcp.json`):**
```json
{
  "mcpServers": {
    "qbort": {
      "command": "node",
      "args": ["./plugin/mcp/server.mjs"]
    }
  }
}
```

**Claude Desktop (`claude_desktop_config.json`):**
```json
{
  "mcpServers": {
    "qbort": {
      "command": "node",
      "args": ["<path-to-qbort>/plugin/mcp/server.mjs"]
    }
  }
}
```

### Tools

- `scaffold_ticket_prompt`: Creates starter `TICKET_PROMPT.md` in the working directory if one does not exist yet.
- `plan_ticket_run`: Wipes scratch, clamps settings, creates staff roster, draws opening times, and compiles scenario prompt.
- `build_ticket_batches`: Validates and shuffles scenarios, deals one scenario per ticket, and compiles per-batch prompts.
- `assemble_tickets`: Validates and repairs tickets, assigns sequential IDs and synthesized timestamps, and writes `qbort-output/tickets-*.json`.
- `prepare_topup`: Prepares top-up batches drawing from the scenario reserve if validation drops any tickets.
- `list_ticket_runs`: Lists all generated ticket runs in `qbort-output/` with summary metadata.
- `get_run_stats`: Calculates breakdown by status, message counts, staff replies, and date span.
- `view_tickets`: Searches, filters by status or ID range, and paginates tickets from a run.
- `get_ticket`: Retrieves the complete message thread for a single ticket ID.

### Resources & Prompts

- **Resources:** `qbort://template/ticket-prompt` (starter prompt template), `qbort://runs/latest` (latest run output JSON), and `qbort://runs/latest/stats` (latest run statistics).
- **Prompts:** `generate-tickets` (guided ticket generation workflow) and `review-tickets` (guided review and quality analysis of generated datasets).

---

## Contributing


Contributions are welcome, but please note:

> **Open an Issue before opening a Pull Request.** Discuss the bug or feature in a GitHub Issue first so we can agree on the approach. **PRs without an associated Issue will be closed without review.**

To work on the plugin locally, clone the repo, `npm install` (dev dependencies only, vitest and typescript), and add the checkout as a local marketplace: `/plugin marketplace add ~/projects/qbort` then `/plugin install qbort@qbort`. The skill deliberately lives in `plugin/skills/`, not `.claude/skills/`, so a checkout doesn't shadow the installed copy. `AGENTS.md` has the development loop and the behavior rules worth knowing before you change anything. Before submitting, please make sure `npm run typecheck` and `npm test` pass.

A checkout also gets `scripts/view-tickets.mjs`, a terminal reader for a run's output (`node scripts/view-tickets.mjs --stats`, then `--id 7` for one thread or `--page 2` for the next page of the list). It defaults to the newest file in `qbort-output/` and paginates, so a several-hundred-ticket run is safe to point it at. It's a repo-local dev tool and isn't part of the installed plugin.

---

## License

[MIT](LICENSE)
