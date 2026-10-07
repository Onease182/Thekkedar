import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, requireProjectMember, withErrors, HttpError } from '@/lib/server/permissions'
import { parseDate, toIso } from '@/lib/server/json'
import type { SyncResponse, SyncTask, SyncMarkup, SyncComment, SyncNotification } from '@/types'

// Hard caps to keep the response size reasonable for offline sync.
const MAX_TASKS = 500
const MAX_MARKUPS = 500
const MAX_COMMENTS = 1000
const MAX_NOTIFICATIONS = 200

/**
 * GET /api/sync?projectId=...&since=<iso>&includeDeleted=true
 * Returns all entities updated since `since` (or all if omitted) for a project
 * plus the current user's notifications. Used by the PWA to pull server changes.
 */
export const GET = withErrors(async (req: NextRequest) => {
  const ctx = await requireAuth(req)
  const url = req.nextUrl

  const projectId = url.searchParams.get('projectId')
  if (!projectId) {
    throw new HttpError(400, 'missing_project', 'Query parameter "projectId" is required.')
  }
  // Verify project membership (throws 404/403 on failure).
  await requireProjectMember(projectId, ctx)

  const sinceRaw = url.searchParams.get('since')
  const since = parseDate(sinceRaw)
  if (sinceRaw && !since) {
    throw new HttpError(400, 'invalid_query', 'Query parameter "since" must be a valid ISO timestamp.')
  }
  const includeDeleted = url.searchParams.get('includeDeleted') === 'true'

  // Fire all four queries in parallel for speed.
  const [tasks, markups, comments, notifications] = await Promise.all([
    db.task.findMany({
      where: {
        projectId,
        ...(since ? { updatedAt: { gt: since } } : {}),
        ...(!includeDeleted ? { deletedAt: null } : {}),
      },
      take: MAX_TASKS,
      orderBy: { updatedAt: 'asc' },
    }),
    db.markup.findMany({
      where: {
        plan: { projectId },
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      take: MAX_MARKUPS,
      orderBy: { updatedAt: 'asc' },
    }),
    db.taskComment.findMany({
      where: {
        task: {
          projectId,
          ...(!includeDeleted ? { deletedAt: null } : {}),
        },
        ...(since ? { updatedAt: { gt: since } } : {}),
        ...(!includeDeleted ? { deletedAt: null } : {}),
      },
      take: MAX_COMMENTS,
      orderBy: { updatedAt: 'asc' },
    }),
    db.notification.findMany({
      where: {
        userId: ctx.user.id,
        ...(since ? { createdAt: { gt: since } } : {}),
      },
      take: MAX_NOTIFICATIONS,
      orderBy: { createdAt: 'asc' },
    }),
  ])

  const syncTasks: SyncTask[] = tasks.map((t) => ({
    id: t.id,
    projectId: t.projectId,
    planId: t.planId,
    markupId: t.markupId,
    pageNumber: t.pageNumber,
    pinCoordinates: t.pinCoordinates,
    title: t.title,
    description: t.description,
    assigneeId: t.assigneeId,
    trade: t.trade,
    category: t.category,
    locationName: t.locationName,
    priority: t.priority,
    status: t.status,
    dueDate: toIso(t.dueDate),
    startDate: toIso(t.startDate),
    tags: t.tags,
    estimatedHours: t.estimatedHours,
    actualHours: t.actualHours,
    estimatedCost: t.estimatedCost,
    actualCost: t.actualCost,
    createdById: t.createdById,
    createdAt: toIso(t.createdAt)!,
    updatedAt: toIso(t.updatedAt)!,
    deletedAt: toIso(t.deletedAt),
  }))

  const syncMarkups: SyncMarkup[] = markups.map((m) => ({
    id: m.id,
    planId: m.planId,
    type: m.type,
    pageNumber: m.pageNumber,
    coordinates: m.coordinates,
    color: m.color,
    metadata: m.metadata,
    createdById: m.createdById,
    createdAt: toIso(m.createdAt)!,
    updatedAt: toIso(m.updatedAt)!,
  }))

  const syncComments: SyncComment[] = comments.map((c) => ({
    id: c.id,
    taskId: c.taskId,
    authorId: c.authorId,
    body: c.body,
    createdAt: toIso(c.createdAt)!,
    updatedAt: toIso(c.updatedAt)!,
    deletedAt: toIso(c.deletedAt),
  }))

  const syncNotifications: SyncNotification[] = notifications.map((n) => ({
    id: n.id,
    userId: n.userId,
    type: n.type,
    title: n.title,
    body: n.body,
    relatedTaskId: n.relatedTaskId,
    relatedProjectId: n.relatedProjectId,
    isRead: n.isRead,
    createdAt: toIso(n.createdAt)!,
  }))

  const payload: SyncResponse = {
    since: since ? since.toISOString() : null,
    until: new Date().toISOString(),
    tasks: syncTasks,
    markups: syncMarkups,
    comments: syncComments,
    notifications: syncNotifications,
  }

  return Response.json(payload)
})
