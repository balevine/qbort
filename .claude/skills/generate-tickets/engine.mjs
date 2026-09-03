#!/usr/bin/env node
// Deterministic engine for the generate-tickets skill. Owns everything the LLM must NOT: settings
// clamping, roster generation, opening-time assignment, prompt compilation, validation/repair,
// id assignment, timestamp synthesis, per-batch capping, and top-up accounting. The only thing
// left to the ambient Claude subagents is producing ticket *content* — see SKILL.md.
//
// Subcommands:
//   plan     --prompt <file> --out <dir> --count N [--staff] [--avg A] [--staff-members M]
//            [--age-days D] [--batch-size B]
//   batches  --out <dir>
//   topup    --out <dir> --round R
//   assemble --out <dir> --round R
//
// `plan` and `batches` are separate because a scenario list has to be generated in between, and in
// the skill an LLM call is a subagent spawn that only SKILL.md can make. `plan` writes
// <out>/scenario-prompt.txt, a subagent answers into <out>/scenarios.json, and `batches` deals one
// scenario per ticket into the batch prompts so independent batches cannot converge on the same
// topics.
//
// State lives in <out>/run-context.json; each round's batch manifest in <out>/round-<r>.json;
// each batch's compiled prompt in <out>/prompt-<r>-<i>.txt and the subagent's raw output in
// <out>/batch-<r>-<i>.json. The finished file is written to <out>/tickets.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { clampGeneration, DEFAULT_PROMPT } from './lib/settings.mjs'
import { generateRoster, sampleResponseCounts } from './lib/staff.mjs'
import { openingTimesForRun } from './lib/time.mjs'
import { compilePromptParts, compileScenarioPrompt, scenarioTarget } from './lib/promptCompiler.mjs'
import { validateTickets, assembleTickets } from './lib/validate.mjs'
import { DEFAULT_BATCH_SIZE } from './lib/constants.mjs'

// ── tiny arg parser ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) out[key] = true
      else {
        out[key] = next
        i++
      }
    } else out._.push(a)
  }
  return out
}

function readJson(path, fallback = null) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2))
}

function splitBatches(count, batchSize) {
  const specs = []
  for (let start = 0; start < count; start += batchSize) {
    specs.push(Math.min(batchSize, count - start))
  }
  return specs
}

// Fisher-Yates over a copy.
function shuffled(list, rng = Math.random) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

// Compile prompt files for a round and write its manifest. Shared by `batches` and `topup`.
// Deals scenarios off the context's list, advancing `scenarioCursor` as batches are built. A round
// that outruns the reserve simply gets fewer scenarios than tickets — see cmdTopup.
function buildRound(ctx, outDir, round, count) {
  const gen = ctx.settings
  if (typeof ctx.scenarioCursor !== 'number') ctx.scenarioCursor = 0
  const specs = splitBatches(count, ctx.batchSize)
  const batches = specs.map((batchCount, index) => {
    const responseCounts = gen.includeStaffResponses
      ? sampleResponseCounts(batchCount, gen.avgStaffResponses)
      : undefined
    const scenarios = (ctx.scenarios ?? []).slice(ctx.scenarioCursor, ctx.scenarioCursor + batchCount)
    ctx.scenarioCursor += scenarios.length
    const { dynamic } = compilePromptParts({
      editablePrompt: ctx.prompt,
      batchCount,
      scenarios,
      staff: {
        include: gen.includeStaffResponses,
        avgResponses: gen.avgStaffResponses,
        roster: ctx.roster,
        responseCounts
      }
    })
    const promptFile = resolve(join(outDir, `prompt-${round}-${index}.txt`))
    const batchFile = resolve(join(outDir, `batch-${round}-${index}.json`))
    writeFileSync(promptFile, `${ctx.staticPrefix}\n\n${dynamic}\n`)
    return { index, count: batchCount, promptFile, batchFile }
  })
  const manifest = { round, batches }
  writeJson(join(outDir, `round-${round}.json`), manifest)
  return manifest
}

function printRound(manifest) {
  console.log(`ROUND ${manifest.round}: ${manifest.batches.length} batch(es) to generate.`)
  console.log('Spawn one subagent per line below (in parallel). Each reads its PROMPT file and writes its BATCH file:')
  for (const b of manifest.batches) {
    console.log(`  BATCH ${b.index} (${b.count} tickets) PROMPT=${b.promptFile} BATCH=${b.batchFile}`)
  }
}

