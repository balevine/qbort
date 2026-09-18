// The data model, as JSDoc typedefs. This file has no runtime exports. It exists so every other
// `lib/*.mjs` can name the shapes it takes and returns (`import('./types.mjs').Ticket`) without
// depending on a TypeScript declaration file, which would not survive the plugin's "dependency-free
// ESM, no build step" rule.
//
// A ticket is a conversation: `messages[0]` is the customer's opening message and the rest are
// replies in order. `id`, `isStaff`, and `createdAt` are assigned by the engine, never by the model.

export {} // makes this a module, so the typedefs below are importable

/**
 * @typedef {'new' | 'open' | 'pending' | 'on-hold' | 'solved' | 'closed'} TicketStatus
 */

/**
 * @typedef {object} TicketAuthor
 * @property {string} name
 * @property {string} email
 */

/**
 * @typedef {object} TicketMessage
 * @property {TicketAuthor} from
 * @property {string} body
 * @property {boolean} isStaff  derived from the email domain, never taken from the model
 * @property {string} createdAt ISO-8601, strictly increasing within a ticket
 */

/**
 * @typedef {object} Ticket
 * @property {number} id
 * @property {string} subject
 * @property {TicketStatus} status
 * @property {TicketMessage[]} messages  at least one (`messages[0]` is the opening message)
 */

/**
 * A message before the engine assigns its `createdAt`.
 * @typedef {Omit<TicketMessage, 'createdAt'>} DraftMessage
 */

/**
 * A ticket before the engine assigns its id and message timestamps.
 * @typedef {object} DraftTicket
 * @property {string} subject
 * @property {TicketStatus} status
 * @property {DraftMessage[]} messages
 */

/**
 * @typedef {object} StaffMember
 * @property {string} name
 * @property {string} alias  email local-part, so `alias@company.biz` is the address
 */

/**
 * @typedef {object} GenerationSettings
 * @property {number} numTickets
 * @property {boolean} includeStaffResponses
 * @property {number} avgStaffResponses
 * @property {number} numStaffMembers
 * @property {number} maxTicketAgeDays
 */

/**
 * The `meta` block of a written `tickets.json`. Extra fields are tolerated on load.
 * @typedef {object} TicketFileMeta
 * @property {string} generatedAt
 * @property {string} appVersion
 * @property {string} provider
 * @property {string} model
 * @property {number} requestedCount
 * @property {number} generatedCount
 */

/**
 * @typedef {object} TicketFile
 * @property {TicketFileMeta} meta
 * @property {Ticket[]} tickets
 */
