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
import { deleteFileFromDisk } from '@/lib/server/storage'
import { toIso } from '@/lib/server/json'

interface PlanWithUploader {
  id: string
  projectId: string
  title: string
  description: string | null
  fileName: string
  filePath: string
  fileSize: number
  mimeType: string
  uploadedById: string
  uploader?: { fullName: string } | null
  createdAt: Date
  updatedAt: Date
}

function serializePlan(p: PlanWithUploader) {
  return {
    id: p.id,
    projectId: p.projectId,
    title: p.title,
    description: p.description,
    fileName: p.fileName,
    fileSize: p.fileSize,
    mimeType: p.mimeType,
    uploadedById: p.uploadedById,
    uploadedByName: p.uploader?.fullName ?? '',
    createdAt: toIso(p.createdAt)!,
    updatedAt: toIso(p.updatedAt)!,
  }
}

async function getPlanOrFail(id: string): Promise<PlanWithUploader> {
  const plan = await db.plan.findUnique({
    where: { id },
    include: { uploader: { select: { fullName: true } } },
  })
  if (!plan) throw new HttpError(404, 'plan_not_found', 'Plan not found.')
  return plan
}

/**
 * GET /api/plans/[id]
 * Returns plan metadata. `filePath` is omitted; clients fetch bytes via
 * /api/plans/{id}/file.
 */
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const plan = await getPlanOrFail(id)
    await requireProjectMember(plan.projectId, ctx)
    return Response.json({ plan: serializePlan(plan) })
  },
)

/**
 * PATCH /api/plans/[id]
 * Body: { title?, description? } — either or both may be supplied.
 */
export const PATCH = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const plan = await getPlanOrFail(id)
    await requireWrite(plan.projectId, ctx)

    const body = await readJson<{ title?: unknown; description?: unknown }>(req)

    const data: { title?: string; description?: string | null } = {}
    if (body.title !== undefined) {
      if (typeof body.title !== 'string') {
        throw new HttpError(400, 'invalid_title', 'title must be a string.')
      }
      const t = body.title.trim()
      if (!t || t.length > 200) {
        throw new HttpError(400, 'invalid_title', 'title must be 1–200 characters.')
      }
      data.title = t
    }
    if (body.description !== undefined) {
      if (body.description === null) {
        data.description = null
      } else if (typeof body.description === 'string') {
        const d = body.description.trim()
        data.description = d ? d.slice(0, 4000) : null
      } else {
        throw new HttpError(400, 'invalid_description', 'description must be a string or null.')
      }
    }

    const updated = await db.plan.update({
      where: { id },
      data,
      include: { uploader: { select: { fullName: true } } },
    })
    return Response.json({ plan: serializePlan(updated) })
  },
)

/**
 * DELETE /api/plans/[id]
 * Deletes the plan row and best-effort removes the file from disk.
 */
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const plan = await getPlanOrFail(id)
    await requireWrite(plan.projectId, ctx)

    const filePath = plan.filePath
    await db.plan.delete({ where: { id } })
    await deleteFileFromDisk(filePath)

    return Response.json({ ok: true })
  },
)
