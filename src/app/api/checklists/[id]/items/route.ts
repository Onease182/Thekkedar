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

// GET /api/checklists/[id]/items — list items ordered by `order`.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    await loadChecklistForCtx(id, ctx)

    const items = await db.taskChecklistItem.findMany({
      where: { checklistId: id },
      orderBy: { order: 'asc' },
    })

    return Response.json({ items: items.map(mapItem) })
  },
)

// POST /api/checklists/[id]/items — create a new checklist item.
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadChecklistForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const body = await readJson<{ text?: string; order?: number; isChecked?: boolean }>(req)
    const text = typeof body.text === 'string' ? body.text.trim() : ''
    if (!text) throw new HttpError(400, 'invalid_text', 'Item text is required.')
    const order = typeof body.order === 'number' ? body.order : 0
    const isChecked = typeof body.isChecked === 'boolean' ? body.isChecked : false

    const item = await db.taskChecklistItem.create({
      data: { checklistId: id, text, order, isChecked },
    })

    return NextResponse.json(mapItem(item), { status: 201 })
  },
)
