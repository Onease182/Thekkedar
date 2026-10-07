import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  requireProjectMember,
  withErrors,
  HttpError,
  type AuthContext,
} from '@/lib/server/permissions'
import { canWrite } from '@/lib/server/constants'
import type { Role } from '@/types'

export const dynamic = 'force-dynamic'

async function loadRelationForCtx(id: string, ctx: AuthContext): Promise<{ relation: any; role: Role }> {
  const relation = await db.taskRelation.findUnique({
    where: { id },
    include: { taskA: { select: { id: true, projectId: true } } },
  })
  if (!relation) throw new HttpError(404, 'relation_not_found', 'Task relation not found.')
  const { role } = await requireProjectMember(relation.taskA.projectId, ctx)
  return { relation, role }
}

// DELETE /api/task_relations/[id] — unlink two tasks.
export const DELETE = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params
    const ctx = await requireAuth(req)
    const { role } = await loadRelationForCtx(id, ctx)
    if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')
    await db.taskRelation.delete({ where: { id } })
    return Response.json({ ok: true })
  },
)
