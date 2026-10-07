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

const RELATION_TYPES = ['blocks', 'blocked_by', 'related', 'duplicate']

async function loadTaskForCtx(id: string, ctx: AuthContext): Promise<{ task: any; role: Role }> {
  const task = await db.task.findUnique({
    where: { id },
    include: { project: true },
  })
  if (!task || task.deletedAt) throw new HttpError(404, 'task_not_found', 'Task not found.')
  const { role } = await requireProjectMember(task.projectId, ctx)
  return { task, role }
}

// GET /api/tasks/[id]/relations — list relations on either side of the link
// with the related task's title + status.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    await loadTaskForCtx(id, ctx)

    const relations = await db.taskRelation.findMany({
      where: {
        OR: [{ taskId: id }, { relatedTaskId: id }],
      },
      include: {
        taskA: { select: { id: true, title: true, status: true, deletedAt: true } },
        taskB: { select: { id: true, title: true, status: true, deletedAt: true } },
      },
    })

    const mapped = relations.map((r) => {
      const isA = r.taskId === id
      const other = isA ? r.taskB : r.taskA
      const relatedTask =
        other && !other.deletedAt
          ? { id: other.id, title: other.title, status: other.status }
          : null
      return {
        id: r.id,
        taskId: r.taskId,
        relatedTaskId: r.relatedTaskId,
        relationType: r.relationType,
        relatedTask,
      }
    })

    return Response.json({ relations: mapped })
  },
)

// POST /api/tasks/[id]/relations — upsert via the [taskId, relatedTaskId]
// unique constraint. Rejects self-relations.
export const POST = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { task, role } = await loadTaskForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')

    const body = await readJson<{ relatedTaskId?: string; relationType?: string }>(req)
    const relatedTaskId = typeof body.relatedTaskId === 'string' ? body.relatedTaskId.trim() : ''
    if (!relatedTaskId) {
      throw new HttpError(400, 'invalid_related_task', 'relatedTaskId is required.')
    }
    if (relatedTaskId === id) {
      throw new HttpError(400, 'self_relation', 'Cannot relate a task to itself.')
    }
    const relationType = typeof body.relationType === 'string' ? body.relationType : ''
    if (!RELATION_TYPES.includes(relationType)) {
      throw new HttpError(400, 'invalid_relation_type', `relationType must be one of ${RELATION_TYPES.join(', ')}.`)
    }

    // Ensure the related task belongs to the same project.
    const relatedTask = await db.task.findUnique({
      where: { id: relatedTaskId },
      select: { id: true, projectId: true, deletedAt: true },
    })
    if (!relatedTask || relatedTask.deletedAt || relatedTask.projectId !== task.projectId) {
      throw new HttpError(400, 'invalid_related_task', 'Related task not found in the same project.')
    }

    const relation = await db.taskRelation.upsert({
      where: { taskId_relatedTaskId: { taskId: id, relatedTaskId } },
      create: { taskId: id, relatedTaskId, relationType },
      update: { relationType },
    })

    return NextResponse.json(
      {
        id: relation.id,
        taskId: relation.taskId,
        relatedTaskId: relation.relatedTaskId,
        relationType: relation.relationType,
      },
      { status: 201 },
    )
  },
)
