# Ticket Generator — Project Spec

A local-first Electron desktop app that generates fake customer-support tickets with an
LLM, based on user-controlled settings and an editable prompt. The app runs entirely
locally and only reaches out to an external LLM provider when generating ticket data.
Generated tickets are written to a JSON file the user can view in-app and export.

> Prior art: this re-implements, as a desktop app, the batched LLM generation approach
> from `~/dashbort/script/sandbox` (`sandbox_prompt.rb`, `generate_sandbox_conversations.rb`,
> `config/sandbox_distributions.json`). We keep the *technique* (batched async generation,
> JSON output, distribution-driven prompts) but use a deliberately simpler output schema and
> a minimal starter prompt.

---

## 1. Goals & non-goals

### Goals
- Desktop app (macOS first; Windows/Linux capable via Electron) that generates fake tickets.
- LLM-backed generation driven by **numeric settings + an editable prompt**.
- Support four providers: **Anthropic (Claude)**, **OpenAI**, **Ollama (local)**, **Google Gemini**.
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

Deliberately flat, per requirements. This is the contract the LLM must produce and the
viewer renders.

```jsonc
// tickets.json
{
  "meta": {
    "generatedAt": "2026-06-30T12:00:00Z",
    "appVersion": "0.1.0",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
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
      "id": "T-00001",
      "subject": "Can't log in after password reset",
      "body": "Customer's full opening message...",
      "status": "open",
      "from": { "name": "Sarah Kim", "email": "sarah.kim@fake.techcorp.com" },
      "responses": [
        {
          "body": "Staff reply text...",
          "from": { "name": "Mike Rodriguez", "email": "mike.rodriguez@company.biz" }
        }
      ]
    }
  ]
}
```

Schema notes:
- `id` — sequential, assigned/normalized by the app (`T-00001`…), not trusted from the LLM.
- `status` — string from a small default set (`new`, `open`, `pending`, `on-hold`, `solved`,
  `closed`). The set is a constant the user can influence via the prompt; the app validates
  against the allowed set and falls back to `open` if invalid.
- `from` — author of the original ticket (the customer).
- `responses[]` — follow-up comments. Each has `body` + `from`. Driven by the staff settings
  (see §3). A response's `from` identifies whether it is a staff member (drawn from the
  generated staff roster) or the customer.
- Everything else (categories, sentiment, channel, custom fields, time offsets) from the
  dashbort schema is intentionally **omitted** from the output; if the user wants those to
  influence content, they express them in the editable prompt — they shape the generated
  `subject`/`body`, not extra fields.

Validation is enforced with **zod** in the main process; malformed tickets are repaired
where safe (assign id, coerce status) or dropped + retried.

---

## 3. Settings

Persisted locally (non-sensitive) in `settings.json` under Electron `userData`. Rendered as
numeric inputs paired with sliders where a bounded range exists.

| Setting | Control | Default | Min | Max | Notes |
|---|---|---|---|---|---|
| Number of tickets | slider + number | 100 | 1 | 5000 | Hard cap 5000. |
| Average number of staff responses | slider + number | 0 | 0 | 20 | Mean responses/ticket; actual count varies around this. |
| Include staff responses? | toggle | false | — | — | When false, `responses` is empty regardless of the average. |
| Number of staff members | slider + number | 10 | 1 | 100 | Drives the number of rows in the staff roster editor (below). |

Plus a **staff roster editor** (not a slider): an editable list of staff members, each row a
`name` + `alias` pair. The email is **derived**, not entered: `${alias}@company.biz`. All staff
share the fixed `company.biz` domain; only name and alias are editable.

```ts
type StaffMember = { name: string; alias: string }   // email = `${alias}@company.biz`
```

Behavior:
- **Default roster**: the app ships with a built-in default set of staff members (e.g. ~7–10
  named agents with `firstname.lastname` aliases on `company.biz`), so the roster is never empty
  out of the box.
- **User-editable**: the roster is the source of truth for response authors. Changing **Number
  of staff members** resizes it — growing appends pre-filled generated rows (`Firstname
  Lastname` + `firstname.lastname` alias); shrinking trims from the end. Names and aliases are
  editable; rows can be added/removed directly (which keeps the count in sync). Aliases are
  normalized/validated (lowercased, no spaces, unique) so derived emails are well-formed.
- **Auto-generate before a run**: at the start of generation, if the roster is empty (or the
  user has cleared it), the app auto-generates a roster of **Number of staff members** entries
  before producing any ticket messages. The roster (names + derived `@company.biz` emails) is
  persisted in `settings.json`, injected into the compiled prompt, and reused across all batches
  so authors stay consistent.
