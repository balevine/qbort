import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Importing secrets.ts pulls in `electron` for the default crypto; stub it so tests run
// outside an Electron runtime. The tests below inject their own fake crypto regardless.
vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s),
    decryptString: (b: Buffer) => b.toString()
  }
}))

import { SecretStore, type SecretCrypto } from './secrets'

/** Reversible fake "encryption" so we can assert plaintext is never stored at rest. */
function makeFakeCrypto(available = true): SecretCrypto {
  return {
    isAvailable: () => available,
    encrypt: (plaintext) => Buffer.from(`enc:${plaintext}`, 'utf-8'),
    decrypt: (ciphertext) => ciphertext.toString('utf-8').replace(/^enc:/, '')
  }
}

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'tg-secrets-'))
})
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('SecretStore', () => {
  it('round-trips a key: set → has → get', async () => {
    const store = new SecretStore(dir, makeFakeCrypto())
    expect(await store.hasKey('anthropic')).toBe(false)

    expect(await store.setKey('anthropic', 'sk-test-123')).toBe(true)
    expect(await store.hasKey('anthropic')).toBe(true)
    expect(await store.getKey('anthropic')).toBe('sk-test-123')
  })

  it('stores ciphertext at rest, never plaintext', async () => {
    const store = new SecretStore(dir, makeFakeCrypto())
    await store.setKey('anthropic', 'super-secret-value')

    const onDisk = await fs.readFile(join(dir, 'secrets.json'), 'utf-8')
    expect(onDisk).not.toContain('super-secret-value')
    expect(onDisk).toContain(Buffer.from('enc:super-secret-value').toString('base64'))
  })

  it('clears a key', async () => {
    const store = new SecretStore(dir, makeFakeCrypto())
    await store.setKey('anthropic', 'a-key')
    expect(await store.clearKey('anthropic')).toBe(true)
    expect(await store.hasKey('anthropic')).toBe(false)
    expect(await store.getKey('anthropic')).toBeNull()
  })

  it('reports status for all hosted providers', async () => {
    const store = new SecretStore(dir, makeFakeCrypto())
    await store.setKey('anthropic', 'a')
    expect(await store.status()).toEqual({ anthropic: true })
  })

  it('rejects empty keys and throws when encryption is unavailable', async () => {
    expect(await new SecretStore(dir, makeFakeCrypto()).setKey('anthropic', '   ')).toBe(false)
    await expect(
      new SecretStore(dir, makeFakeCrypto(false)).setKey('anthropic', 'x')
    ).rejects.toThrow(/unavailable/i)
  })

  it('persists across store instances', async () => {
    await new SecretStore(dir, makeFakeCrypto()).setKey('anthropic', 'persist-me')
    const reloaded = new SecretStore(dir, makeFakeCrypto())
    expect(await reloaded.getKey('anthropic')).toBe('persist-me')
  })
})
