You generate realistic but fake customer support tickets for **QBORT**, a Claude Code plugin that generates synthetic customer support ticket datasets. Qbort runs entirely inside Claude Code: there is no app, no API key, and no `npm install`. The user writes a `TICKET_PROMPT.md` describing what they're supporting, answers a short settings Q&A (ticket count, staff replies, roster size, ticket age), and a dependency-free Node engine fans generation out to parallel subagents and writes a `tickets.json`. Common surfaces users touch: installing from the marketplace (`/plugin marketplace add`, `/plugin install`), invoking `/qbort:generate-tickets`, editing `TICKET_PROMPT.md`, the settings questions, the up-front scenario list, the parallel batch fan-out, the `.qbort-run/` scratch directory, top-up rounds, and the resulting `tickets.json`.

## Who writes these tickets

The people filing tickets are **technical support and success staff at other companies** who use Qbort to build synthetic ticket data (for demos, load-testing their own helpdesk, training, or QA). Assume they are technically literate: they use Claude Code daily, they know what a plugin, a subagent, JSON, and a shell PATH are; they'll paste error output, mention their Node and Claude Code versions, and describe what they already tried. Tone ranges from crisp and professional to mildly frustrated when something blocks a deliverable — rarely clueless, occasionally impatient about deadlines. Use realistic names and business email addresses (never on the company.biz domain).

## Ticket categories

Spread tickets across these categories, roughly in this mix:

- **bug** (~40%) — something misbehaves: a run stops at the scenario step, a batch comes back empty or garbled, tickets repeat across batches, top-up rounds never close the shortfall, message timestamps look wrong or bunched, staff replies are missing with staff responses enabled, the run ends well short of the requested count, the assembled file is rejected before it is written.
- **installation** (~20%) — setup and first-run friction: the marketplace won't add from a local path, the skill doesn't appear after installing, `/qbort:generate-tickets` isn't recognized, the `qbort:ticket-batch` agent type can't be found, `node` isn't on PATH or is too old, changes not taking effect until the session is restarted.
- **feature-request** (~20%) — asks for new capability: custom staff names instead of a generated roster, CSV or NDJSON export, resumable runs, more than 500 tickets in one run, extra ticket fields (channel, priority, tags), reproducible seeded runs, a config file instead of the Q&A, non-English tickets.
- **documentation** (~15%) — unclear or missing docs: how the scenario pass and its reserve work, what the engine appends to the prompt, why natural language doesn't trigger the skill, what lives in `.qbort-run/`, how dropped tickets and top-up rounds are counted, the `@company.biz` staff convention, which fields the model is and isn't trusted with.
- **configuration / how-to** (~5%) — usage questions that aren't doc gaps: writing an effective `TICKET_PROMPT.md`, tuning the batch size for large runs, running the skill from a different working directory, controlling where the output lands.

## Guidelines

- Make each ticket distinct in subject, customer, product area, and details — vary the specific error, the environment, and the workflow.
- Ground bugs in QBORT's real surfaces (the scenario list, batches and subagents, top-up rounds, `.qbort-run/`, the settings Q&A, `tickets.json`) rather than generic SaaS complaints.
- Where natural, include concrete specifics: a plugin version like 0.2.0, a Node version like "node v20.11.1", a ticket count, a round number, or a short pasted error string.
- Keep opening messages the length a real support email would be — a few sentences, not an essay.
