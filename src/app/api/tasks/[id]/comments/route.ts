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
import { notifyTaskComment } from '@/lib/server/notifications'
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

function mapComment(c: any) {
  return {
    id: c.id,
    taskId: c.taskId,
    authorId: c.authorId,
    authorName: c.author?.fullName ?? null,
    body: c.body,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    deletedAt: c.deletedAt ? c.deletedAt.toISOString() : null,
  }
}

// GET /api/tasks/[id]/comments — list non-deleted comments, oldest first.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    await loadTaskForCtx(id, ctx)

    const comments = await db.taskComment.findMany({
      where: { taskId: id, deletedAt: null },
      include: { author: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'asc' },
    })

    return Response.json({ comments: comments.map(mapComment) })
  },
)

// POST /api/tasks/[id]/comments — add a comment. Fires a notification to the
// assignee and any watchers (excluding the author).
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { task, role } = await loadTaskForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const body = await readJson<{ body?: string }>(req)
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (!text) throw new HttpError(400, 'invalid_body', 'Comment body is required.')
    if (text.length > 5000) throw new HttpError(400, 'body_too_long', 'Comment body exceeds 5000 characters.')

    const comment = await db.taskComment.create({
      data: { taskId: id, authorId: ctx.user.id, body: text },
      include: { author: { select: { id: true, fullName: true } } },
    })

    const byUser = await db.user.findUnique({ where: { id: ctx.user.id }, select: { fullName: true } })
    await notifyTaskComment(id, ctx.user.id, byUser?.fullName ?? 'Someone', task.title, text)

    return NextResponse.json(mapComment(comment), { status: 201 })
  },
)
