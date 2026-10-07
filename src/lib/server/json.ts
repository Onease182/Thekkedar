// JSON field encode/decode helpers — SQLite stores TEXT, app stores JSON-string.
import { db } from '@/lib/db'

/** Stringify a JSON field for storage; returns "{}" for null. */
export function encodeJson(value: unknown): string {
  if (value === null || value === undefined) return '{}'
  return JSON.stringify(value)
}

export function encodeJsonArray(value: unknown): string {
  if (value === null || value === undefined) return '[]'
  return JSON.stringify(value)
}

export function decodeJson<T = unknown>(value: string | null): T | null {
  if (!value) return null
  try {
    return JSON.parse(value) as T
  } catch {
    return null
  }
}

/** Returns current UTC ISO timestamp. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Safe parsing of date strings from query parameters. */
export function parseDate(value: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  if (isNaN(d.getTime())) return null
  return d
}

/** Convert a Date|null to ISO string for API responses. */
export function toIso(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

/** Close the Prisma connection — only used in test teardown. */
export async function disconnectDb(): Promise<void> {
  await db.$disconnect()
}
