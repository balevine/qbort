import { describe, expect, it } from 'vitest'
import { OUTPUT_DIR, SCRATCH_DIR, newestOutputName, outputFileName } from '@lib/paths.mjs'

describe('the run directories', () => {
  it('keeps the product outside the directory that gets wiped', () => {
    // The whole point of the split. If these ever nest, `plan` starts deleting finished runs.
    expect(SCRATCH_DIR).toBe('.qbort-run')
    expect(OUTPUT_DIR).toBe('qbort-output')
    expect(OUTPUT_DIR.startsWith(SCRATCH_DIR)).toBe(false)
  })
})

describe('outputFileName', () => {
  it('builds tickets-YYYYMMDD-HHMMSS.json in local time', () => {
    // Constructed from local parts so the expectation does not depend on the runner's timezone.
    expect(outputFileName(new Date(2026, 8, 18, 13, 47, 52))).toBe('tickets-20260918-134752.json')
  })

  it('zero-pads every field, so names are fixed-width and sort as text', () => {
    expect(outputFileName(new Date(2026, 0, 2, 3, 4, 5))).toBe('tickets-20260102-030405.json')
  })

  it('orders lexically the way the runs happened', () => {
    const earlier = outputFileName(new Date(2026, 8, 18, 9, 59, 59))
    const later = outputFileName(new Date(2026, 8, 18, 10, 0, 0))
    expect(earlier < later).toBe(true)
  })
})

describe('newestOutputName', () => {
  it('picks the most recent name', () => {
    expect(
      newestOutputName([
        'tickets-20260918-134752.json',
        'tickets-20270101-000000.json',
        'tickets-20260101-235959.json'
      ])
    ).toBe('tickets-20270101-000000.json')
  })

  it('ignores anything that is not an output file', () => {
    // A viewer pointed at a directory of junk should say it found nothing, not try to read the junk.
    expect(newestOutputName(['README.md', 'tickets.json', 'tickets-2026-09-18.json', '.DS_Store'])).toBeNull()
    expect(newestOutputName(['notes.txt', 'tickets-20260918-134752.json'])).toBe('tickets-20260918-134752.json')
  })

  it('returns null for an empty directory', () => {
    expect(newestOutputName([])).toBeNull()
  })
})