// ── plan ────────────────────────────────────────────────────────────────────
function cmdPlan(args) {
  const outDir = resolve(args.out || '.qbort-run')
  mkdirSync(outDir, { recursive: true })

  const promptPath = resolve(args.prompt || 'TICKET_PROMPT.md')
  if (!existsSync(promptPath)) {
    console.error(`MISSING_PROMPT ${promptPath}`)
    process.exit(2)
  }
  const prompt = readFileSync(promptPath, 'utf8')

  const settings = clampGeneration({
    numTickets: args.count !== undefined ? Number(args.count) : undefined,
    includeStaffResponses: args.staff === true || args.staff === 'true',
    avgStaffResponses: args.avg !== undefined ? Number(args.avg) : undefined,
    numStaffMembers: args['staff-members'] !== undefined ? Number(args['staff-members']) : undefined,
    maxTicketAgeDays: args['age-days'] !== undefined ? Number(args['age-days']) : undefined
  })

  const nowMs = Date.now()
  const batchSize = args['batch-size'] !== undefined ? Math.max(1, Number(args['batch-size'])) : DEFAULT_BATCH_SIZE

  const roster = generateRoster(settings.numStaffMembers)
  const openingTimes = openingTimesForRun(settings.numTickets, settings.maxTicketAgeDays, nowMs)

  // Static prefix is identical across every batch. Pass a defined (empty) responseCounts so the
  // averaged directive is omitted here (per-ticket targets live in each batch's dynamic suffix).
  const { static: staticPrefix } = compilePromptParts({
    editablePrompt: prompt,
    batchCount: 0,
    staff: {
      include: settings.includeStaffResponses,
      avgResponses: settings.avgStaffResponses,
      roster,
      responseCounts: settings.includeStaffResponses ? [] : undefined
    }
  })

  const ctx = {
    version: 1,
    nowMs,
    batchSize,
    prompt,
    settings,
    roster,
    staticPrefix,
    openingTimes,
    round: 0,
    generatedCount: 0,
    dropped: 0,
    scenarioCount: scenarioTarget(settings.numTickets),
    scenarios: [],
    scenarioCursor: 0,
    tickets: []
  }
  writeJson(join(outDir, 'run-context.json'), ctx)

  const scenarioPromptFile = resolve(join(outDir, 'scenario-prompt.txt'))
  const scenariosFile = resolve(join(outDir, 'scenarios.json'))
  writeFileSync(scenarioPromptFile, `${compileScenarioPrompt(prompt, ctx.scenarioCount)}\n`)

  console.log(`PLANNED ${settings.numTickets} ticket(s), batchSize=${batchSize}, staff=${settings.includeStaffResponses}, roster=${roster.length}`)
  console.log(`OUT ${outDir}`)
  console.log(`SCENARIO ${ctx.scenarioCount} scenario(s) needed. Spawn ONE subagent that reads its PROMPT file and writes its OUT file:`)
  console.log(`  PROMPT=${scenarioPromptFile} OUT=${scenariosFile}`)
  console.log('Then run: engine.mjs batches --out <dir>')
}

// ── batches ─────────────────────────────────────────────────────────────────
// Reads the scenario list the subagent produced, shuffles it, and builds round 0.
// Shuffling matters: the model emits the list grouped by whatever categories the prompt implies, so
// dealing it in order would cluster categories per batch and leave the reserve as one category.
function cmdBatches(args) {
  const outDir = resolve(args.out || '.qbort-run')
  const ctx = readJson(join(outDir, 'run-context.json'))
  if (!ctx) {
    console.error('NO_CONTEXT run plan first')
    process.exit(2)
  }

  const scenariosPath = join(outDir, 'scenarios.json')
  let raw = null
  try {
    raw = readFileSync(scenariosPath, 'utf8')
  } catch {
    console.error(`NO_SCENARIOS ${resolve(scenariosPath)} not found — the scenario subagent must write it before running batches`)
    process.exit(2)
  }
  // Lenient like validateTickets: tolerate fences or stray prose around the JSON object.
  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start !== -1 && end > start) {
      try {
        parsed = JSON.parse(raw.slice(start, end + 1))
      } catch {
        /* still unparseable → reported below */
      }
    }
  }
  const list = Array.isArray(parsed) ? parsed : parsed?.scenarios
  if (!Array.isArray(list)) {
    console.error(`BAD_SCENARIOS ${resolve(scenariosPath)} is not a JSON object of shape { "scenarios": [...] }`)
    process.exit(2)
  }
  const cleaned = list.filter((s) => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim())
  const needed = ctx.settings.numTickets
  if (cleaned.length < needed) {
    console.error(`SHORT_SCENARIOS got ${cleaned.length} usable scenario(s), need at least ${needed} (asked for ${ctx.scenarioCount})`)
    process.exit(2)
  }

  ctx.scenarios = shuffled(cleaned)
  ctx.scenarioCursor = 0
  const manifest = buildRound(ctx, outDir, 0, needed)
  writeJson(join(outDir, 'run-context.json'), ctx)

  console.log(`SCENARIOS ${ctx.scenarios.length} loaded (${ctx.scenarios.length - needed} held in reserve for top-ups)`)
  printRound(manifest)
}