- **Response distribution**: per ticket, draw a response count from a distribution centered
  on the average (e.g., Poisson(avg), clamped ≥ 0). This count + roster is injected into the
  prompt instructions for that batch so the LLM produces matching `responses`.
- If **Include staff responses = false**, the compiled prompt instructs zero staff replies and
  the validator strips any `responses` the model returns anyway.

Other config that lives in **settings.json** (not the keychain):
- Active provider id — **defaults to `ollama`** (local) so the app works out of the box for
  local testing with no API key; the user can switch to a hosted provider in the settings modal.
- Ollama host + selected model.
- Editable prompt text.
- Staff roster (name/email pairs).
- **Default JSON directory** — the folder where generated ticket files are saved and from which
  the app auto-loads on launch. User-settable in the settings modal (folder picker); defaults to
  `userData` if unset.
- Last-used output file path.

---

## 4. Editable prompt

- A large text editor in the UI holds the **creative + distribution** half of the prompt:
  ticket categories, category percentages, sentiment ratios, tone, domain/product context, etc.
- Ships with a **minimal starter prompt** (a few example categories and a short instruction),
  not the full dashbort distribution set. The user grows it themselves.
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

- `promptCompiler.ts` owns this composition. A **"Preview compiled prompt"** affordance shows
  the user exactly what gets sent. The user's text is never silently overridden — app
  requirements are appended and clearly delimited.

---

## 5. LLM providers

### Provider abstraction (`src/main/generation/providers/`)
```ts
interface LLMProvider {
  id: 'anthropic' | 'openai' | 'gemini' | 'ollama'
  generateBatch(args: {
    compiledPrompt: string
    count: number
    signal: AbortSignal
  }): Promise<RawTicket[]>            // parsed JSON, pre-validation
  listModels?(): Promise<string[]>   // Ollama only (GET /api/tags)
}
```

Implementations:
- **Anthropic** — `@anthropic-ai/sdk`; JSON output via tool-use / structured output; prompt caching on the static prefix of the compiled prompt to cut cost across batches.
- **OpenAI** — `openai` SDK; `response_format` JSON schema.
- **Gemini** — `@google/generative-ai`; `responseSchema` / JSON mime type.
- **Ollama** — `fetch` to local server (default `http://localhost:11434`); `format: json`;
  `listModels()` via `/api/tags`.

All provider calls happen **in the main process** (keeps keys out of the renderer, avoids CORS).

### Model auto-selection (`models.ts`)
- A **curated map** of the best *cost-balanced* model per hosted provider, centralized so it's
  a one-line update as new models ship. The user does **not** choose a model for hosted providers.
- **Philosophy:** synthetic, text-only ticket generation is high-volume and not
  reasoning-heavy, so we deliberately target **mid-tier models** that balance cost, speed, and
  quality rather than flagships. Flagship pricing/latency is not justified across the hundreds
  of batches a 5,000-ticket run requires.
- **Important (knowledge-cutoff caveat):** exact model IDs must be verified against each
  provider's *current* model list at implementation time. Initial targets:
  - Anthropic → current **Sonnet** (cost-balanced workhorse) — **verify exact ID**.
  - OpenAI → current cost-balanced general model (mid-tier, not the flagship reasoning model) — **verify exact ID**.
  - Gemini → current **Flash**-class model — **verify exact ID**.
- **Ollama** is the only case where the user selects a model — populated from `listModels()`.
- A `pricing` table (input/output $ per 1M tokens) lives alongside the model map and feeds the
  cost estimate (§6) and the run usage breakdown (§2 `meta.usage`). Pricing must also be
  verified at build time.

### Provider configuration UI
- User picks the active provider. **Default: Ollama (local)** — chosen so the app runs without
  any API key for local development/testing; hosted providers are opt-in.
- For hosted providers: enter API key (stored in keychain). UI shows only whether a key is
  **set** (boolean), never the key value. A "Test connection" button does a tiny live call.
- For Ollama: enter host, click to fetch installed models, pick one.

---

## 6. Generation orchestration (`orchestrator.ts`)

Mirrors the Ruby batched-async approach:
- **Batching**: split `requestedCount` into batches (configurable `batchSize`, default ~20).
  Up to 5000 tickets → up to ~250 batches. The batch size is **adaptively reduced** when staff
  responses make each ticket large, so a batch's expected output stays within the model's token
  budget and doesn't get truncated mid-JSON (which would drop the whole batch). `max_tokens` is
  sized per batch from the expected output rather than a fixed constant.
