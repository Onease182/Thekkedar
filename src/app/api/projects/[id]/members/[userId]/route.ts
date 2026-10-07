import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  requireProjectManage,
  withErrors,
  HttpError,
} from '@/lib/server/permissions'

interface MemberByUserParams {
  params: Promise<{ id: string; userId: string }>
}

export const DELETE = withErrors(
  async (req: NextRequest, { params }: MemberByUserParams) => {
    const ctx = await requireAuth(req)
    const { id, userId } = await params
    await requireProjectManage(id, ctx)

    const project = await db.project.findUnique({ where: { id } })
    if (!project) {
      throw new HttpError(404, 'project_not_found', 'Project not found.')
    }
    if (project.ownerId === userId) {
      throw new HttpError(403, 'cannot_remove_owner', 'Project owner cannot be removed.')
    }

    const member = await db.projectMember.findUnique({
      where: { projectId_userId: { projectId: id, userId } },
    })
    if (!member) {
      throw new HttpError(404, 'member_not_found', 'Membership not found.')
    }

    await db.projectMember.delete({ where: { id: member.id } })
    return Response.json({ ok: true }, { status: 200 })
  },
)
