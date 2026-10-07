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

async function loadItemForCtx(id: string, ctx: AuthContext): Promise<{ item: any; role: Role }> {
  const item = await db.taskChecklistItem.findUnique({
    where: { id },
    include: { checklist: { include: { task: { include: { project: true } } } } },
  })
  if (!item) throw new HttpError(404, 'item_not_found', 'Checklist item not found.')
  const { role } = await requireProjectMember(item.checklist.task.projectId, ctx)
  return { item, role }
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

// PATCH /api/checklist_items/[id] — update text / checked state / order.
export const PATCH = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadItemForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const body = await readJson<{ text?: string; isChecked?: boolean; order?: number }>(req)
    const data: any = {}
    if (typeof body.text === 'string') data.text = body.text.trim()
    if (typeof body.isChecked === 'boolean') data.isChecked = body.isChecked
    if (typeof body.order === 'number') data.order = body.order

    const updated = await db.taskChecklistItem.update({ where: { id }, data })
    return Response.json(mapItem(updated))
  },
)

// DELETE /api/checklist_items/[id] — remove the item.
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadItemForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')
    await db.taskChecklistItem.delete({ where: { id } })
    return Response.json({ ok: true })
  },
)