- **Concurrency**: limited parallelism (e.g. `p-limit`, 3–5 concurrent) to respect rate limits.
- **Retry/backoff**: on `429`/rate-limit, exponential/linear backoff with max retries (as in
  the Ruby script). Per-batch failures are isolated; partial success is kept.
- **Progress**: main streams progress events to renderer via `webContents.send`
  (`generation:progress`): batches done, tickets done, retries, errors, ETA.
- **Cancellation**: `AbortController`; a Cancel button aborts in-flight requests and stops
  scheduling new batches; tickets produced so far are still written.
- **ID assignment & validation**: after each batch, tickets are validated (zod), repaired or
  dropped, assigned sequential ids, and appended to the output.
- **Pre-run cost estimate (required gate)**: before every run, show an estimated token/cost
  breakdown — derived from `requestedCount`, batch size, an assumed avg input/output tokens per
  ticket (calibrated from a small sample or heuristic), and the provider `pricing` table — and
  require explicit confirmation to proceed. Ollama runs show "$0 (local)".
- **Usage tracking (completed runs)**: accumulate real input/output token counts reported by
  each provider's API response across all batches; compute `actualCostUsd` from the pricing
  table; record `inputTokens`, `outputTokens`, `totalTokens`, `batches`, `estimatedCostUsd`,
  `actualCostUsd`, `pricing`, and `durationMs` into `meta.usage` (§2). The viewer surfaces this
  breakdown for any loaded file.

Output is written incrementally/atomically so a crash mid-run still leaves a valid file
(write to temp file, then rename).

---

## 7. Storage & viewer

### Storage (`storage.ts`)
- Generated files are written into the user's **Default JSON directory** (settings.json;
  defaults to `userData`).
- **Default location setting**: a folder picker in the settings modal controls where files are
  saved and from where the app auto-loads.
- **LOAD TICKETS**: a prominent button on the main page opens a native open dialog to load an
  arbitrary tickets JSON into the view (defaulting the dialog to the default directory).
- **Export**: native save dialog to copy/write the JSON anywhere.
- On launch, if a ticket file exists in the default directory (last-used preferred), load it
  into the view automatically.

### Viewer (renderer)
- **Paginated list**: a single scrollable list/table of tickets, **100 per page**, with
  page controls (first/prev/next/last + page indicator). Columns `id`, `subject`, `status`,
  `from`. Pagination (not virtualization) keeps the DOM light for 5000-ticket files.
- **Detail (conversation modal)**: each ticket row is clickable and **pops the full conversation
  into a modal** over the page. The thread is rendered as a sequence of messages — the opening
  `body` (from the customer) followed by each `responses[]` entry — with author name/email shown
  per message. Messages are highlighted by role to separate the two sides:
  - **Customer messages**: black text on a **white** background.
  - **Staff messages**: black text on a **slate-grey** background.
  - Role is determined by email domain: `@company.biz` ⇒ staff, anything else ⇒ customer.
  The modal stays within the neo-brutalist language (hard borders, square corners); slate-grey
  is the one permitted non-pure-monochrome surface, used only to distinguish staff replies.
- **Filter/search**: by status and free-text over subject/body/from (applied before paging).
- **Summary**: counts by status, total tickets, provider/model, and the `meta.usage` cost/token
  breakdown for the loaded file.

---

## 8. Security model

- **Keys in OS keychain — decided: Electron `safeStorage`.** It's the official, actively
  maintained Electron API; the app encrypts each key and the encryption key is held in the OS
  keychain (Keychain on macOS, libsecret on Linux, DPAPI on Windows). `keytar` was considered
  and rejected — it is archived/unmaintained and requires native rebuilds. `safeStorage` is both
  better-supported and at least as secure for this use. Encrypted blobs are stored under
  `userData`; the keychain protects the encryption key.
- Keys are **only** read in the main process at call time and **never** sent to the renderer.
  Renderer can request "store key for provider X" / "is a key set for X?" / "test connection",
  nothing more.
