import { describe, expect, it } from 'vitest'
import { parseArgs } from '@lib/args.mjs'

describe('parseArgs', () => {
  it('reads `--flag value` pairs as strings', () => {
    expect(parseArgs(['--out', '.qbort-run', '--count', '25'])).toEqual({
      _: [],
      out: '.qbort-run',
      count: '25'
    })
  })

  it('treats a flag with no value as boolean true', () => {
    expect(parseArgs(['--staff'])).toEqual({ _: [], staff: true })
    expect(parseArgs(['--staff', '--count', '5'])).toEqual({ _: [], staff: true, count: '5' })
  })

  it('collects bare arguments in `_` rather than mistaking one for a value', () => {
    expect(parseArgs(['stray', '--count', '5'])).toEqual({ _: ['stray'], count: '5' })
  })

  it('lets a later flag win over an earlier one', () => {
    expect(parseArgs(['--count', '5', '--count', '9']).count).toBe('9')
  })

  it('returns only the bucket for empty argv', () => {
    expect(parseArgs([])).toEqual({ _: [] })
  })

  it('keeps negative numbers as values, since they are not `--` flags', () => {
    expect(parseArgs(['--avg', '-1']).avg).toBe('-1')
  })
})
