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
import { canWrite } from '@/lib/server/constants'
import type { Role } from '@/types'

export const dynamic = 'force-dynamic'

async function loadChecklistForCtx(id: string, ctx: AuthContext): Promise<{ checklist: any; role: Role }> {
  const checklist = await db.taskChecklist.findUnique({
    where: { id },
    include: { task: { include: { project: true } } },
  })
  if (!checklist) throw new HttpError(404, 'checklist_not_found', 'Checklist not found.')
  const { role } = await requireProjectMember(checklist.task.projectId, ctx)
  return { checklist, role }
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

// PATCH /api/checklists/[id] — rename or reorder.
export const PATCH = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadChecklistForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const body = await readJson<{ title?: string; order?: number }>(req)
    const data: any = {}
    if (typeof body.title === 'string') data.title = body.title.trim()
    if (typeof body.order === 'number') data.order = body.order

    const updated = await db.taskChecklist.update({
      where: { id },
      data,
      include: INCLUDE_ITEMS,
    })
    return Response.json(mapChecklist(updated))
  },
)

// DELETE /api/checklists/[id] — cascade-removes items via Prisma relation.
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadChecklistForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')
    await db.taskChecklist.delete({ where: { id } })
    return Response.json({ ok: true })
  },
)
