import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  requireProjectMember,
  withErrors,
  readJson,
  HttpError,
  type AuthContext,
} from '@/lib/server/permissions'
import { PRIORITIES, STATUSES, canWrite } from '@/lib/server/constants'
import { encodeJsonArray, parseDate, decodeJson } from '@/lib/server/json'
import { notifyTaskAssigned, notifyTaskStatusChanged } from '@/lib/server/notifications'
import type { Role } from '@/types'

export const dynamic = 'force-dynamic'

// Shared loader used by sibling routes under /api/tasks/[id]/*. Fetches the
// task with its project so the caller can verify membership, throws 404 if the
// task is missing/soft-deleted and 403 if the user is not a project member.
// Returns the membership role so callers can apply canWrite checks.
export async function loadTaskForCtx(id: string, ctx: AuthContext): Promise<{ task: any; role: Role }> {
  const task = await db.task.findUnique({
    where: { id },
    include: { project: true },
  })
  if (!task || task.deletedAt) throw new HttpError(404, 'task_not_found', 'Task not found.')
  const { role } = await requireProjectMember(task.projectId, ctx)
  return { task, role }
}

const DETAIL_INCLUDES = {
  assignee: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  plan: { select: { id: true, title: true, fileName: true } },
  markup: { select: { id: true, type: true, pageNumber: true } },
  _count: {
    select: {
      comments: { where: { deletedAt: null } },
      attachments: true,
    },
  },
} as const

function mapTaskDetail(t: any) {
  return {
    id: t.id,
    projectId: t.projectId,
    planId: t.planId,
    plan: t.plan ? { id: t.plan.id, title: t.plan.title, fileName: t.plan.fileName } : null,
    markupId: t.markupId,
    markup: t.markup ? { id: t.markup.id, type: t.markup.type, pageNumber: t.markup.pageNumber } : null,
    pageNumber: t.pageNumber,
    pinCoordinates: t.pinCoordinates,
    title: t.title,
    description: t.description,
    assigneeId: t.assigneeId,
    assignee: t.assignee ? { id: t.assignee.id, fullName: t.assignee.fullName } : null,
    trade: t.trade,
    category: t.category,
    locationName: t.locationName,
    priority: t.priority,
    status: t.status,
    dueDate: t.dueDate ? t.dueDate.toISOString() : null,
    startDate: t.startDate ? t.startDate.toISOString() : null,
    tags: decodeJson<string[]>(t.tags) ?? [],
    estimatedHours: t.estimatedHours,
    actualHours: t.actualHours,
    estimatedCost: t.estimatedCost,
    actualCost: t.actualCost,
    createdById: t.createdById,
    createdBy: t.createdBy ? { id: t.createdBy.id, fullName: t.createdBy.fullName } : null,
    commentCount: t._count?.comments ?? 0,
    attachmentCount: t._count?.attachments ?? 0,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
  }
}

// GET /api/tasks/[id] — full task detail with related entities.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    await loadTaskForCtx(id, ctx)

    const task = await db.task.findUnique({
      where: { id },
      include: DETAIL_INCLUDES,
    })
    if (!task || task.deletedAt) throw new HttpError(404, 'task_not_found', 'Task not found.')
    return Response.json(mapTaskDetail(task))
  },
)

