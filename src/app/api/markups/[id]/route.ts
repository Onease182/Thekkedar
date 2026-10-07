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

const MAX_COORDS_LEN = 32000
const MAX_METADATA_LEN = 32000

interface MarkupWithPlan {
  id: string
  planId: string
  type: string
  pageNumber: number
  coordinates: string
  color: string
  metadata: string
  createdById: string
  plan?: { projectId: string }
  createdBy?: { fullName: string } | null
  createdAt: Date
  updatedAt: Date
}

function serializeMarkup(m: MarkupWithPlan) {
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
    createdAt: toIso(m.createdAt)!,
    updatedAt: toIso(m.updatedAt)!,
  }
}

async function getMarkupOrFail(id: string): Promise<MarkupWithPlan> {
  const markup = await db.markup.findUnique({
    where: { id },
    include: {
      plan: { select: { projectId: true } },
      createdBy: { select: { fullName: true } },
    },
  })
  if (!markup) throw new HttpError(404, 'markup_not_found', 'Markup not found.')
  return markup
}

/**
 * GET /api/markups/[id]
 * Returns the markup with `createdByName`.
 */
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const markup = await getMarkupOrFail(id)
    if (!markup.plan) {
      throw new HttpError(404, 'plan_not_found', 'Markup has no associated plan.')
    }
    await requireProjectMember(markup.plan.projectId, ctx)
    return Response.json({ markup: serializeMarkup(markup) })
  },
)

/**
 * PATCH /api/markups/[id]
 * Body may include any of: type, pageNumber, coordinates, color, metadata.
 */
export const PATCH = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const markup = await getMarkupOrFail(id)
    if (!markup.plan) {
      throw new HttpError(404, 'plan_not_found', 'Markup has no associated plan.')
    }
    await requireWrite(markup.plan.projectId, ctx)

    const body = await readJson<{
      type?: unknown
      pageNumber?: unknown
      coordinates?: unknown
      color?: unknown
      metadata?: unknown
    }>(req)

    const data: {
      type?: string
      pageNumber?: number
      coordinates?: string
      color?: string
      metadata?: string
    } = {}

    if (body.type !== undefined) {
      if (
        typeof body.type !== 'string' ||
        !(MARKUP_TYPES as readonly string[]).includes(body.type)
      ) {
        throw new HttpError(
          400,
          'invalid_type',
          `type must be one of: ${MARKUP_TYPES.join(', ')}.`,
        )
      }
      data.type = body.type
    }
    if (body.pageNumber !== undefined && body.pageNumber !== null) {
      const n = Number(body.pageNumber)
      if (!Number.isInteger(n) || n < 1) {
        throw new HttpError(400, 'invalid_page_number', 'pageNumber must be a positive integer.')
      }
      data.pageNumber = n
    }
    if (body.coordinates !== undefined) {
      if (typeof body.coordinates !== 'string' || !body.coordinates.trim()) {
        throw new HttpError(
          400,
          'invalid_coordinates',
          'coordinates must be a non-empty JSON-encoded string.',
        )
      }
      data.coordinates = body.coordinates.trim().slice(0, MAX_COORDS_LEN)
    }
    if (body.color !== undefined) {
      if (typeof body.color !== 'string') {
        throw new HttpError(400, 'invalid_color', 'color must be a CSS hex string.')
      }
      const c = body.color.trim()
      if (!/^#[0-9a-fA-F]{3,8}$/.test(c)) {
        throw new HttpError(400, 'invalid_color', 'color must be a CSS hex color (e.g. #ef4444).')
      }
      data.color = c
    }
    if (body.metadata !== undefined) {
      if (typeof body.metadata !== 'string') {
        throw new HttpError(400, 'invalid_metadata', 'metadata must be a JSON-encoded string.')
      }
      const m = body.metadata.trim()
      data.metadata = m ? m.slice(0, MAX_METADATA_LEN) : '{}'
    }

    const updated = await db.markup.update({
      where: { id },
      data,
      include: {
        plan: { select: { projectId: true } },
        createdBy: { select: { fullName: true } },
      },
    })
    return Response.json({ markup: serializeMarkup(updated) })
  },
)

/**
 * DELETE /api/markups/[id]
 * Detaches linked tasks (markupId = null) before deletion. Schema's Markup
 * relation uses onDelete: Cascade on Markup→MarkupAttachment only, so we
 * must nullify Task.markupId manually to preserve task history.
 */
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const markup = await getMarkupOrFail(id)
    if (!markup.plan) {
      throw new HttpError(404, 'plan_not_found', 'Markup has no associated plan.')
    }
    await requireWrite(markup.plan.projectId, ctx)

    await db.task.updateMany({ where: { markupId: id }, data: { markupId: null } })
    await db.markup.delete({ where: { id } })
    return Response.json({ ok: true })
  },
)
