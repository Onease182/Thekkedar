import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  withErrors,
  requireAuth,
  requireProjectMember,
  requireWrite,
  HttpError,
  readJson,
} from '@/lib/server/permissions'
import { MARKUP_TYPES } from '@/lib/server/constants'
import { toIso } from '@/lib/server/json'

// Matches a client-generated cuid for idempotent creates.
const CUID_RE = /^[a-z0-9]{20,}$/
const MAX_COORDS_LEN = 32000
const MAX_METADATA_LEN = 32000

interface MarkupWithCreator {
  id: string
  planId: string
  type: string
  pageNumber: number
  coordinates: string
  color: string
  metadata: string
  createdById: string
  createdBy?: { fullName: string } | null
  _count?: { attachments: number }
  createdAt: Date
  updatedAt: Date
}

function serializeMarkup(m: MarkupWithCreator) {
  return {
    id: m.id,
    planId: m.planId,
    type: m.type,
    pageNumber: m.pageNumber,
    coordinates: m.coordinates,
    color: m.color,
    metadata: m.metadata,
    createdById: m.createdById,
    createdByName: m.createdBy?.fullName ?? '',
    attachmentCount: m._count?.attachments ?? 0,
    createdAt: toIso(m.createdAt)!,
    updatedAt: toIso(m.updatedAt)!,
  }
}

async function getPlanOrFail(id: string) {
  const plan = await db.plan.findUnique({
    where: { id },
    select: { id: true, projectId: true },
  })
  if (!plan) throw new HttpError(404, 'plan_not_found', 'Plan not found.')
  return plan
}

/**
 * GET /api/plans/[planId]/markups
 * Lists markups for a plan, oldest first (stable client ordering).
 */
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params; const planId = id
    const ctx = await requireAuth(req)
    const plan = await getPlanOrFail(planId)
    await requireProjectMember(plan.projectId, ctx)

    const markups = await db.markup.findMany({
      where: { planId },
      orderBy: { createdAt: 'asc' },
      include: {
        createdBy: { select: { fullName: true } },
        _count: { select: { attachments: true } },
      },
    })

    return Response.json({ markups: markups.map(serializeMarkup) })
  },
)

/**
 * POST /api/plans/[planId]/markups
 * Body: { id?, type, pageNumber?, coordinates, color?, metadata? }
 * If `id` is supplied (cuid pattern), an upsert is performed so that offline
 * retries don't duplicate markups. Otherwise a server-issued cuid is used.
 */
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params; const planId = id
    const ctx = await requireAuth(req)
    const plan = await getPlanOrFail(planId)
    await requireWrite(plan.projectId, ctx)

    const body = await readJson<{
      id?: unknown
      type?: unknown
      pageNumber?: unknown
      coordinates?: unknown
      color?: unknown
      metadata?: unknown
    }>(req)

    // type — required, must be in MARKUP_TYPES.
    if (typeof body.type !== 'string' || !(MARKUP_TYPES as readonly string[]).includes(body.type)) {
      throw new HttpError(
        400,
        'invalid_type',
        `type must be one of: ${MARKUP_TYPES.join(', ')}.`,
      )
    }
    const type = body.type

    // coordinates — required, JSON-encoded string (client-managed shape).
    if (typeof body.coordinates !== 'string' || !body.coordinates.trim()) {
      throw new HttpError(
        400,
        'invalid_coordinates',
        'coordinates is required as a non-empty JSON-encoded string.',
      )
    }
    const coordinates = body.coordinates.trim().slice(0, MAX_COORDS_LEN)

    // color — optional, defaults to red-500.
    let color = '#ef4444'
    if (body.color !== undefined && body.color !== null) {
      if (typeof body.color !== 'string') {
        throw new HttpError(400, 'invalid_color', 'color must be a CSS hex string.')
      }
      const c = body.color.trim()
      if (!/^#[0-9a-fA-F]{3,8}$/.test(c)) {
        throw new HttpError(400, 'invalid_color', 'color must be a CSS hex color (e.g. #ef4444).')
      }
      color = c
    }

    // pageNumber — optional, defaults to 1.
    let pageNumber = 1
    if (body.pageNumber !== undefined && body.pageNumber !== null) {
      const n = Number(body.pageNumber)
      if (!Number.isInteger(n) || n < 1) {
        throw new HttpError(400, 'invalid_page_number', 'pageNumber must be a positive integer.')
      }
      pageNumber = n
    }

    // metadata — optional, JSON-encoded string; default '{}'.
    let metadata = '{}'
    if (body.metadata !== undefined && body.metadata !== null) {
      if (typeof body.metadata !== 'string') {
        throw new HttpError(400, 'invalid_metadata', 'metadata must be a JSON-encoded string.')
      }
      const m = body.metadata.trim()
      metadata = m ? m.slice(0, MAX_METADATA_LEN) : '{}'
    }

    // id — optional client-supplied cuid for idempotency.
    let suppliedId: string | undefined
    if (body.id !== undefined && body.id !== null) {
      if (typeof body.id !== 'string') {
        throw new HttpError(400, 'invalid_id', 'id must be a cuid-style string.')
      }
      const candidate = body.id.trim()
      if (!CUID_RE.test(candidate)) {
        throw new HttpError(
          400,
          'invalid_id',
          'id must match ^[a-z0-9]{20,}$ (cuid pattern).',
        )
      }
      // Ensure the supplied id doesn't already exist on a different plan.
      const existing = await db.markup.findUnique({
        where: { id: candidate },
        select: { planId: true },
      })
      if (existing && existing.planId !== planId) {
        throw new HttpError(
          400,
          'invalid_id',
          'Supplied id refers to a markup on a different plan.',
        )
      }
      suppliedId = candidate
    }

    const include = {
      createdBy: { select: { fullName: true } },
      _count: { select: { attachments: true } },
    }

    let markup: MarkupWithCreator
    if (suppliedId) {
      markup = await db.markup.upsert({
        where: { id: suppliedId },
        create: {
          id: suppliedId,
          planId,
          type,
          pageNumber,
          coordinates,
          color,
          metadata,
          createdById: ctx.user.id,
        },
        update: {
          type,
          pageNumber,
          coordinates,
          color,
          metadata,
        },
        include,
      })
    } else {
      markup = await db.markup.create({
        data: {
          planId,
          type,
          pageNumber,
          coordinates,
          color,
          metadata,
          createdById: ctx.user.id,
        },
        include,
      })
    }

    return Response.json({ markup: serializeMarkup(markup) }, { status: 201 })
  },
)
