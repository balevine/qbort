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

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { parseArgs } from '../plugin/lib/args.mjs'
import { readJson } from '../plugin/lib/fsUtil.mjs'
import { OUTPUT_DIR, newestOutputName } from '../plugin/lib/paths.mjs'
import { parseTicketFile } from '../plugin/lib/ticketFile.mjs'

const DEFAULT_LIMIT = 50
const DEFAULT_FULL_LIMIT = 5
const FALLBACK_WIDTH = 100

// ── pure helpers ──────────────────────────────────────────────────────────────

/**
 * The newest run's output file, which is what someone typing no arguments almost always wants.
 * Which name is newest is the engine's naming scheme to know, so that part lives in `lib/paths.mjs`.
 * @returns {string | null} absolute path, or null when there is nothing to read
 */
function newestOutputPath() {
  let names = []
  try {
    names = readdirSync(resolve(OUTPUT_DIR))
  } catch {
    return null
  }
  const newest = newestOutputName(names)
  return newest === null ? null : join(resolve(OUTPUT_DIR), newest)
}

/**
 * Expand an id spec into a Set: `7`, `3,9`, `10-20`, or any comma-separated mix of those.
 * Returns null if the spec contains nothing usable, so the caller can complain rather than
 * silently select every ticket.
 * @param {string} spec
 * @returns {Set<number> | null}
 */
function parseIdSpec(spec) {
  const ids = new Set()
  for (const part of spec.split(',')) {
    const piece = part.trim()
    if (!piece) continue
    const range = piece.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])]
      // Tolerate a reversed range rather than returning nothing for an obvious typo.
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) ids.add(i)
    } else if (/^\d+$/.test(piece)) ids.add(Number(piece))
    else return null
  }
  return ids.size ? ids : null
}

/**
 * Apply the id/status/search filters, in that order.
 * @param {import('../plugin/lib/types.mjs').Ticket[]} tickets
 * @param {{ ids?: Set<number> | null, statuses?: Set<string> | null, search?: string | null }} filters
 * @returns {import('../plugin/lib/types.mjs').Ticket[]}
 */
