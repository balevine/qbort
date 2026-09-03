import { z } from 'zod'
import type { TicketFile } from './types'

/**
 * Schema for a *loaded* tickets file. This guards the viewer against files that don't match the
 * current shape — most importantly older files from before the `messages[]` migration (flat
 * `body`/`responses`, string ids), which would otherwise render past `messages[0]` and crash the
 * renderer into a blank page. A file that fails this check is treated as "no file" (empty state).
 *
 * Structure is validated strictly (that's what makes the viewer safe); `status`/`provider` stay
 * permissive strings so a merely-unusual-but-renderable file isn't needlessly rejected.
 */
const authorSchema = z.object({ name: z.string(), email: z.string() })

const messageSchema = z.object({
  from: authorSchema,
  body: z.string(),
  isStaff: z.boolean(),
  createdAt: z.string()
})

const ticketSchema = z.object({
  id: z.number(),
  subject: z.string(),
  status: z.string(),
  messages: z.array(messageSchema).min(1) // opening message must exist
})

const pricingSchema = z.object({
  inputPerM: z.number(),
  outputPerM: z.number(),
  currency: z.string()
})

const usageSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  totalTokens: z.number(),
  batches: z.number(),
  estimatedCostUsd: z.number(),
  actualCostUsd: z.number(),
  pricing: pricingSchema,
  durationMs: z.number()
})

const metaSchema = z
  .object({
    generatedAt: z.string(),
    appVersion: z.string(),
    provider: z.string(),
    model: z.string(),
    requestedCount: z.number(),
    generatedCount: z.number(),
    // Optional so files without token/cost accounting (e.g. skill-generated runs) still load;
    // when present it must be well-formed, so a truncated/garbled usage block is still rejected.
    usage: usageSchema.optional()
  })
  .passthrough() // tolerate extra/future meta fields (e.g. settings snapshot)

export const ticketFileSchema = z.object({
  meta: metaSchema,
  tickets: z.array(ticketSchema)
})

/**
 * Parse an unknown value into a `TicketFile`, or `null` if it doesn't match the current shape.
 * Returns the original value on success (preserving any extra fields) — the schema is a runtime
 * gate, intentionally more permissive than the nominal `TicketFile` type.
 */
export function parseTicketFile(value: unknown): TicketFile | null {
  return ticketFileSchema.safeParse(value).success ? (value as TicketFile) : null
}
