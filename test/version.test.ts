import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UNKNOWN_VERSION, pluginVersion } from '@lib/version.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const MANIFEST = resolve(here, '../plugin/.claude-plugin/plugin.json')

let dir: string
beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'qbort-version-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Write a manifest into the temp dir and return its path. */
async function manifest(contents: string): Promise<string> {
  const path = join(dir, 'plugin.json')
  await fs.writeFile(path, contents, 'utf-8')
  return path
}

describe('pluginVersion', () => {
  it('defaults to the real plugin manifest, which is the single source of the version', async () => {
    const declared = JSON.parse(await fs.readFile(MANIFEST, 'utf-8')).version
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
    expect(await pluginVersion()).toBe(declared)
  })

  it('reads the version from the given manifest', async () => {
    expect(await pluginVersion(await manifest('{"name":"qbort","version":"9.9.9"}'))).toBe('9.9.9')
  })

  // Every fallback below still returns a string, because the tickets.json format requires one and a
  // run is not worth failing over a metadata stamp.
  it('falls back when the manifest is missing', async () => {
    expect(await pluginVersion(join(dir, 'nope.json'))).toBe(UNKNOWN_VERSION)
  })

  it('falls back when the manifest is not valid JSON', async () => {
    expect(await pluginVersion(await manifest('{ not json'))).toBe(UNKNOWN_VERSION)
  })

  it('falls back when version is missing, empty, or the wrong type', async () => {
    expect(await pluginVersion(await manifest('{"name":"qbort"}'))).toBe(UNKNOWN_VERSION)
    expect(await pluginVersion(await manifest('{"version":""}'))).toBe(UNKNOWN_VERSION)
    expect(await pluginVersion(await manifest('{"version":2}'))).toBe(UNKNOWN_VERSION)
    expect(await pluginVersion(await manifest('null'))).toBe(UNKNOWN_VERSION)
  })
})
