import { join } from 'path'
import { safeStorage } from 'electron'
import type { ProviderId, SecretStatus } from '@shared/types'
import { HOSTED_PROVIDERS } from '@shared/types'
import { atomicWriteJson, readJson } from './fsUtil'

/**
 * Minimal crypto surface so the store can be unit-tested with a fake, and so it never
 * hard-depends on Electron's `safeStorage` at construction time.
 */
export interface SecretCrypto {
  isAvailable: () => boolean
  encrypt: (plaintext: string) => Buffer
  decrypt: (ciphertext: Buffer) => string
}

/** Real implementation backed by Electron `safeStorage` (OS keychain protects the key). */
export const electronCrypto: SecretCrypto = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plaintext) => safeStorage.encryptString(plaintext),
  decrypt: (ciphertext) => safeStorage.decryptString(ciphertext)
}

type SecretFile = Record<string, string> // provider → base64 ciphertext

/**
 * Stores API keys encrypted at rest. Plaintext keys never leave the main process and are
 * never returned over IPC — the renderer can only learn whether a key *is set*.
 */
export class SecretStore {
  private readonly file: string

  constructor(
    dir: string,
    private readonly crypto: SecretCrypto = electronCrypto
  ) {
    this.file = join(dir, 'secrets.json')
  }

  async setKey(provider: ProviderId, key: string): Promise<boolean> {
    if (!key || !key.trim()) return false
    if (!this.crypto.isAvailable()) {
      throw new Error('OS keychain encryption is unavailable on this system.')
    }
    const data = await this.read()
    data[provider] = this.crypto.encrypt(key.trim()).toString('base64')
    await this.write(data)
    return true
  }

  async hasKey(provider: ProviderId): Promise<boolean> {
    const data = await this.read()
    return typeof data[provider] === 'string' && data[provider].length > 0
  }

  async clearKey(provider: ProviderId): Promise<boolean> {
    const data = await this.read()
    if (!(provider in data)) return false
    delete data[provider]
    await this.write(data)
    return true
  }

  /** Map of hosted provider → whether a key is stored. */
  async status(): Promise<SecretStatus> {
    const data = await this.read()
    const out: SecretStatus = {}
    for (const p of HOSTED_PROVIDERS) out[p] = typeof data[p] === 'string' && data[p].length > 0
    return out
  }

  /**
   * Decrypt and return a stored key. MAIN-PROCESS ONLY — intentionally not exposed over
   * IPC. Used by provider adapters / connection tests. Returns null if absent.
   */
  async getKey(provider: ProviderId): Promise<string | null> {
    const data = await this.read()
    const enc = data[provider]
    if (!enc) return null
    if (!this.crypto.isAvailable()) return null
    try {
      return this.crypto.decrypt(Buffer.from(enc, 'base64'))
    } catch {
      return null
    }
  }

  private async read(): Promise<SecretFile> {
    const parsed = await readJson<SecretFile>(this.file)
    return parsed && typeof parsed === 'object' ? parsed : {}
  }

  private async write(data: SecretFile): Promise<void> {
    await atomicWriteJson(this.file, data)
  }
}
