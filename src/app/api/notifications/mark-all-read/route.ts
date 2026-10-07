import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, withErrors } from '@/lib/server/permissions'

/**
 * POST /api/notifications/mark-all-read
 * Marks all unread notifications for the current user as read.
 * Returns { updated: count } where count = number of rows updated.
 */
export const POST = withErrors(async (req: NextRequest) => {
  const ctx = await requireAuth(req)

  const result = await db.notification.updateMany({
    where: { userId: ctx.user.id, isRead: false },
    data: { isRead: true },
  })

  return Response.json({ updated: result.count })
})