// PATCH /api/tasks/[id] — partial update. Triggers assignment + status-changed
// notifications and (when transitioning to done) auto-watches the assignee +
// creator so they receive future updates.
export const PATCH = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { task: prev, role } = await loadTaskForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const body = await readJson<Record<string, any>>(req)
    const data: any = {}

    if (typeof body.title === 'string') data.title = body.title.trim()
    if (body.description !== undefined) data.description = typeof body.description === 'string' ? body.description : null
    if (body.planId !== undefined) data.planId = body.planId || null
    if (body.markupId !== undefined) data.markupId = body.markupId || null
    if (body.pageNumber !== undefined) data.pageNumber = typeof body.pageNumber === 'number' ? body.pageNumber : null
    if (body.pinCoordinates !== undefined) data.pinCoordinates = typeof body.pinCoordinates === 'string' ? body.pinCoordinates : null
    if (body.assigneeId !== undefined) data.assigneeId = body.assigneeId || null
    if (body.trade !== undefined) data.trade = typeof body.trade === 'string' ? body.trade : null
    if (body.category !== undefined) data.category = typeof body.category === 'string' ? body.category : null
    if (body.locationName !== undefined) data.locationName = typeof body.locationName === 'string' ? body.locationName : null
    if (body.priority !== undefined) {
      if (!PRIORITIES.includes(body.priority as any)) throw new HttpError(400, 'invalid_priority', 'Invalid priority.')
      data.priority = body.priority
    }
    if (body.status !== undefined) {
      if (!STATUSES.includes(body.status as any)) throw new HttpError(400, 'invalid_status', 'Invalid status.')
      data.status = body.status
    }
    if (body.dueDate !== undefined) data.dueDate = body.dueDate ? parseDate(body.dueDate as string) : null
    if (body.startDate !== undefined) data.startDate = body.startDate ? parseDate(body.startDate as string) : null
    if (body.tags !== undefined) data.tags = encodeJsonArray(Array.isArray(body.tags) ? body.tags : [])
    if (body.estimatedHours !== undefined) data.estimatedHours = typeof body.estimatedHours === 'number' ? body.estimatedHours : null
    if (body.actualHours !== undefined) data.actualHours = typeof body.actualHours === 'number' ? body.actualHours : null
    if (body.estimatedCost !== undefined) data.estimatedCost = typeof body.estimatedCost === 'number' ? body.estimatedCost : null
    if (body.actualCost !== undefined) data.actualCost = typeof body.actualCost === 'number' ? body.actualCost : null

    // Validate planId/markupId relationships if changed.
    if (data.planId) {
      const plan = await db.plan.findUnique({ where: { id: data.planId }, select: { id: true, projectId: true } })
      if (!plan || plan.projectId !== prev.projectId) {
        throw new HttpError(400, 'invalid_plan', 'Plan not found in this project.')
      }
    }
    if (data.markupId) {
      const planId = data.planId ?? prev.planId
      if (!planId) throw new HttpError(400, 'invalid_markup', 'Markup requires a plan.')
      const markup = await db.markup.findUnique({ where: { id: data.markupId }, select: { id: true, planId: true } })
      if (!markup || markup.planId !== planId) {
        throw new HttpError(400, 'invalid_markup', 'Markup not found in this plan.')
      }
    }

    const updated = await db.task.update({
      where: { id },
      data,
      include: DETAIL_INCLUDES,
    })

    const byUser = await db.user.findUnique({ where: { id: ctx.user.id }, select: { fullName: true } })
    const byUserName = byUser?.fullName ?? 'Someone'

    // Assignee change → notify (and notifyTaskAssigned already upserts the
    // assignee as a watcher).
    const prevAssignee = prev.assigneeId
    const newAssignee = data.assigneeId !== undefined ? data.assigneeId || null : prevAssignee
    if (newAssignee && newAssignee !== prevAssignee && newAssignee !== ctx.user.id) {
      await notifyTaskAssigned(id, newAssignee, byUserName, updated.title)
    }

    // Status change to "done" → auto-watch the assignee (if any) and creator
    // and notify all watchers.
    if (data.status && prev.status !== 'done' && data.status === 'done') {
      if (updated.assigneeId) {
        await db.taskWatcher.upsert({
          where: { taskId_userId: { taskId: id, userId: updated.assigneeId } },
          create: { taskId: id, userId: updated.assigneeId },
          update: {},
        })
      }
      await db.taskWatcher.upsert({
        where: { taskId_userId: { taskId: id, userId: prev.createdById } },
        create: { taskId: id, userId: prev.createdById },
        update: {},
      })
      await notifyTaskStatusChanged(id, 'done', byUserName, updated.title)
    }

    return Response.json(mapTaskDetail(updated))
  },
)

// DELETE /api/tasks/[id] — soft delete.
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadTaskForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')
    await db.task.update({ where: { id }, data: { deletedAt: new Date() } })
    return Response.json({ ok: true })
  },
)
