import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildRound, shuffled, splitBatches } from '@lib/pipeline.mjs'

describe('splitBatches', () => {
  it('splits exact multiples evenly', () => {
    expect(splitBatches(60, 20)).toEqual([20, 20, 20])
  })

  it('puts the remainder in the final batch', () => {
    expect(splitBatches(25, 20)).toEqual([20, 5])
    expect(splitBatches(7, 10)).toEqual([7])
  })

  it('handles empty or zero count', () => {
    expect(splitBatches(0, 20)).toEqual([])
  })
})

describe('shuffled', () => {
  it('preserves all items while permuting order', () => {
    const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    const result = shuffled(original)
    expect(result).toHaveLength(original.length)
    expect(result.sort((a, b) => a - b)).toEqual(original)
  })

  it('uses injectable rng for deterministic testing', () => {
    const original = ['a', 'b', 'c', 'd']
    let i = 0
    const fakeRng = () => [0.1, 0.5, 0.9][i++] ?? 0.5
    const result = shuffled(original, fakeRng)
    expect(result).toHaveLength(4)
    expect(new Set(result)).toEqual(new Set(original))
  })
})

describe('buildRound', () => {
  let scratchDir: string

  beforeEach(async () => {
    scratchDir = await fs.mkdtemp(join(tmpdir(), 'qbort-pipeline-test-'))
  })

  afterEach(async () => {
    await fs.rm(scratchDir, { recursive: true, force: true })
  })

  it('creates prompt and batch manifests for a round', async () => {
    const ctx = {
      prompt: 'Test prompt description',
      staticPrefix: 'STATIC PREFIX',
      batchSize: 2,
      settings: {
        includeStaffResponses: false,
        avgStaffResponses: 0
      },
      roster: [],
      scenarios: ['scenario 1', 'scenario 2', 'scenario 3', 'scenario 4'],
      scenarioCursor: 0
    }

    const manifest = await buildRound(ctx, 0, 4, scratchDir)
    expect(manifest.round).toBe(0)
    expect(manifest.batches).toHaveLength(2)
    expect(manifest.batches[0].count).toBe(2)
    expect(manifest.batches[1].count).toBe(2)
    expect(ctx.scenarioCursor).toBe(4)

    const roundJson = JSON.parse(await fs.readFile(join(scratchDir, 'round-0.json'), 'utf-8'))
    expect(roundJson.batches).toHaveLength(2)

    const prompt0 = await fs.readFile(manifest.batches[0].promptFile, 'utf-8')
    expect(prompt0).toContain('STATIC PREFIX')
    expect(prompt0).toContain('scenario 1')
  })
})
