import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, withErrors, HttpError } from '@/lib/server/permissions'
import { parseDate, toIso } from '@/lib/server/json'

/**
 * GET /api/notifications
 * Query params:
 *   - unread=true  → filter isRead: false
 *   - limit=N      → page size (default 50, max 200)
 *   - before=<iso> → cursor pagination (createdAt < before)
 * Returns { notifications: [...], unreadCount: number } ordered by createdAt desc.
 */
export const GET = withErrors(async (req: NextRequest) => {
  const ctx = await requireAuth(req)
  const url = req.nextUrl
  const unreadOnly = url.searchParams.get('unread') === 'true'
  const beforeRaw = url.searchParams.get('before')
  const before = parseDate(beforeRaw)
  if (beforeRaw && !before) {
    throw new HttpError(400, 'invalid_query', 'Query parameter "before" must be a valid ISO timestamp.')
  }
  const limitRaw = Number(url.searchParams.get('limit') ?? 50)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 200) : 50

  const where = {
    userId: ctx.user.id,
    ...(unreadOnly ? { isRead: false } : {}),
    ...(before ? { createdAt: { lt: before } } : {}),
  }

  const [items, unreadCount] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.notification.count({ where: { userId: ctx.user.id, isRead: false } }),
  ])

  const notifications = items.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    relatedTaskId: n.relatedTaskId,
    relatedProjectId: n.relatedProjectId,
    isRead: n.isRead,
    createdAt: toIso(n.createdAt)!,
  }))

  return Response.json({ notifications, unreadCount })
})
