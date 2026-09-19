#!/usr/bin/env node
// Terminal reader for a generated `tickets.json`. A dev convenience, not part of the shipped
// plugin: it reads the output format rather than producing it, so it lives outside `plugin/` and
// nothing under `plugin/` imports it.
//
// It does go through `lib/ticketFile.mjs` to load, because a viewer that accepts a file the engine
// would have refused to write is a viewer that disagrees with the format.
//
// Output is bounded by default. A run can hold hundreds of tickets, and neither a terminal
// scrollback nor an agent's context wants all of them at once, so list mode paginates at 50 and
// thread mode at 5. `--limit 0` opts out.
//
//   node scripts/view-tickets.mjs [file] [options]
//
//   file              path to a tickets file (default: the newest one in qbort-output/)
//   --id <spec>       full threads for these ids: `7`, `3,9`, `10-20` (implies --full)
//   --status <list>   keep only these statuses, comma-separated
//   --search <text>   keep only tickets whose subject or any message body contains text
//   --full            print whole threads instead of one line per ticket
//   --limit <n>       tickets per page (default 50, or 5 with --full; 0 means all)
//   --page <n>        1-based page (default 1)
//   --stats           summarize the selection and exit
//   --json            emit the selection as JSON instead of text
//   --width <n>       wrap width (default: terminal width, else 100)
//   --no-color        disable ANSI colour (already off when stdout is not a TTY)

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseArgs } from '../plugin/lib/args.mjs'
import { readJson } from '../plugin/lib/fsUtil.mjs'
import { OUTPUT_DIR } from '../plugin/lib/paths.mjs'
import { parseTicketFile } from '../plugin/lib/ticketFile.mjs'
import {
  newestOutputPath,
  parseIdSpec,
  selectTickets,
  summarize,
  renderList,
  renderThread,
  renderStats,
  createPainter
} from '../plugin/lib/viewer.mjs'

const DEFAULT_LIMIT = 50
const DEFAULT_FULL_LIMIT = 5
const FALLBACK_WIDTH = 100


// ── main ──────────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(message)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
let useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
if (args['no-color']) useColor = false
const paint = createPainter(useColor)
if (args.help || args.h) {
  // The header comment is the usage text, so there is only one copy of it to keep correct. Take

  // the leading block only, stopping at the first line that is not part of it.
  const header = []
  for (const line of readFileSync(new URL(import.meta.url), 'utf-8').split('\n').slice(1)) {
    if (!line.startsWith('//')) break
    header.push(line.replace(/^\/\/ ?/, ''))
  }
  console.log(header.join('\n').trim())
  process.exit(0)
}

const explicit = typeof args.file === 'string' ? args.file : args._[0]
const filePath = explicit !== undefined ? resolve(explicit) : newestOutputPath()
if (filePath === null) {
  fail(`No ticket files in ${resolve(OUTPUT_DIR)}. Pass a path, or generate a run first.`)
}
const raw = await readJson(filePath)
if (raw === null) fail(`Could not read ${filePath}.`)
const file = parseTicketFile(raw)
if (!file) fail(`${filePath} is not a valid tickets.json (it does not match the current format).`)

const ids = typeof args.id === 'string' ? parseIdSpec(args.id) : null
if (typeof args.id === 'string' && !ids) fail(`Could not read --id "${args.id}". Use 7, 3,9, or 10-20.`)
const statuses =
  typeof args.status === 'string'
    ? new Set(
        args.status
          .split(',')
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean)
      )
    : null
const search = typeof args.search === 'string' ? args.search : null

const selected = selectTickets(file.tickets, { ids, statuses, search })
const width = Number(args.width) || process.stdout.columns || FALLBACK_WIDTH

if (args.json) {
  console.log(JSON.stringify({ meta: file.meta, tickets: selected }, null, 2))
  process.exit(0)
}
if (args.stats) {
  console.log(renderStats(file.meta, summarize(selected), useColor).join('\n'))
  process.exit(0)
}
if (!selected.length) {
  console.log(`No tickets matched (file holds ${file.tickets.length}).`)
  process.exit(0)
}

// An explicit --id is already a bounded selection, so it shows threads and skips paging.
const full = Boolean(args.full) || Boolean(ids)
const limit = args.limit !== undefined ? Number(args.limit) : ids ? 0 : full ? DEFAULT_FULL_LIMIT : DEFAULT_LIMIT
if (!Number.isFinite(limit) || limit < 0) fail(`--limit must be a non-negative number.`)
const page = args.page !== undefined ? Number(args.page) : 1
if (!Number.isInteger(page) || page < 1) fail(`--page must be a positive integer.`)

const perPage = limit === 0 ? selected.length : limit
const pages = Math.max(1, Math.ceil(selected.length / perPage))
if (page > pages) fail(`--page ${page} is past the end (${pages} page${pages === 1 ? '' : 's'}).`)
const start = (page - 1) * perPage
const shown = selected.slice(start, start + perPage)

console.log((full ? shown.flatMap((t) => renderThread(t, width, useColor)) : renderList(shown, width, useColor)).join('\n'))

const filtered = selected.length !== file.tickets.length ? ` (filtered from ${file.tickets.length})` : ''
const footer = `showing ${start + 1}-${start + shown.length} of ${selected.length}${filtered}`
const next = page < pages ? ` · next: --page ${page + 1}` : ''
console.log('')
console.log(paint.dim(pages > 1 ? `${footer} · page ${page}/${pages}${next}` : footer))