- **Renderer hardening**: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`;
  a strict `preload` exposing a minimal, typed `window.api` via `contextBridge`; a strict CSP
  applied to every renderer response via the main process (`session.webRequest.onHeadersReceived`
  in `src/main/index.ts`) rather than a `<meta>` tag in `index.html` — enforcing it at the
  header level is stronger and covers responses a meta tag can't. Production locks egress to
  `default-src 'self'` (no external `connect-src`, since all network calls happen in main).
- **All network egress from main only**; renderer makes no external requests.

---

## 9. Tech stack & project structure

- **Scaffold**: `electron-vite` (Electron + Vite, TS).
- **UI**: React + TypeScript + Tailwind CSS + shadcn/ui.
- **Validation**: zod (shared schemas).
- **Concurrency**: `p-limit`.
- **Ticket list**: client-side pagination, 100 rows/page (no virtualization library needed).
- **Provider SDKs**: `@anthropic-ai/sdk`, `openai`, `@google/generative-ai`, plus `fetch` for Ollama.
- **Tests**: Vitest for unit + integration (§13); optional Playwright Electron smoke test.
- **Packaging**: `electron-builder` (.dmg/.zip first) — later phase.

```
ticket-generator/
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
│  │        ├─ anthropic.ts  ·  openai.ts  ·  gemini.ts  ·  ollama.ts
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
- `tickets.loadDefault()` / `tickets.open()` / `tickets.export(path)`

---

## 10. UI layout & visual design

### Visual design — neo-brutalist, black & white
Matches the Dashbort aesthetic: strictly **monochrome** (black, white, grays — no accent
colors), minimalist, high-contrast. Characteristics:
- Hard black borders, **no rounded corners** (or near-zero radius), solid offset drop-shadows.
- Heavy/condensed type for headings; UPPERCASE for buttons and labels (e.g. `LOAD TICKETS`,
  `GENERATE`, `SETTINGS`).
- Flat fills, no gradients; status shown via borders/weight/labels rather than color.
- shadcn/ui primitives **restyled** to this language via Tailwind (square corners, thick
  borders, mono/condensed fonts) rather than the default soft theme.

### Layout — single page
One screen, no tabs/routing:
- **Top bar**: app title on the left; on the right a **`LOAD TICKETS`** button, a **`GENERATE`**
  button, and a **gear icon** for settings.
- **Body**: the paginated ticket list (§7) — 100 per page with pagination controls — plus the
  filter/search and summary (status counts, total, provider/model, `meta.usage` breakdown).
  Empty state when no file is loaded, prompting `LOAD TICKETS` or to generate a run.
- **Settings modal**: the gear icon opens a modal over the page containing all *configuration* —
  provider config + API keys, the settings sliders/toggles, the staff roster editor, the editable
  prompt + compiled-prompt preview, and the default JSON directory picker. (Sections are organized
  as tabs within the modal.) Closing the modal returns to the ticket list.
- **Generate modal**: the `GENERATE` button opens a **separate** modal that owns the run flow —
  the pre-run cost-estimate confirmation gate, then live progress with a Cancel button. Keeping
  generation in its own modal (rather than inside Settings) lets the user tweak settings and
  launch a run as distinct steps, and keeps run progress visible independent of the settings UI.
  Run state persists if the modal is closed mid-run.

---

## 11. Implementation phases

1. **Scaffold + design system** — electron-vite + React + TS + Tailwind + shadcn; hardened
   BrowserWindow, preload/contextBridge, CSP. Establish the neo-brutalist black/white theme
   (restyled shadcn primitives) and the single-page shell: top bar (title, `LOAD TICKETS`,
   `GENERATE`, gear) plus a settings modal and a separate generate modal. Hello-world IPC
   round-trip.
2. **Settings + secrets** — settings.json persistence (incl. default JSON directory + staff
   roster); safeStorage key storage; ProviderConfig UI (key entry, "is set", test connection);
   Ollama model listing; staff roster editor; default-directory folder picker.
3. **Prompt + schema** — shared zod Ticket schema; minimal starter prompt; promptCompiler +
   compiled preview; default + user-editable staff roster (name/alias → `@company.biz`),
   auto-generate-when-empty before a run, and response-count distribution.
4. **Providers** — Anthropic/OpenAI/Gemini/Ollama adapters with JSON output; models.ts curated
   map (verify current model IDs).
5. **Orchestrator** — batching, concurrency, retry/backoff, progress streaming, cancel, atomic
   incremental writes, validation/repair.
6. **Viewer** — paginated list (100/page) with clickable rows, conversation modal (customer =
   black-on-white, staff = black-on-slate-grey, by `@company.biz` domain), filter/search,
   summary + usage breakdown, auto-load from default directory on launch, `LOAD TICKETS`/export
   dialogs.
7. **Polish & tests** — unit + integration test suite (§13); cost estimate + confirmation;
   error states; empty states.

