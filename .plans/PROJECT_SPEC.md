# Qbort — Project Spec

A local-first Electron desktop app that generates fake customer-support tickets with an LLM, based on user-controlled settings and an editable prompt. The app runs entirely locally and only reaches out to an external LLM provider when generating ticket data. Generated tickets are written to a JSON file the user can view in-app and export.

> Prior art: this re-implements, as a desktop app, the batched LLM generation approach from `~/dashbort/script/sandbox` (`sandbox_prompt.rb`, `generate_sandbox_conversations.rb`, `config/sandbox_distributions.json`). We keep the *technique* (batched async generation, JSON output, distribution-driven prompts) but use a deliberately simpler output schema and a minimal starter prompt.

---

## 1. Goals & non-goals

### Goals
- Desktop app (macOS first; Windows/Linux capable via Electron) that generates fake tickets.
- LLM-backed generation driven by **numeric settings + an editable prompt**.
- Support hosted + local providers. **Currently: Anthropic (Claude)** and **Ollama (local)**; **OpenAI** and **Google Gemini** are planned for a future release.
- The app **auto-selects the best model** for hosted providers; the user only picks a model for **local Ollama**.
- Output written to a **JSON file** the user can export and reuse.
- In-app **viewer** that loads tickets from the JSON file when one exists.
- **Local-only** operation except for the LLM call itself.
- **API keys stored in the OS keychain**, never in plaintext config and never exposed to the renderer.

### Non-goals (initial release)
- No cloud sync, accounts, or telemetry.
- No editing/curation of generated tickets in-app (view + export only).
- No multi-window or multi-project management.
- Importing real ticket data (out of scope; generation only).

---

## 2. Output ticket schema

A conversation-thread shape: every message — including the customer's opening one — lives in a single ordered `messages[]` array. This matches how ticketing/email systems store threads and makes the export easy to consume elsewhere. This is the contract the app writes and the viewer renders (the LLM produces a looser shape that the app reshapes — see below).

```jsonc
// tickets.json
{
  "meta": {
    "generatedAt": "2026-06-30T12:00:00Z",
    "appVersion": "0.1.0",
    "provider": "anthropic",
    "model": "claude-sonnet-5",
    "requestedCount": 100,
    "generatedCount": 100,
    "settings": { /* snapshot of settings used (no secrets) */ },
    "usage": {
      "inputTokens": 412300,
      "outputTokens": 988100,
      "totalTokens": 1400400,
      "batches": 5,
      "estimatedCostUsd": 14.97,    // pre-run estimate shown to the user
      "actualCostUsd": 15.42,       // computed from real token usage + pricing table
      "pricing": { "inputPerM": 3.0, "outputPerM": 15.0, "currency": "USD" },
      "durationMs": 73210
    }
  },
  "tickets": [
    {
      "id": 1,                      // sequential integer, assigned by the app
      "subject": "Can't log in after password reset",
      "status": "open",
      "messages": [
        {
          "from": { "name": "Sarah Kim", "email": "sarah.kim@fake.techcorp.com" },
          "body": "Customer's full opening message...",
          "isStaff": false,
          "createdAt": "2026-06-28T09:14:00.000Z"
        },
        {
          "from": { "name": "Mike Rodriguez", "email": "mike.rodriguez@company.biz" },
          "body": "Staff reply text...",
          "isStaff": true,
          "createdAt": "2026-06-28T15:42:00.000Z"
        }
      ]
    }
  ]
}
```

