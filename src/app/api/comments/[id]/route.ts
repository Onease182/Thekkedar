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
import { canManageProject } from '@/lib/server/constants'
import type { Role } from '@/types'

export const dynamic = 'force-dynamic'

async function loadCommentForCtx(id: string, ctx: AuthContext): Promise<{ comment: any; role: Role }> {
  const comment = await db.taskComment.findUnique({
    where: { id },
    include: { task: { include: { project: true } } },
  })
  if (!comment || comment.deletedAt) throw new HttpError(404, 'comment_not_found', 'Comment not found.')
  const { role } = await requireProjectMember(comment.task.projectId, ctx)
  return { comment, role }
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

// PATCH /api/comments/[id] — author-only OR project_manager+ can edit.
export const PATCH = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { comment, role } = await loadCommentForCtx(id, ctx)

    const isAuthor = comment.authorId === ctx.user.id
    if (!isAuthor && !canManageProject(role)) {
      throw new HttpError(403, 'forbidden', 'Only the author or a project manager can edit this comment.')
    }

    const body = await readJson<{ body?: string }>(req)
    const text = typeof body.body === 'string' ? body.body.trim() : ''
    if (!text) throw new HttpError(400, 'invalid_body', 'Comment body is required.')
    if (text.length > 5000) throw new HttpError(400, 'body_too_long', 'Comment body exceeds 5000 characters.')

    const updated = await db.taskComment.update({
      where: { id },
      data: { body: text },
      include: { author: { select: { id: true, fullName: true } } },
    })

    return Response.json(mapComment(updated))
  },
)

// DELETE /api/comments/[id] — soft delete. Same permission rules as PATCH.
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { comment, role } = await loadCommentForCtx(id, ctx)

    const isAuthor = comment.authorId === ctx.user.id
    if (!isAuthor && !canManageProject(role)) {
      throw new HttpError(403, 'forbidden', 'Only the author or a project manager can delete this comment.')
    }

    await db.taskComment.update({ where: { id }, data: { deletedAt: new Date() } })
    return Response.json({ ok: true })
  },
)
