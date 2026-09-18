// The definition of the `tickets.json` format. The engine runs its own finished file through it
// before the atomic write, because the producer and the viewer live in different repos, and a
// producer with no definition of what it produces is how the two drift apart without either one
// ever failing.
//
// Structure is validated strictly, which is what makes a file safe to hand to a renderer. `status`
// and `provider` stay permissive strings so a merely-unusual-but-renderable file isn't needlessly
// rejected, and unknown `meta` fields are tolerated so the format can grow.

/**
 * @typedef {import('./types.mjs').TicketFile} TicketFile
 */

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isString(v) {
  return typeof v === 'string'
}

function isNumber(v) {
  return typeof v === 'number' && Number.isFinite(v)
}

function isAuthor(v) {
  return isObject(v) && isString(v.name) && isString(v.email)
}

function isMessage(v) {
  return isObject(v) && isAuthor(v.from) && isString(v.body) && typeof v.isStaff === 'boolean' && isString(v.createdAt)
}

function isTicket(v) {
  return (
    isObject(v) &&
    isNumber(v.id) &&
    isString(v.subject) &&
    isString(v.status) &&
    Array.isArray(v.messages) &&
    v.messages.length >= 1 && // the opening message must exist
    v.messages.every(isMessage)
  )
}

function isMeta(v) {
  return (
    isObject(v) &&
    isString(v.generatedAt) &&
    isString(v.appVersion) &&
    isString(v.provider) &&
    isString(v.model) &&
    isNumber(v.requestedCount) &&
    isNumber(v.generatedCount)
  )
}

/**
 * Whether a value matches the current tickets-file shape.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isTicketFile(value) {
  return isObject(value) && isMeta(value.meta) && Array.isArray(value.tickets) && value.tickets.every(isTicket)
}

/**
 * Parse an unknown value into a `TicketFile`, or `null` if it doesn't match the current shape.
 * Returns the original value on success, preserving any extra fields. This is a runtime gate,
 * intentionally more permissive than the nominal `TicketFile` shape.
 * @param {unknown} value
 * @returns {TicketFile | null}
 */
export function parseTicketFile(value) {
  return isTicketFile(value) ? /** @type {TicketFile} */ (value) : null
}