function selectTickets(tickets, { ids, statuses, search } = {}) {
  const needle = search ? search.toLowerCase() : null
  return tickets.filter((t) => {
    if (ids && !ids.has(t.id)) return false
    if (statuses && !statuses.has(t.status.toLowerCase())) return false
    if (needle) {
      const haystack = [t.subject, ...t.messages.map((m) => m.body)].join('\n').toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    return true
  })
}

/**
 * Greedy word wrap. Words longer than the width are hard-split so a pasted stack trace or URL
 * cannot blow past the column budget. Blank lines are preserved, because the bodies are prose and
 * their paragraph breaks carry meaning.
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
function wrapText(text, width) {
  const lines = []
  for (const paragraph of text.replace(/\r\n/g, '\n').split('\n')) {
    if (!paragraph.trim()) {
      lines.push('')
      continue
    }
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      let w = word
      while (w.length > width) {
        if (line) {
          lines.push(line)
          line = ''
        }
        lines.push(w.slice(0, width))
        w = w.slice(width)
      }
      if (!line) line = w
      else if (line.length + 1 + w.length <= width) line += ` ${w}`
      else {
        lines.push(line)
        line = w
      }
    }
    if (line) lines.push(line)
  }
  return lines
}

/** @param {string} s @param {number} width */
function truncate(s, width) {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`
}

/** Counts for the `--stats` block and the list footer. */
function summarize(tickets) {
  /** @type {Record<string, number>} */
  const byStatus = {}
  let messages = 0
  let staffReplies = 0
  let unanswered = 0
  let earliest = null
  let latest = null
  for (const t of tickets) {
    byStatus[t.status] = (byStatus[t.status] ?? 0) + 1
    messages += t.messages.length
    const staff = t.messages.filter((m) => m.isStaff).length
    staffReplies += staff
    if (staff === 0) unanswered++
    for (const m of t.messages) {
      if (earliest === null || m.createdAt < earliest) earliest = m.createdAt
      if (latest === null || m.createdAt > latest) latest = m.createdAt
    }
  }
  const n = tickets.length || 1
  return {
    count: tickets.length,
    byStatus,
    messages,
    staffReplies,
    unanswered,
    avgMessages: messages / n,
    avgStaffReplies: staffReplies / n,
    earliest,
    latest
  }
}

/** ISO-8601 to `YYYY-MM-DD HH:MM`, without pulling in a formatter or a timezone opinion. */
function stamp(iso, dateOnly = false) {
  return dateOnly ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ')
}

// ── rendering ─────────────────────────────────────────────────────────────────

// A `let`, because `--no-color` is only known once args are parsed further down, and the closures
// below read it at call time. Off by default when stdout is not a TTY, which is what keeps the
// escape codes out of a pipe or an agent's context.
let useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
/** @type {Record<string, (s: string) => string>} */
const paint = {}
for (const [name, code] of Object.entries({ dim: 2, bold: 1, cyan: 36, yellow: 33 })) {
  paint[name] = (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s)
}

function renderList(tickets, width) {
  const idWidth = Math.max(2, ...tickets.map((t) => String(t.id).length))
  const statusWidth = Math.max(6, ...tickets.map((t) => t.status.length))
  const out = []
  for (const t of tickets) {
    const staff = t.messages.filter((m) => m.isStaff).length
    const counts = `${String(t.messages.length).padStart(2)} msg ${String(staff).padStart(2)} staff`
    const head = `${String(t.id).padStart(idWidth)}  ${t.status.padEnd(statusWidth)}  ${counts}  ${stamp(t.messages[0].createdAt, true)}  `
    out.push(paint.dim(head.slice(0, head.length - 2)) + '  ' + truncate(t.subject, Math.max(20, width - head.length)))
  }
  return out
}

function renderThread(t, width) {
  const out = []
  out.push('')
  out.push(paint.bold(`#${t.id}  ${t.subject}`))
  out.push(paint.dim(`${t.status} · ${t.messages.length} messages · ${t.messages.filter((m) => m.isStaff).length} staff`))
  for (const m of t.messages) {
    const who = m.isStaff ? paint.cyan(m.from.name) : paint.yellow(m.from.name)
    out.push('')
    out.push(`  ${m.isStaff ? '↩' : '✉'} ${who} ${paint.dim(`<${m.from.email}> · ${stamp(m.createdAt)}`)}`)
    for (const line of wrapText(m.body, Math.max(40, width - 4))) out.push(line ? `    ${line}` : '')
  }
  return out
}

function renderStats(meta, s) {
  const out = []
  out.push(paint.bold(`${s.count} tickets`))
  out.push(
    paint.dim(
      `generated ${stamp(meta.generatedAt)} · qbort ${meta.appVersion} · ${meta.provider}/${meta.model} · requested ${meta.requestedCount}, generated ${meta.generatedCount}`
    )
  )
  if (!s.count) return out
  out.push('')
  const statusWidth = Math.max(...Object.keys(s.byStatus).map((k) => k.length))
  for (const [status, n] of Object.entries(s.byStatus).sort((a, b) => b[1] - a[1])) {
    const pct = ((n / s.count) * 100).toFixed(0)
    out.push(`  ${status.padEnd(statusWidth)}  ${String(n).padStart(4)}  ${paint.dim(`${pct}%`)}`)
  }
  out.push('')
  out.push(`  messages        ${String(s.messages).padStart(4)}  ${paint.dim(`avg ${s.avgMessages.toFixed(2)} per ticket`)}`)
  out.push(`  staff replies   ${String(s.staffReplies).padStart(4)}  ${paint.dim(`avg ${s.avgStaffReplies.toFixed(2)} per ticket`)}`)
  out.push(`  no staff reply  ${String(s.unanswered).padStart(4)}  ${paint.dim(`${((s.unanswered / s.count) * 100).toFixed(0)}%`)}`)
  if (s.earliest) out.push(`  span            ${paint.dim(`${stamp(s.earliest, true)} → ${stamp(s.latest, true)}`)}`)
  return out
}

// ── main ──────────────────────────────────────────────────────────────────────

function fail(message) {
  console.error(message)
  process.exit(1)
}

const args = parseArgs(process.argv.slice(2))
if (args['no-color']) useColor = false
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
  console.log(renderStats(file.meta, summarize(selected)).join('\n'))
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

console.log((full ? shown.flatMap((t) => renderThread(t, width)) : renderList(shown, width)).join('\n'))

const filtered = selected.length !== file.tickets.length ? ` (filtered from ${file.tickets.length})` : ''
const footer = `showing ${start + 1}-${start + shown.length} of ${selected.length}${filtered}`
const next = page < pages ? ` · next: --page ${page + 1}` : ''
console.log('')
console.log(paint.dim(pages > 1 ? `${footer} · page ${page}/${pages}${next}` : footer))
