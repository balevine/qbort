// The plugin's version has exactly one home: plugin/.claude-plugin/plugin.json. That file is not
// ours to choose (the Claude Code plugin system requires it and installs by the version in it), so
// anything else that needs the number reads it from there rather than keeping a second copy.

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readJson } from './fsUtil.mjs'

/** Resolved from this file, so it follows the plugin wherever it is installed. */
const MANIFEST_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', '.claude-plugin', 'plugin.json')

/**
 * Stamped into `tickets.json` when the manifest can't be read. The format requires `appVersion` to
 * be a string, so there has to be a fallback, and a run is not worth failing over a metadata stamp.
 * It reads as obviously-not-a-version on purpose: a real version here would hide a broken install.
 */
export const UNKNOWN_VERSION = 'unknown'

/**
 * The installed plugin's version, from its manifest.
 * @param {string} [manifestPath] override, for tests
 * @returns {Promise<string>} the manifest's `version`, or `UNKNOWN_VERSION`
 */
export async function pluginVersion(manifestPath = MANIFEST_PATH) {
  const manifest = await readJson(manifestPath)
  const version = manifest && typeof manifest === 'object' ? manifest.version : null
  return typeof version === 'string' && version.length > 0 ? version : UNKNOWN_VERSION
}
