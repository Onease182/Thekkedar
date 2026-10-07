import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, withErrors, HttpError, readJson } from '@/lib/server/permissions'
import { toIso } from '@/lib/server/json'

/**
 * PATCH /api/notifications/[id]
 * Body: { isRead?: boolean } (defaults to true)
 * Verifies the notification belongs to the current user, then updates isRead.
 */
export const PATCH = withErrors(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireAuth(req)
  const { id } = await params
  const body = await readJson<{ isRead?: boolean }>(req)
  const isRead = body.isRead === undefined ? true : Boolean(body.isRead)

  const existing = await db.notification.findUnique({ where: { id } })
  if (!existing || existing.userId !== ctx.user.id) {
    throw new HttpError(404, 'notification_not_found', 'Notification not found.')
  }

  const updated = await db.notification.update({
    where: { id },
    data: { isRead },
  })

  return Response.json({
    id: updated.id,
    type: updated.type,
    title: updated.title,
    body: updated.body,
    relatedTaskId: updated.relatedTaskId,
    relatedProjectId: updated.relatedProjectId,
    isRead: updated.isRead,
    createdAt: toIso(updated.createdAt)!,
  })
})

/**
 * DELETE /api/notifications/[id]
 * Deletes the notification if it belongs to the current user.
 */
export const DELETE = withErrors(async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await requireAuth(req)
  const { id } = await params

  const existing = await db.notification.findUnique({ where: { id } })
  if (!existing || existing.userId !== ctx.user.id) {
    throw new HttpError(404, 'notification_not_found', 'Notification not found.')
  }

  await db.notification.delete({ where: { id } })
  return Response.json({ ok: true })
})
