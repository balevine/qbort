#!/usr/bin/env node
// Deterministic engine for the generate-tickets skill. Owns everything the LLM must NOT: settings
// clamping, roster generation, opening-time assignment, prompt compilation, validation/repair,
// id assignment, timestamp synthesis, per-batch capping, and top-up accounting. The only thing
// left to the ambient Claude subagents is producing ticket *content* — see SKILL.md.
//
// Subcommands:
//   plan     --prompt <file> --out <dir> --count N [--staff] [--avg A] [--staff-members M]
//            [--age-days D] [--batch-size B] [--seed S]
//   topup    --out <dir> --round R
//   assemble --out <dir> --round R
//
// State lives in <out>/run-context.json; each round's batch manifest in <out>/round-<r>.json;
// each batch's compiled prompt in <out>/prompt-<r>-<i>.txt and the subagent's raw output in
// <out>/batch-<r>-<i>.json. The finished file is written to <out>/tickets.json.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { clampGeneration, DEFAULT_PROMPT } from './lib/settings.mjs'
import { generateRoster, sampleResponseCounts } from './lib/staff.mjs'
import { openingTimesForRun } from './lib/time.mjs'
import { compilePromptParts } from './lib/promptCompiler.mjs'
import { validateTickets, assembleTickets } from './lib/validate.mjs'
import { rngFor } from './lib/rng.mjs'
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

// Compile prompt files for a round and write its manifest. Shared by `plan` and `topup`.
function buildRound(ctx, outDir, round, count) {
  const gen = ctx.settings
  const specs = splitBatches(count, ctx.batchSize)
  const batches = specs.map((batchCount, index) => {
    const responseCounts = gen.includeStaffResponses
      ? sampleResponseCounts(batchCount, gen.avgStaffResponses, rngFor(ctx.seed, 'resp', round, index))
      : undefined
    const { dynamic } = compilePromptParts({
      editablePrompt: ctx.prompt,
      batchCount,
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

  const seed = args.seed !== undefined ? Number(args.seed) >>> 0 : (Date.now() >>> 0)
  const nowMs = Date.now()
  const batchSize = args['batch-size'] !== undefined ? Math.max(1, Number(args['batch-size'])) : DEFAULT_BATCH_SIZE

  const roster = generateRoster(settings.numStaffMembers)
  const openingTimes = openingTimesForRun(settings.numTickets, settings.maxTicketAgeDays, nowMs, rngFor(seed, 'opening'))

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
    seed,
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
    tickets: []
  }

  const manifest = buildRound(ctx, outDir, 0, settings.numTickets)
  writeJson(join(outDir, 'run-context.json'), ctx)

  console.log(`PLANNED ${settings.numTickets} ticket(s), batchSize=${batchSize}, staff=${settings.includeStaffResponses}, roster=${roster.length}, seed=${seed}`)
  console.log(`OUT ${outDir}`)
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
  const manifest = buildRound(ctx, outDir, round, shortfall)
  writeJson(join(outDir, 'run-context.json'), ctx)
  console.log(`TOPUP round ${round}: shortfall=${shortfall}`)
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
  const assembleRng = rngFor(ctx.seed, 'assemble', round)
  const timeCtx = {
    nowMs: ctx.nowMs,
    rng: assembleRng,
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
  case 'topup':
    cmdTopup(args)
    break
  case 'assemble':
    cmdAssemble(args)
    break
  default:
    console.error('Usage: engine.mjs <plan|topup|assemble> [options]  (see file header)')
    process.exit(1)
}
