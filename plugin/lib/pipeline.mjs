// Shared pipeline helpers for batch generation and orchestration.
// Shared between the skill CLI (`engine.mjs`) and the MCP server (`plugin/mcp/server.mjs`).

import { join } from 'node:path'

import { atomicWriteJson, atomicWriteText } from './fsUtil.mjs'
import { compilePromptParts } from './promptCompiler.mjs'
import { sampleResponseCounts } from './staff.mjs'

/**
 * Split a total count of tickets into batch sizes, with the remainder in the last batch.
 * @param {number} count
 * @param {number} batchSize
 * @returns {number[]}
 */
export function splitBatches(count, batchSize) {
  const specs = []
  for (let start = 0; start < count; start += batchSize) {
    specs.push(Math.min(batchSize, count - start))
  }
  return specs
}

/**
 * Fisher-Yates shuffle over a shallow copy.
 * @template T
 * @param {T[]} list
 * @param {() => number} [rng]
 * @returns {T[]}
 */
export function shuffled(list, rng = Math.random) {
  const out = list.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/**
 * Compile prompt files for a round and write its manifest.
 * Deals scenarios off the context's list, advancing `scenarioCursor` as batches are built.
 * A round that outruns the reserve simply gets fewer scenarios than tickets.
 *
 * @param {any} ctx
 * @param {number} round
 * @param {number} count
 * @param {string} scratchDir
 * @returns {Promise<{ round: number, batches: Array<{ index: number, count: number, promptFile: string, batchFile: string, promptText: string }> }>}
 */
export async function buildRound(ctx, round, count, scratchDir) {
  const gen = ctx.settings
  if (typeof ctx.scenarioCursor !== 'number') ctx.scenarioCursor = 0
  const specs = splitBatches(count, ctx.batchSize)
  const batches = []
  for (const [index, batchCount] of specs.entries()) {
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
    const promptFile = join(scratchDir, `prompt-${round}-${index}.txt`)
    const batchFile = join(scratchDir, `batch-${round}-${index}.json`)
    const promptText = `${ctx.staticPrefix}\n\n${dynamic}\n`
    await atomicWriteText(promptFile, promptText)
    batches.push({ index, count: batchCount, promptFile, batchFile, promptText })
  }
  const manifest = { round, batches }
  await atomicWriteJson(join(scratchDir, `round-${round}.json`), manifest)
  return manifest
}