// ── topup ─────────────────────────────────────────────────────────────────────
function cmdTopup(args) {
  const outDir = resolve(args.out || '.qbort-run')
  const ctx = readJson(join(outDir, 'run-context.json'))
  if (!ctx) {
    console.error('NO_CONTEXT run plan first')
    process.exit(2)
  }
  const round = Number(args.round)
  if (!Number.isInteger(round) || round < 1) {
    console.error('BAD_ROUND topup needs --round >= 1')
    process.exit(2)
  }
  const shortfall = ctx.settings.numTickets - ctx.generatedCount
  if (shortfall <= 0) {
    console.log('SHORTFALL 0 (nothing to top up)')
    return
  }
  ctx.round = round
  // Top-ups draw from the scenario reserve. If it runs dry those tickets are generated without a
  // scenario rather than failing the run — most of the output already exists at this point, so
  // fail-fast (the rule for the initial scenario call) would be the wrong trade.
  const reserve = Math.max(0, (ctx.scenarios?.length ?? 0) - ctx.scenarioCursor)
  const manifest = buildRound(ctx, outDir, round, shortfall)
  writeJson(join(outDir, 'run-context.json'), ctx)
  console.log(`TOPUP round ${round}: shortfall=${shortfall}, scenarios available=${Math.min(reserve, shortfall)}`)
  printRound(manifest)
}

// ── assemble ────────────────────────────────────────────────────────────────
function cmdAssemble(args) {
  const outDir = resolve(args.out || '.qbort-run')
  const ctx = readJson(join(outDir, 'run-context.json'))
  if (!ctx) {
    console.error('NO_CONTEXT run plan first')
    process.exit(2)
  }
  const round = Number(args.round)
  const manifest = readJson(join(outDir, `round-${round}.json`))
  if (!manifest) {
    console.error(`NO_ROUND round-${round}.json not found`)
    process.exit(2)
  }

  const total = ctx.settings.numTickets
  const includeStaffResponses = ctx.settings.includeStaffResponses
  const kept = ctx.tickets
  const timeCtx = {
    nowMs: ctx.nowMs,
    rng: Math.random,
    openingMsForId: (id) => ctx.openingTimes[id - 1] ?? ctx.nowMs
  }

  let roundKept = 0
  for (const b of manifest.batches) {
    if (kept.length >= total) break
    // Read as raw text and let validateTickets' lenient parser handle fences/garbage. A
    // missing/unparseable batch → 0 tickets, and the top-up loop covers the shortfall.
    let raw = null
    try {
      raw = readFileSync(b.batchFile, 'utf8')
    } catch {
      /* missing batch file → treated as empty */
    }
    const validated = validateTickets(raw, { includeStaffResponses })
    ctx.dropped += validated.dropped
    // Never emit more than the batch asked for, nor push the run past the requested total —
    // extra ids would run past the pre-computed opening-time window.
    const room = Math.min(b.count, total - kept.length)
    const capped = validated.tickets.slice(0, room)
    const assigned = assembleTickets(capped, kept.length + 1, timeCtx)
    kept.push(...assigned)
    roundKept += assigned.length
  }

  ctx.generatedCount = kept.length
  writeJson(join(outDir, 'run-context.json'), ctx)

  const file = {
    meta: {
      // Shaped to satisfy the desktop app's loader (ticketFile.ts) so `LOAD TICKETS` accepts it.
      // `provider: 'claude-skill'` is display metadata (TicketFileProvider); there is no `usage`
      // block because ambient-Claude generation has no token/cost accounting — the viewer shows
      // "—" for those stats. Extra fields below are tolerated by the app's passthrough meta schema.
      generatedAt: new Date(ctx.nowMs).toISOString(),
      appVersion: '0.1.0',
      provider: 'claude-skill',
      model: 'Claude Code subagents',
      requestedCount: total,
      generatedCount: kept.length,
      settings: { generation: ctx.settings },
      generator: 'qbort-skill (ambient Claude)',
      rounds: round + 1,
      dropped: ctx.dropped
    },
    tickets: kept
  }
  const ticketsPath = join(outDir, 'tickets.json')
  writeJson(ticketsPath, file)

  const shortfall = total - kept.length
  console.log(`ASSEMBLED round ${round}: +${roundKept} this round`)
  console.log(`KEPT ${kept.length} REQUESTED ${total} DROPPED ${ctx.dropped} SHORTFALL ${shortfall}`)
  console.log(`FILE ${resolve(ticketsPath)}`)
}

// ── dispatch ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const cmd = argv[0]
const args = parseArgs(argv.slice(1))
switch (cmd) {
  case 'plan':
    cmdPlan(args)
    break
  case 'batches':
    cmdBatches(args)
    break
  case 'topup':
    cmdTopup(args)
    break
  case 'assemble':
    cmdAssemble(args)
    break
  default:
    console.error('Usage: engine.mjs <plan|batches|topup|assemble> [options]  (see file header)')
    process.exit(1)
}
