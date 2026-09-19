// Reader, query, and rendering helpers for tickets.json files. Shared by the terminal viewer
// (`scripts/view-tickets.mjs`) and the MCP server (`plugin/mcp/server.mjs`).
//
// The engine owns structural generation; this module owns structural inspection, filtering, and
// formatting of finished runs.

import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { OUTPUT_DIR, newestOutputName } from './paths.mjs'

/**
 * Find the path to the newest output file in the given output directory.
 * @param {string} [outputDir] defaults to the canonical OUTPUT_DIR
 * @returns {string | null} absolute path or null when no output file exists
 */
export function newestOutputPath(outputDir = OUTPUT_DIR) {
  let names = []
  try {
    names = readdirSync(resolve(outputDir))
  } catch {
    return null
  }
  const newest = newestOutputName(names)
  return newest === null ? null : join(resolve(outputDir), newest)
}

/**
 * Expand an id specification into a Set of numbers: `7`, `3,9`, `10-20`, or combinations.
 * Returns null if the specification contains nothing usable.
 * @param {string} spec
 * @returns {Set<number> | null}
 */
export function parseIdSpec(spec) {
  const ids = new Set()
  for (const part of spec.split(',')) {
    const piece = part.trim()
    if (!piece) continue
    const range = piece.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])]
      for (let i = Math.min(from, to); i <= Math.max(from, to); i++) ids.add(i)
    } else if (/^\d+$/.test(piece)) {
      ids.add(Number(piece))
    } else {
      return null
    }
  }
  return ids.size ? ids : null
}

/**
 * Filter tickets by id set, allowed statuses, and keyword search across subject and bodies.
 * @param {import('./types.mjs').Ticket[]} tickets
 * @param {{ ids?: Set<number> | null, statuses?: Set<string> | null, search?: string | null }} [filters]
 * @returns {import('./types.mjs').Ticket[]}
 */
export function selectTickets(tickets, { ids, statuses, search } = {}) {
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
 * Greedy word wrap for message bodies. Long words are split so they never exceed column budget.
 * @param {string} text
 * @param {number} width
 * @returns {string[]}
 */
export function wrapText(text, width) {
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

/**
 * Truncate a single line to a maximum width.
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
export function truncate(s, width) {
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= width ? flat : `${flat.slice(0, Math.max(0, width - 1))}…`
}

/**
 * Calculate statistical metrics for a ticket list.
 * @param {import('./types.mjs').Ticket[]} tickets
 */
export function summarize(tickets) {
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

/**
 * Format ISO timestamp to `YYYY-MM-DD HH:MM` or date only.
 * @param {string} iso
 * @param {boolean} [dateOnly]
 * @returns {string}
 */
export function stamp(iso, dateOnly = false) {
  return dateOnly ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ')
}

/**
 * Create color painting helper for rendering.
 * @param {boolean} useColor
 */
export function createPainter(useColor) {
  /** @type {Record<string, (s: string) => string>} */
  const paint = {}
  for (const [name, code] of Object.entries({ dim: 2, bold: 1, cyan: 36, yellow: 33 })) {
    paint[name] = (s) => (useColor ? `\u001b[${code}m${s}\u001b[0m` : s)
  }
  return paint
}

/**
 * Render ticket list rows.
 * @param {import('./types.mjs').Ticket[]} tickets
 * @param {number} width
 * @param {boolean} [useColor]
 * @returns {string[]}
 */
export function renderList(tickets, width, useColor = false) {
  const paint = createPainter(useColor)
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

/**
 * Render complete ticket thread.
 * @param {import('./types.mjs').Ticket} t
 * @param {number} width
 * @param {boolean} [useColor]
 * @returns {string[]}
 */
export function renderThread(t, width, useColor = false) {
  const paint = createPainter(useColor)
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

/**
 * Render summary statistics block.
 * @param {import('./types.mjs').TicketFileMeta} meta
 * @param {ReturnType<typeof summarize>} s
 * @param {boolean} [useColor]
 * @returns {string[]}
 */
export function renderStats(meta, s, useColor = false) {
  const paint = createPainter(useColor)
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
