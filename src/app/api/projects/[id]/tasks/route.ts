import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  requireProjectMember,
  requireWrite,
  withErrors,
  readJson,
  HttpError,
  type AuthContext,
} from '@/lib/server/permissions'
import { PRIORITIES, STATUSES } from '@/lib/server/constants'
import { encodeJsonArray, parseDate, decodeJson } from '@/lib/server/json'
import { notifyTaskAssigned } from '@/lib/server/notifications'

export const dynamic = 'force-dynamic'

// Shared task-shape mapper for list/detail responses. Decodes the JSON-encoded
// `tags` column into a real array and exposes the assignee/creator names and
// child counts so the client doesn't have to issue extra joins.
function mapTask(t: any) {
  return {
    id: t.id,
    projectId: t.projectId,
    planId: t.planId,
    markupId: t.markupId,
    pageNumber: t.pageNumber,
    pinCoordinates: t.pinCoordinates,
    title: t.title,
    description: t.description,
    assigneeId: t.assigneeId,
    assigneeName: t.assignee?.fullName ?? null,
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
    createdByName: t.createdBy?.fullName ?? null,
    commentCount: t._count?.comments ?? 0,
    attachmentCount: t._count?.attachments ?? 0,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    deletedAt: t.deletedAt ? t.deletedAt.toISOString() : null,
  }
}

const TASK_INCLUDES = {
  assignee: { select: { id: true, fullName: true } },
  createdBy: { select: { id: true, fullName: true } },
  _count: {
    select: {
      comments: { where: { deletedAt: null } },
      attachments: true,
    },
  },
} as const