Tests are added incrementally alongside each phase (not deferred to the end): every phase that
introduces a module also lands its integration coverage, so the suite guards against regressions
as later features arrive.
8. **Packaging (later)** — electron-builder distributables; macOS signing/notarization (optional).

---

## 12. Decisions & remaining build-time verifications

Decided:
- **Models**: cost-balanced mid-tier per provider (Anthropic Sonnet, OpenAI mid-tier general,
  Gemini Flash); not flagships. (§5)
- **Cost estimate**: required pre-run confirmation gate; real token/cost breakdown recorded in
  `meta.usage` and shown in the viewer. (§2, §6)
- **Keychain**: Electron `safeStorage`. (§8)

> Remaining build-time verifications (model IDs + pricing) are tracked in the final
> checklist — see §14.

---

## 13. Testing strategy

Goal: a small, fast, **deterministic** suite that locks in core behavior so new features don't
silently regress it. No real network calls — providers are mocked. Runner: **Vitest**.

### Unit tests (pure logic)
- `promptCompiler` — editable prompt + injected requirements compose correctly; staff roster and
  response guidance only appear when enabled; allowed-status list is included.
- `validate` (zod) — valid tickets pass; malformed ones are repaired (id assigned, bad status →
  `open`) or dropped; `responses` stripped when staff responses are disabled.
- `staff` — roster resize (grow/trim), alias normalization/uniqueness, derived `@company.biz`
  emails, default roster, auto-generate-when-empty, and the response-count distribution.
- `models`/pricing — correct model + pricing selected per provider; cost math
  (estimate and `actualCostUsd`) is correct.

### Integration tests (cross-module flows — the regression guard)
1. **Generation orchestration with a mock provider** — inject a fake `LLMProvider` returning
   canned JSON; run a multi-batch generation and assert: correct ticket count, sequential ids,
   role assignment (`@company.biz` ⇒ staff), batching/concurrency, retry/backoff on a simulated
   `429`, partial-success on a failing batch, cancellation via `AbortController`, and accumulated
   `meta.usage` (tokens, cost, batches, duration).
2. **Storage round-trip** — write tickets to the default directory, read them back, export to a
   chosen path; assert the on-disk JSON matches the schema and atomic-write (temp + rename)
   leaves a valid file if interrupted.
3. **Settings + secrets** — persist/restore `settings.json` (incl. roster + default directory);
   `safeStorage` key set/has/clear round-trips with `safeStorage` faked; assert keys are never
   returned to the renderer (only a boolean "is set").
4. **End-to-end generate→load** — drive a generation through the mock provider, then load the
   produced file through the viewer's load path; assert tickets, pagination grouping (100/page),
   and the parsed conversation/role split feed the modal correctly.
5. **IPC contract** — each `window.api` channel (settings, secrets, ollama.listModels,
   prompt.compile, generation.start/cancel + progress events, tickets.load/open/export) invokes
   its main-process handler with the expected payload and shape (handlers exercised directly;
   Electron `ipcMain`/`dialog`/`safeStorage` mocked).

### Optional E2E smoke (later)
- A single **Playwright Electron** test: app launches, the empty state renders, the gear opens
  the settings modal, and `LOAD TICKETS` loads a fixture file into the paginated list. Kept
  minimal — heavier flows stay at the integration layer for speed and determinism.

### Practices
- A shared **fixtures** module (sample tickets JSON, canned provider responses, a sample
  compiled prompt) reused across tests.
- Tests run in CI and locally via `npm test`; the suite must stay fast (mocked I/O and network).
- Coverage is added **per phase** (§11), so each new module ships with its tests.

---

## 14. Final verification checklist (do before release) ⚠️

Knowledge-cutoff items that must be confirmed against the providers' **live catalogs** before
shipping. All values are centralized in `src/main/generation/providers/models.ts`, so each is a
one-line change.

- [ ] **Anthropic** — confirm the cost-balanced Sonnet model id (currently `claude-sonnet-4-6`)
      and its input/output price per 1M tokens (currently $3 / $15).
- [ ] **OpenAI** — confirm the mid-tier model id (currently `gpt-4.1-mini`) and its input/output
      price per 1M tokens (currently $0.40 / $1.60).
- [ ] **Gemini** — confirm the Flash-class model id (currently `gemini-2.5-flash`) and its
      input/output price per 1M tokens (currently $0.30 / $2.50).
- [ ] Re-run a small generation against each hosted provider to confirm the model id is accepted
      and the reported token usage → cost math looks right in `meta.usage`.
