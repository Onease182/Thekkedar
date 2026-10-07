import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  requireProjectMember,
  withErrors,
  readJson,
  HttpError,
  type AuthContext,
} from '@/lib/server/permissions'
import { canWrite } from '@/lib/server/constants'
import type { Role } from '@/types'

export const dynamic = 'force-dynamic'

async function loadTaskForCtx(id: string, ctx: AuthContext): Promise<{ task: any; role: Role }> {
  const task = await db.task.findUnique({
    where: { id },
    include: { project: true },
  })
  if (!task || task.deletedAt) throw new HttpError(404, 'task_not_found', 'Task not found.')
  const { role } = await requireProjectMember(task.projectId, ctx)
  return { task, role }
}

function mapItem(i: any) {
  return {
    id: i.id,
    checklistId: i.checklistId,
    text: i.text,
    isChecked: i.isChecked,
    order: i.order,
    createdAt: i.createdAt.toISOString(),
    updatedAt: i.updatedAt.toISOString(),
  }
}

function mapChecklist(c: any) {
  return {
    id: c.id,
    taskId: c.taskId,
    title: c.title,
    order: c.order,
    items: Array.isArray(c.items) ? c.items.map(mapItem) : [],
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  }
}

const INCLUDE_ITEMS = {
  items: { orderBy: { order: 'asc' as const } },
} as const

// GET /api/tasks/[id]/checklists — list checklists with items, ordered.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    await loadTaskForCtx(id, ctx)

    const checklists = await db.taskChecklist.findMany({
      where: { taskId: id },
      include: INCLUDE_ITEMS,
      orderBy: { order: 'asc' },
    })

    return Response.json({ checklists: checklists.map(mapChecklist) })
  },
)

// POST /api/tasks/[id]/checklists — create a checklist on the task.
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadTaskForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const body = await readJson<{ title?: string; order?: number }>(req)
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) throw new HttpError(400, 'invalid_title', 'Title is required.')
    const order = typeof body.order === 'number' ? body.order : 0

    const checklist = await db.taskChecklist.create({
      data: { taskId: id, title, order },
      include: INCLUDE_ITEMS,
    })

    return NextResponse.json(mapChecklist(checklist), { status: 201 })
  },
)