// GET /api/projects/[projectId]/tasks — filtered, paginated, sorted list.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params; const projectId = id
    const ctx = await requireAuth(req)
    await requireProjectMember(projectId, ctx)

    const url = new URL(req.url)
    const sp = url.searchParams
    const assigneeId = sp.get('assigneeId')
    const status = sp.get('status')
    const priority = sp.get('priority')
    const category = sp.get('category')
    const trade = sp.get('trade')
    const locationName = sp.get('locationName')
    const planId = sp.get('planId')
    const markupId = sp.get('markupId')
    const tag = sp.get('tag')
    const dueBefore = sp.get('dueBefore')
    const dueAfter = sp.get('dueAfter')
    const q = sp.get('q')
    const sort = sp.get('sort') ?? 'createdAt'
    const order = sp.get('order') ?? 'desc'

    const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const pageSize = Math.min(200, Math.max(1, parseInt(sp.get('pageSize') ?? '50', 10) || 50))

    const where: any = { projectId, deletedAt: null }
    if (assigneeId) {
      if (assigneeId === '__unassigned__' || assigneeId === 'null') {
        where.assigneeId = null
      } else {
        where.assigneeId = assigneeId
      }
    }
    if (status) where.status = status
    if (priority) where.priority = priority
    if (category) where.category = category
    if (trade) where.trade = trade
    if (planId) where.planId = planId
    if (markupId) where.markupId = markupId
    if (locationName) where.locationName = { contains: locationName }
    if (q) where.title = { contains: q }
    if (tag) where.tags = { contains: tag }

    const dueRange: any = {}
    if (dueBefore) {
      const d = parseDate(dueBefore)
      if (d) dueRange.lte = d
    }
    if (dueAfter) {
      const d = parseDate(dueAfter)
      if (d) dueRange.gte = d
    }
    if (Object.keys(dueRange).length > 0) where.dueDate = dueRange

    const SORT_FIELDS = ['title', 'dueDate', 'priority', 'status', 'createdAt', 'updatedAt']
    const sortBy = SORT_FIELDS.includes(sort) ? sort : 'createdAt'
    const orderBy: any = { [sortBy]: order === 'asc' ? 'asc' : 'desc' }

    const [total, tasks] = await Promise.all([
      db.task.count({ where }),
      db.task.findMany({
        where,
        include: TASK_INCLUDES,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return Response.json({ tasks: tasks.map(mapTask), total, page, pageSize })
  },
)

// POST /api/projects/[projectId]/tasks — create a task (or upsert if client
// supplied an id for offline-retry idempotency).
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params; const projectId = id
    const ctx = await requireAuth(req)
    await requireWrite(projectId, ctx)

    const body = await readJson<Record<string, any>>(req)

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) throw new HttpError(400, 'invalid_title', 'Title is required.')

    const priority = typeof body.priority === 'string' ? body.priority : 'P2'
    if (!PRIORITIES.includes(priority as any)) {
      throw new HttpError(400, 'invalid_priority', `Priority must be one of ${PRIORITIES.join(', ')}.`)
    }
    const status = typeof body.status === 'string' ? body.status : 'open'
    if (!STATUSES.includes(status as any)) {
      throw new HttpError(400, 'invalid_status', `Status must be one of ${STATUSES.join(', ')}.`)
    }

    // Validate planId belongs to project; markupId belongs to plan.
    if (body.planId) {
      const plan = await db.plan.findUnique({ where: { id: body.planId }, select: { id: true, projectId: true } })
      if (!plan || plan.projectId !== projectId) {
        throw new HttpError(400, 'invalid_plan', 'Plan not found in this project.')
      }
    }
    if (body.markupId) {
      if (!body.planId) {
        throw new HttpError(400, 'invalid_markup', 'markupId requires planId.')
      }
      const markup = await db.markup.findUnique({ where: { id: body.markupId }, select: { id: true, planId: true } })
      if (!markup || markup.planId !== body.planId) {
        throw new HttpError(400, 'invalid_markup', 'Markup not found in this plan.')
      }
    }

    const data: any = {
      projectId,
      title,
      description: typeof body.description === 'string' ? body.description : null,
      planId: body.planId ?? null,
      markupId: body.markupId ?? null,
      pageNumber: typeof body.pageNumber === 'number' ? body.pageNumber : null,
      pinCoordinates: typeof body.pinCoordinates === 'string' ? body.pinCoordinates : null,
      assigneeId: body.assigneeId || null,
      trade: typeof body.trade === 'string' ? body.trade : null,
      category: typeof body.category === 'string' ? body.category : null,
      locationName: typeof body.locationName === 'string' ? body.locationName : null,
      priority,
      status,
      dueDate: body.dueDate ? parseDate(body.dueDate as string) : null,
      startDate: body.startDate ? parseDate(body.startDate as string) : null,
      tags: encodeJsonArray(Array.isArray(body.tags) ? body.tags : []),
      estimatedHours: typeof body.estimatedHours === 'number' ? body.estimatedHours : null,
      actualHours: typeof body.actualHours === 'number' ? body.actualHours : null,
      estimatedCost: typeof body.estimatedCost === 'number' ? body.estimatedCost : null,
      actualCost: typeof body.actualCost === 'number' ? body.actualCost : null,
      createdById: ctx.user.id,
    }

    let task
    let createdNew = false
    if (typeof body.id === 'string' && body.id) {
      // Idempotent offline retry path.
      const existing = await db.task.findUnique({
        where: { id: body.id },
        select: { id: true, projectId: true },
      })
      if (existing && existing.projectId !== projectId) {
        throw new HttpError(409, 'task_exists_other_project', 'A task with this ID already exists in a different project.')
      }
      if (existing) {
        const { createdById: _omit, projectId: _omit2, ...updateData } = data
        void _omit
        void _omit2
        task = await db.task.update({ where: { id: body.id }, data: updateData, include: TASK_INCLUDES })
      } else {
        task = await db.task.create({ data: { id: body.id, ...data }, include: TASK_INCLUDES })
        createdNew = true
      }
    } else {
      task = await db.task.create({ data, include: TASK_INCLUDES })
      createdNew = true
    }

    // Notify assignee on the initial create (but never notify yourself).
    if (createdNew && data.assigneeId && data.assigneeId !== ctx.user.id) {
      const byUser = await db.user.findUnique({ where: { id: ctx.user.id }, select: { fullName: true } })
      await notifyTaskAssigned(task.id, data.assigneeId, byUser?.fullName ?? 'Someone', title)
    }

    return NextResponse.json(mapTask(task), { status: 201 })
  },
)
