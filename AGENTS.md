# AGENTS.md

Guidance for agentic coding tools working in this repo. Keep changes consistent with what's here. The authoritative spec is `.plans/PROJECT_SPEC.md` — read it for detail and **keep it in sync when behavior changes**.

## What this is

A local-first **Electron desktop app** that generates fake customer-support tickets with an LLM, driven by numeric settings + an editable prompt. Runs entirely locally; only network egress is the LLM call. Output is a `tickets.json` the user views in-app and exports. Providers: **Ollama** (local, default) and **Anthropic** — those two only (OpenAI/Gemini are deferred to later).

## Structure & process boundary

- `src/main/` — Electron **main process**. The only place with Node/OS/network/key access. Key files: `index.ts` (BrowserWindow + CSP), `ipc.ts` (typed handlers), `secrets.ts` (safeStorage), `settings.ts`, `storage.ts`, `fsUtil.ts` (`atomicWriteJson`/`readJson`), `connection.ts`, `generation/` (orchestrator, service, estimate, validate) + `generation/providers/` (adapters).
- `src/preload/index.ts` — `contextBridge` exposing the typed `window.api`. Nothing else reaches the renderer.
- `src/shared/` — cross-process pure logic + the **IPC contract**: `types.ts` (single source of truth for data model + `IpcApi`/`IpcChannels`), `settings.ts`, `staff.ts`, `promptCompiler.ts`, `time.ts`, `generation.ts`, `readiness.ts`.
- `src/renderer/` — React UI: `App.tsx` shell, `components/` (`ui/` primitives + feature components), `state/` (contexts via `createSafeContext`), `lib/` (utils, format, hooks).

**Hard rule:** the renderer never touches Node, the network, or API keys. Everything crosses the boundary through the allow-listed IPC surface (declared in `shared/types.ts`, implemented in `main/ipc.ts`, bridged in `preload`). API keys are decrypted in main only and **never** returned to the renderer (renderer learns only "is a key set").

## Generation pipeline

`GenerationService.start` → `runGeneration` (orchestrator) splits into concurrent batches → per batch: `compilePromptParts` → `provider.generateBatch` (raw `fetch`, no SDKs) → `validateTickets` (zod, repair/drop) → `assembleTickets` → coalesced atomic write.

**The app owns structural fields; the LLM owns content.** `id` (sequential int), `isStaff` (from `@company.biz` domain), and `createdAt` (synthesized, ascending, ordered by id) are assigned by the app — never trusted from the model. Ticket shape: `{ id, subject, status, messages: [{ from, body, isStaff, createdAt }] }` (opening message is `messages[0]`).

## Code style

- TypeScript strict; `noUnusedLocals` is on — no dead vars/imports. Path aliases `@shared/*` and `@/*`.
- **camelCase** everywhere (data model + code).
- Every module in `shared/` and `main/` ships a colocated `*.test.ts` (**Vitest**). Tests are deterministic: no real network (providers mocked), `safeStorage` faked, and `rng`/`now`/`sleep` are injectable — keep them that way.
- Prefer pure, testable helpers; keep side effects (fs, fetch, Electron) at the edges. Writes go through `fsUtil.atomicWriteJson`.
- Comments explain **why**, not what; match the surrounding density.
- When writing comments and markdown files, prefer periods and parenthesis over semi-colons and em-dashes.

## Visual design

Neo-brutalist, strictly **monochrome** black/white/grays, minimal, high-contrast. Tokens in `tailwind.config.cjs`: `ink` (black), `paper` (white); the only permitted non-monochrome surface is `staff` (slate) for staff messages. Hard **2px black borders**, **square corners** (`rounded-none`), solid offset shadows (`shadow-brutal`), flat fills (no gradients), **UPPERCASE mono** buttons/labels. shadcn/Radix primitives are restyled to this language in `components/ui/`. Status is conveyed by borders/weight/labels, not color.

## Commands

`npm run dev` · `npm run typecheck` · `npm test` · `npm run build` · `npm run pack:dir` (unpacked smoke) · `npm run dist:mac` (universal `.dmg`/`.zip`). Run `typecheck` + `test` before considering a change done.

## Notes

- Packaging is **unsigned**, manual-update, via GitHub Releases (`electron-builder.yml`, `.github/workflows/release.yml`).
- Model IDs/pricing live in `providers/models.ts` (unverified placeholders — see §14 of the spec).
- `README.md` is user-facing; paragraphs are single-line (soft-wrap) — match that. `.notes/` is gitignored scratch.
- Contribution rule: open an Issue before a PR.