Schema notes:
- `id` — sequential **integer** (1, 2, 3…), assigned by the app, not trusted from the LLM.
- `status` — string from a small default set (`new`, `open`, `pending`, `on-hold`, `solved`, `closed`). The set is a constant the user can influence via the prompt; the app validates against the allowed set and falls back to `open` if invalid.
- `messages[]` — the full thread, oldest first. `messages[0]` is the customer's opening message; the rest are follow-ups, driven by the staff settings (see §3).
  - `isStaff` — assigned by the app (staff = `@company.biz` domain), so consumers don't have to re-derive role from the email. **The opening message (`messages[0]`) is always `isStaff: false`** regardless of its email domain — it is the customer's by definition, and the app never trusts the model to set role.
  - `createdAt` — an app-synthesized ISO-8601 timestamp. The app assigns realistic times: opening times are drawn across the configured **max ticket age** window (§3) and **handed out in id order, so ascending `id` ⇒ ascending ticket open time** (mirroring how real ticketing systems number tickets by creation order). Within a ticket, replies follow minutes-to-hours later and the sequence is **strictly increasing** (when little room remains before "now" the gaps are compressed to at least 1ms rather than piling messages onto the same instant), never in the future. Reply times may still interleave *across* tickets (ticket #6 can open before ticket #5's reply lands). The LLM is not trusted with timestamps.
  - **Recently-opened tickets have no replies yet.** A ticket whose opening time falls within a short recent window (~15 minutes of "now") keeps only its opening message even if the model produced replies — mirroring a real queue where staff haven't had time to respond, and structurally preventing reply timestamps from bunching against "now" for the newest tickets.
- Everything else (categories, sentiment, channel, custom fields) is intentionally **omitted**; if the user wants those to influence content, they express them in the editable prompt — they shape the generated `subject`/`body`, not extra fields.

Validation is enforced with **zod** in the main process against the LLM's raw output (opening `body`/`from` + `responses[]`); the app repairs where safe, drops what it can't, caps each batch to the requested count (a model that over-delivers can't push ids past the pre-computed opening-time window), then reshapes each ticket into the `messages[]` form above, assigning `id`, `isStaff`, and `createdAt`. Because dropped/failed tickets leave the kept count short of the request, the orchestrator **tops up**: after the initial pass it re-counts and generates just the shortfall (re-validating only the new tickets), repeating for up to `MAX_TOPUP_ROUNDS` (3) rounds or until the requested count is reached — see §12.

---

## 3. Settings

Persisted locally (non-sensitive) in `settings.json` under Electron `userData`. Rendered as numeric inputs paired with sliders where a bounded range exists.

| Setting | Control | Default | Min | Max | Notes |
|---|---|---|---|---|---|
| Number of tickets | slider + number | 100 | 1 | 5000 | Hard cap 5000. |
| Average number of staff responses | slider + number | 0 | 0 | 20 | Mean responses/ticket; actual count varies around this. |
| Include staff responses? | toggle | false | — | — | When false, a ticket has only its opening message regardless of the average. |
| Number of staff members | slider + number | 10 | 1 | 100 | Drives the number of rows in the staff roster editor (below). |
| Max ticket age (days) | slider + number | 90 | 1 | 3650 | Window over which synthesized message `createdAt` timestamps are spread (§2). |

Plus a **staff roster editor** (not a slider): an editable list of staff members, each row a `name` + `alias` pair. The email is **derived**, not entered: `${alias}@company.biz`. All staff share the fixed `company.biz` domain; only name and alias are editable.

```ts
type StaffMember = { name: string; alias: string }   // email = `${alias}@company.biz`
```

Behavior:
- **Default roster**: the app ships with a built-in default set of staff members (e.g. ~7–10 named agents with `firstname.lastname` aliases on `company.biz`), so the roster is never empty out of the box.
- **User-editable**: the roster is the source of truth for response authors. Changing **Number of staff members** resizes it — growing appends pre-filled generated rows (`Firstname Lastname` + `firstname.lastname` alias); shrinking trims from the end. Names and aliases are editable; rows can be added/removed directly (which keeps the count in sync). Aliases are normalized/validated (lowercased, no spaces, unique) so derived emails are well-formed.
- **Auto-generate before a run**: at the start of generation, if the roster is empty (or the user has cleared it), the app auto-generates a roster of **Number of staff members** entries before producing any ticket messages. The roster (names + derived `@company.biz` emails) is persisted in `settings.json`, injected into the compiled prompt, and reused across all batches so authors stay consistent.
- **Response distribution**: per ticket, draw a response count from a distribution centered on the average (e.g., Poisson(avg), clamped ≥ 0). This count + roster is injected into the prompt instructions for that batch so the LLM produces matching `responses`.
- If **Include staff responses = false**, the compiled prompt instructs zero staff replies and the validator strips any `responses` the model returns anyway.

Other config that lives in **settings.json** (not the keychain):
- Active provider id — **defaults to `ollama`** (local) so the app works out of the box for local testing with no API key; the user can switch to a hosted provider in the settings modal.
- Ollama host + selected model.
- Editable prompt text.
- Staff roster (name/email pairs).
- **Default JSON directory** — the folder where generated ticket files are saved and from which the app auto-loads on launch. User-settable in the settings modal (folder picker); defaults to `userData` if unset.
- Last-used output file path.

---

## 4. Editable prompt

- A large text editor in the UI holds the **creative + distribution** half of the prompt: ticket categories, category percentages, sentiment ratios, tone, domain/product context, etc.
- Ships with a **minimal starter prompt** (a few example categories and a short instruction), not the full dashbort distribution set. The user grows it themselves.
- The app **compiles** the final prompt at generation time:

  ```
  [user editable prompt]
  + [app-injected hard requirements]
      - exact batch count to produce
      - output JSON schema + "return only JSON" instruction
      - staff roster (names/emails) — only if include staff responses
      - per-ticket response count guidance — only if include staff responses
      - allowed status values
  ```

- `promptCompiler.ts` owns this composition. A **"Preview compiled prompt"** affordance shows the user exactly what gets sent. The user's text is never silently overridden — app requirements are appended and clearly delimited.

---

## 5. LLM providers

> **Current scope:** only **Anthropic** and **Ollama** are implemented. OpenAI and Gemini are deferred to a future release (the abstraction below is designed to accommodate them, but no adapters/model entries exist for them yet). The rest of this section documents the full vision.

### Provider abstraction (`src/main/generation/providers/`)
```ts
interface LLMProvider {
  id: 'anthropic' | 'ollama'         // 'openai' | 'gemini' planned later
  generateBatch(args: {
    compiledPrompt: string
    count: number
    signal: AbortSignal
  }): Promise<RawTicket[]>            // parsed JSON, pre-validation
  listModels?(): Promise<string[]>   // Ollama only (GET /api/tags)
}
```

Implementations:
- **Anthropic** — Messages API via `fetch`; JSON enforced via the prompt; prompt caching on the static prefix of the compiled prompt to cut cost across batches; detects `stop_reason: "max_tokens"` and raises a retryable truncation error (§6).
- **Ollama** — `fetch` to local server (default `http://localhost:11434`); `format: json`; `listModels()` via `/api/tags`. NDJSON is parsed line-by-line **tolerantly** (a malformed/partial line is skipped, not fatal); an `error` field on a 200 stream and a `done_reason: "length"` truncation are both surfaced explicitly.
- **OpenAI / Gemini** *(deferred)* — will follow the same `fetch`-based pattern when added.

All provider calls happen **in the main process** (keeps keys out of the renderer, avoids CORS).

### Model auto-selection (`models.ts`)
- A **curated map** of the best *cost-balanced* model per hosted provider, centralized so it's a one-line update as new models ship. The user does **not** choose a model for hosted providers.
- **Philosophy:** synthetic, text-only ticket generation is high-volume and not reasoning-heavy, so we deliberately target **mid-tier models** that balance cost, speed, and quality rather than flagships. Flagship pricing/latency is not justified across the hundreds of batches a 5,000-ticket run requires.
- **Important (knowledge-cutoff caveat):** exact model IDs must be verified against each provider's *current* model list at implementation time. Initial targets:
  - Anthropic → **`claude-sonnet-5`** (current cost-balanced Sonnet workhorse; verified 2026-07). The Sonnet line went 4.5 → 4.6 → 5 (there is no Sonnet 4.7 — that's the Opus line).
  - OpenAI → current cost-balanced general model *(deferred — no adapter yet)*.
  - Gemini → current **Flash**-class model *(deferred — no adapter yet)*.
- **Ollama** is the only case where the user selects a model — populated from `listModels()`.
- A `pricing` table (input/output $ per 1M tokens) lives alongside the model map and feeds the cost estimate (§6) and the run usage breakdown (§2 `meta.usage`). Pricing must also be verified at build time.

### Provider configuration UI
- User picks the active provider. **Default: Ollama (local)** — chosen so the app runs without any API key for local development/testing; hosted providers are opt-in.
- For hosted providers: enter API key (stored in keychain). UI shows only whether a key is **set** (boolean), never the key value. A "Test connection" button does a tiny live call.
- For Ollama: enter host, click to fetch installed models, pick one.

---

## 6. Generation orchestration (`orchestrator.ts`)

Mirrors the Ruby batched-async approach:
- **Batching**: split `requestedCount` into batches (configurable `batchSize`, default ~20). Up to 5000 tickets → up to ~250 batches. The batch size is **adaptively reduced** when staff responses make each ticket large, so a batch's expected output stays within the model's token budget and doesn't get truncated mid-JSON (which would drop the whole batch). `max_tokens` is sized per batch from the expected output — using the **actual per-ticket response counts sampled for that batch** (their sum captures the Poisson tail a flat average misses), not a fixed constant.
- **Top-up rounds**: validation drops malformed tickets (and a hard batch failure keeps none), so a pass can end below `requestedCount`. The orchestrator re-counts the kept tickets and, if short, generates **exactly the shortfall** in a fresh set of batches — validating only those new tickets — repeating for up to `MAX_TOPUP_ROUNDS` (3) additional rounds or until the count is met. Each round requests only the shortfall and every batch is still capped to its own count, so the kept total never exceeds `requestedCount` and ids stay within the pre-computed opening-time window. A persistently failing/all-invalid model simply exhausts the 3 rounds and returns fewer than requested rather than looping forever.
- **Truncation handling**: providers detect a cut-off response (Anthropic `stop_reason: "max_tokens"`, Ollama `done_reason: "length"`) and raise a distinct, retryable **truncation error** instead of letting the truncated JSON fail a parse and drop the batch. The orchestrator responds by **growing `max_tokens`** on retry and, once at the ceiling, **splitting the batch in half** (recursively) so the smaller batches produce less output and fit — preserving the ticket count instead of dropping it.
- **Concurrency**: limited parallelism (e.g. `p-limit`, 3–5 concurrent) to respect rate limits.
- **Retry/backoff**: on `429`/rate-limit (and transient malformed output), exponential/linear backoff with max retries (as in the Ruby script). Retries are **not** issued after cancellation lands mid-backoff. Per-batch failures are isolated; partial success is kept.
- **Progress**: main streams progress events to renderer via `webContents.send` (`generation:progress`): batches done, tickets done, retries, errors, ETA.
- **Cancellation**: `AbortController`; a Cancel button aborts in-flight requests and stops scheduling new batches; tickets produced so far are still written.
- **ID assignment & validation**: after each batch, tickets are validated (zod), repaired or dropped, assigned sequential ids, and appended to the output.
- **Pre-run cost estimate (required gate)**: before every run, show an estimated token/cost breakdown — derived from `requestedCount`, batch size, an assumed avg input/output tokens per ticket (calibrated from a small sample or heuristic), and the provider `pricing` table — and require explicit confirmation to proceed. Ollama runs show "$0 (local)".
- **Usage tracking (completed runs)**: accumulate real input/output token counts reported by each provider's API response across all batches; compute `actualCostUsd` from the pricing table; record `inputTokens`, `outputTokens`, `totalTokens`, `batches`, `estimatedCostUsd`, `actualCostUsd`, `pricing`, and `durationMs` into `meta.usage` (§2). The viewer surfaces this breakdown for any loaded file.

Output is written incrementally/atomically so a crash mid-run still leaves a valid file (write to temp file, then rename).

---

## 7. Storage & viewer

### Storage (`storage.ts`)
- Generated files are written into the user's **Default JSON directory** (settings.json; defaults to `userData`).
- **Default location setting**: a folder picker in the settings modal controls where files are saved and from where the app auto-loads.
- **LOAD TICKETS**: a prominent button on the main page opens a native open dialog to load an arbitrary tickets JSON into the view (defaulting the dialog to the default directory).
- **Export**: native save dialog to copy/write the JSON anywhere.
- On launch, if a ticket file exists in the default directory (last-used preferred), load it into the view automatically.

### Viewer (renderer)
- **Paginated list**: a single scrollable list/table of tickets, **100 per page**, with page controls (first/prev/next/last + page indicator). Columns `id` (shown as `#N`), `subject`, `status`, the customer (`messages[0]`'s author), and the ticket's created time (`messages[0]`'s `createdAt`). Pagination (not virtualization) keeps the DOM light for 5000-ticket files.
- **Detail (conversation modal)**: each ticket row is clickable and **pops the full conversation into a modal** over the page. The thread renders `messages[]` in order — author name/email and `createdAt` shown per message. Messages are highlighted by role to separate the two sides:
  - **Customer messages** (`isStaff: false`): black text on a **white** background.
  - **Staff messages** (`isStaff: true`): black text on a **slate-grey** background.
  The modal stays within the neo-brutalist language (hard borders, square corners); slate-grey is the one permitted non-pure-monochrome surface, used only to distinguish staff replies.
- **Filter/search**: by status and free-text over subject + all message bodies/authors (applied before paging).
- **Summary**: counts by status, total tickets, provider/model, and the `meta.usage` cost/token breakdown for the loaded file. `meta.usage` is **optional** — files produced outside the app (e.g. by the Claude Code generate-tickets skill, which uses ambient-model subagents and has no token/cost accounting) omit it, and the summary shows `—` for those stats. Such files also carry `meta.provider: "claude-skill"`, rendered via a tolerant label (`ticketFileProviderLabel`) so the viewer accepts and displays them.

---

## 8. Security model

- **Keys in OS keychain — decided: Electron `safeStorage`.** It's the official, actively maintained Electron API; the app encrypts each key and the encryption key is held in the OS keychain (Keychain on macOS, libsecret on Linux, DPAPI on Windows). `keytar` was considered and rejected — it is archived/unmaintained and requires native rebuilds. `safeStorage` is both better-supported and at least as secure for this use. Encrypted blobs are stored under `userData`; the keychain protects the encryption key.
- Keys are **only** read in the main process at call time and **never** sent to the renderer. Renderer can request "store key for provider X" / "is a key set for X?" / "test connection", nothing more.
- **Renderer hardening**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; a strict `preload` exposing a minimal, typed `window.api` via `contextBridge`; a strict CSP applied to every renderer response via the main process (`session.webRequest.onHeadersReceived` in `src/main/index.ts`) rather than a `<meta>` tag in `index.html` — enforcing it at the header level is stronger and covers responses a meta tag can't. Production locks egress to `default-src 'self'` (no external `connect-src`, since all network calls happen in main), plus `object-src 'none'`, `base-uri 'none'`, `frame-src 'none'`, and `form-action 'none'` to close plugin/embedding/`<base>`/form-post vectors.
- **All network egress from main only**; renderer makes no external requests.
- **IPC input is validated in main**: provider ids from the renderer are checked against the allow-list before reaching the secret store or adapters, and numeric settings are re-clamped on every write. The **export** channel takes no path from the renderer — main tracks the currently-loaded file and exports that, so a buggy/compromised renderer can't turn export into an arbitrary-file read.

---

## 9. Tech stack & project structure

- **Scaffold**: `electron-vite` (Electron + Vite, TS).
- **UI**: React + TypeScript + Tailwind CSS + shadcn/ui.
- **Validation**: zod (shared schemas).
- **Concurrency**: `p-limit`.
- **Ticket list**: client-side pagination, 100 rows/page (no virtualization library needed).
- **Provider calls**: plain `fetch` (no vendor SDKs) — Anthropic Messages API and the local Ollama server. (OpenAI/Gemini adapters deferred.)
- **Tests**: Vitest for unit + integration (§13); optional Playwright Electron smoke test.
- **Packaging**: `electron-builder` (.dmg/.zip first) — later phase.

```
qbort/
├─ package.json
├─ electron.vite.config.ts
├─ tsconfig.json
├─ tailwind.config.js  ·  postcss.config.js
├─ src/
│  ├─ main/
│  │  ├─ index.ts                 # app lifecycle, BrowserWindow
│  │  ├─ ipc.ts                   # typed IPC handlers
│  │  ├─ secrets.ts               # safeStorage/keychain
│  │  ├─ settings.ts              # persisted non-secret config
│  │  ├─ storage.ts               # tickets JSON read/write/export/open
│  │  └─ generation/
│  │     ├─ orchestrator.ts       # batching, concurrency, progress, cancel
│  │     ├─ promptCompiler.ts     # editable prompt + injected requirements
│  │     ├─ validate.ts           # zod schema, repair/drop
│  │     ├─ staff.ts              # roster + response-count distribution
│  │     └─ providers/
│  │        ├─ types.ts  ·  models.ts
│  │        ├─ anthropic.ts  ·  ollama.ts        # openai.ts / gemini.ts deferred
│  ├─ preload/
│  │  └─ index.ts                 # contextBridge → window.api
│  ├─ shared/
│  │  └─ types.ts                 # Ticket, Settings, ProviderConfig, IPC contract
│  └─ renderer/
│     ├─ index.html  ·  main.tsx  ·  App.tsx        # single-page shell
│     ├─ components/
│     │  ├─ ui/                   # shadcn primitives, restyled neo-brutalist
│     │  ├─ TopBar.tsx            # title, LOAD TICKETS, GENERATE, gear icon
│     │  ├─ SettingsModal.tsx     # modal hosting the config sections below (tabbed)
│     │  ├─ SettingsPanel.tsx     # sliders/toggles
│     │  ├─ StaffRosterEditor.tsx # editable name/alias rows (email = alias@company.biz)
│     │  ├─ ProviderConfig.tsx    # provider picker, key entry, test
│     │  ├─ PromptEditor.tsx      # editable prompt + compiled preview
│     │  ├─ StorageSettings.tsx   # default JSON directory picker
│     │  ├─ GenerateModal.tsx     # separate modal owning the run flow
│     │  ├─ GeneratePanel.tsx     # run/cancel + progress + cost-estimate gate
│     │  ├─ TicketList.tsx        # paginated list, 100/page (clickable rows)
│     │  ├─ Pagination.tsx        # first/prev/next/last + page indicator
│     │  └─ TicketModal.tsx       # conversation modal; staff vs customer highlighting
│     └─ lib/
```

### IPC surface (preload `window.api`)
- `settings.get()` / `settings.set(partial)`
- `secrets.setKey(provider, key)` / `secrets.hasKey(provider)` / `secrets.testConnection(provider)`
- `ollama.listModels(host)`
- `prompt.compile(settings)` → preview string
- `generation.start(config)` / `generation.cancel()` + `onProgress(cb)` event
- `tickets.loadDefault()` / `tickets.open()` / `tickets.export()` (exports the file main has loaded; no renderer-supplied path)

---

## 10. UI layout & visual design

### Visual design — neo-brutalist, black & white
Strictly **monochrome** (black, white, grays — no accent colors), minimalist, high-contrast. Characteristics:
- Hard black borders, **no rounded corners** (or near-zero radius), solid offset drop-shadows.
- Heavy/condensed type for headings; UPPERCASE for buttons and labels (e.g. `LOAD TICKETS`, `GENERATE`, `SETTINGS`).
- Flat fills, no gradients; status shown via borders/weight/labels rather than color.
- shadcn/ui primitives **restyled** to this language via Tailwind (square corners, thick borders, mono/condensed fonts) rather than the default soft theme.

### Layout — single page
One screen, no tabs/routing:
- **Top bar**: app title on the left; on the right a **`LOAD TICKETS`** button, a **`GENERATE`** button, and a **gear icon** for settings.
- **Body**: the paginated ticket list (§7) — 100 per page with pagination controls — plus the filter/search and summary (status counts, total, provider/model, `meta.usage` breakdown). Empty state when no file is loaded, prompting `LOAD TICKETS` or to generate a run.
- **Settings modal**: the gear icon opens a modal over the page containing all *configuration* — provider config + API keys, the settings sliders/toggles, the staff roster editor, the editable prompt + compiled-prompt preview, and the default JSON directory picker. (Sections are organized as tabs within the modal.) Closing the modal returns to the ticket list.
- **Generate modal**: the `GENERATE` button opens a **separate** modal that owns the run flow — the pre-run cost-estimate confirmation gate, then live progress with a Cancel button. Keeping generation in its own modal (rather than inside Settings) lets the user tweak settings and launch a run as distinct steps, and keeps run progress visible independent of the settings UI. Run state persists if the modal is closed mid-run.

---

## 11. Implementation phases

1. **Scaffold + design system** — electron-vite + React + TS + Tailwind + shadcn; hardened BrowserWindow, preload/contextBridge, CSP. Establish the neo-brutalist black/white theme (restyled shadcn primitives) and the single-page shell: top bar (title, `LOAD TICKETS`, `GENERATE`, gear) plus a settings modal and a separate generate modal. Hello-world IPC round-trip.
2. **Settings + secrets** — settings.json persistence (incl. default JSON directory + staff roster); safeStorage key storage; ProviderConfig UI (key entry, "is set", test connection); Ollama model listing; staff roster editor; default-directory folder picker.
3. **Prompt + schema** — shared zod Ticket schema; minimal starter prompt; promptCompiler + compiled preview; default + user-editable staff roster (name/alias → `@company.biz`), auto-generate-when-empty before a run, and response-count distribution.
4. **Providers** — Anthropic + Ollama adapters with JSON output (OpenAI/Gemini deferred); models.ts curated map (verify current model IDs).
5. **Orchestrator** — batching, concurrency, retry/backoff, progress streaming, cancel, atomic incremental writes, validation/repair.
6. **Viewer** — paginated list (100/page) with clickable rows, conversation modal (customer = black-on-white, staff = black-on-slate-grey, by `@company.biz` domain), filter/search, summary + usage breakdown, auto-load from default directory on launch, `LOAD TICKETS`/export dialogs.
7. **Polish & tests** — unit + integration test suite (§13); cost estimate + confirmation; error states; empty states.

Tests are added incrementally alongside each phase (not deferred to the end): every phase that introduces a module also lands its integration coverage, so the suite guards against regressions as later features arrive.
8. **Packaging** — electron-builder distributables via GitHub Releases. **v0 decision: unsigned** builds (no Apple Developer ID / Windows cert yet) and **manual** updates; macOS ships a universal `.dmg`/`.zip`, with a documented Gatekeeper bypass for first launch. A tag-triggered GitHub Actions workflow builds + uploads to a draft Release. Signing + notarization and auto-update are deferred to a later version. Config lives in `electron-builder.yml` + `.github/workflows/release.yml`; user-facing install steps are in the README.

---

## 12. Decisions & remaining build-time verifications

Decided:
- **Providers (current scope)**: **Anthropic + Ollama only**; OpenAI and Gemini deferred to a future release. (§5)
- **Models**: cost-balanced mid-tier (Anthropic Sonnet); not flagships. (§5)
- **Cost estimate**: required pre-run confirmation gate; real token/cost breakdown recorded in `meta.usage` and shown in the viewer. (§2, §6)
- **Keychain**: Electron `safeStorage`. (§8)

> Remaining build-time verifications (model IDs + pricing) are tracked in the final checklist — see §14.

---

## 13. Testing strategy

Goal: a small, fast, **deterministic** suite that locks in core behavior so new features don't silently regress it. No real network calls — providers are mocked. Runner: **Vitest**.

### Unit tests (pure logic)
- `promptCompiler` — editable prompt + injected requirements compose correctly; staff roster and response guidance only appear when enabled; allowed-status list is included.
- `validate` (zod) — valid tickets pass; malformed ones are repaired (id assigned, bad status → `open`) or dropped; `responses` stripped when staff responses are disabled; the **opening message is forced to customer role** even on a `@company.biz` email; recently-opened tickets drop their replies on assembly.
- `time` — opening times ascending within the window and never in the future; message timestamps **strictly increasing** even in a tiny window before "now"; `isRecentOpening` boundary.
- `staff` — roster resize (grow/trim), alias normalization/uniqueness, derived `@company.biz` emails, default roster, auto-generate-when-empty, and the response-count distribution.
- `generation` — token sizing from actual sampled response counts vs. the average; `max_tokens` margin + ceiling.
- `models`/pricing — correct model + pricing selected per provider; cost math (estimate and `actualCostUsd`) is correct.
- `fsUtil` — atomic write/read round-trip, null on missing/malformed, unique temp names under concurrent writes.

### Integration tests (cross-module flows — the regression guard)
1. **Generation orchestration with a mock provider** — inject a fake `LLMProvider` returning canned JSON; run a multi-batch generation and assert: correct ticket count, sequential ids, role assignment (`@company.biz` ⇒ staff), batching/concurrency, retry/backoff on a simulated `429`, **truncation → grow `max_tokens` → split-batch recovery**, **over-delivery capped to the requested count**, partial-success on a failing batch, cancellation via `AbortController`, and accumulated `meta.usage` (tokens, cost, batches, duration). The `GenerationService` layer is covered separately (injected clock, one-run-at-a-time guard, coalesced/atomic writes, `meta` assembly).
2. **Storage round-trip** — write tickets to the default directory, read them back, export to a chosen path; assert the on-disk JSON matches the schema and atomic-write (temp + rename) leaves a valid file if interrupted.
3. **Settings + secrets** — persist/restore `settings.json` (incl. roster + default directory); `safeStorage` key set/has/clear round-trips with `safeStorage` faked; assert keys are never returned to the renderer (only a boolean "is set").
4. **End-to-end generate→load** — drive a generation through the mock provider, then load the produced file through the viewer's load path; assert tickets, pagination grouping (100/page), and the parsed conversation/role split feed the modal correctly.
5. **IPC contract** — each `window.api` channel (settings, secrets, ollama.listModels, prompt.compile, generation.start/cancel + progress events, tickets.load/open/export) invokes its main-process handler with the expected payload and shape (handlers exercised directly; Electron `ipcMain`/`dialog`/`safeStorage` mocked).

### Optional E2E smoke (later)
- A single **Playwright Electron** test: app launches, the empty state renders, the gear opens the settings modal, and `LOAD TICKETS` loads a fixture file into the paginated list. Kept minimal — heavier flows stay at the integration layer for speed and determinism.

### Practices
- A shared **fixtures** module (sample tickets JSON, canned provider responses, a sample compiled prompt) reused across tests.
- Tests run in CI and locally via `npm test`; the suite must stay fast (mocked I/O and network).
- Coverage is added **per phase** (§11), so each new module ships with its tests.

---

## 14. Final verification checklist (do before release) ⚠️

Knowledge-cutoff items that must be confirmed against the providers' **live catalogs** before shipping. All values are centralized in `src/main/generation/providers/models.ts`, so each is a one-line change.

- [x] **Anthropic** — model id `claude-sonnet-5` with standard pricing $3 / $15 per 1M tokens (verified against Anthropic's pricing page, 2026-07). Note: introductory Sonnet 5 pricing of $2 / $10 is in effect through 2026-08-31; the table uses the post-intro standard rate.
- [ ] Re-run a small generation against Anthropic to confirm the model id is accepted and the reported token usage → cost math looks right in `meta.usage`. *(needs a live API key — still outstanding)*
- *(Deferred)* **OpenAI** and **Gemini** model ids + pricing — only relevant once those adapters are added back (see §5 current scope).
