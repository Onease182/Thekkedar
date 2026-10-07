import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { isValidRole } from '@/lib/server/auth'
import { ROLES } from '@/lib/server/constants'
import {
  requireAuth,
  requireProjectMember,
  requireProjectManage,
  withErrors,
  readJson,
  HttpError,
} from '@/lib/server/permissions'
import type { Role } from '@/types'

interface MembersParams {
  params: Promise<{ id: string }>
}

function sanitizeString(v: unknown, field: string, max: number): string {
  if (typeof v !== 'string') {
    throw new HttpError(400, 'invalid_field', `${field} must be a string.`)
  }
  const s = v.trim()
  if (!s) {
    throw new HttpError(400, 'invalid_field', `${field} must not be empty.`)
  }
  if (s.length > max) {
    throw new HttpError(400, 'invalid_field', `${field} exceeds ${max} characters.`)
  }
  return s
}

interface MemberDto {
  id: string
  userId: string
  role: Role
  email: string
  fullName: string
}

export const GET = withErrors(async (req: NextRequest, { params }: MembersParams) => {
  const ctx = await requireAuth(req)
  const { id } = await params
  await requireProjectMember(id, ctx)

  const [members, project] = await Promise.all([
    db.projectMember.findMany({
      where: { projectId: id },
      include: { user: true },
      orderBy: { createdAt: 'asc' },
    }),
    db.project.findUnique({ where: { id } }),
  ])

  const ownerId = project?.ownerId
  const ownerAlreadyInList = ownerId
    ? members.some((m) => m.userId === ownerId)
    : false

  const result: MemberDto[] = members.map((m) => ({
    id: m.id,
    userId: m.userId,
    role: m.role as Role,
    email: m.user.email,
    fullName: m.user.fullName,
  }))

  // Surface the owner as an implicit project_manager if they don't have an explicit row.
  if (ownerId && !ownerAlreadyInList) {
    const owner = await db.user.findUnique({ where: { id: ownerId } })
    if (owner) {
      result.unshift({
        id: `owner-${owner.id}`,
        userId: owner.id,
        role: 'project_manager' as Role,
        email: owner.email,
        fullName: owner.fullName,
      })
    }
  }

  return Response.json({ members: result }, { status: 200 })
})

interface AddMemberBody {
  userId?: unknown
  role?: unknown
}

export const POST = withErrors(async (req: NextRequest, { params }: MembersParams) => {
  const ctx = await requireAuth(req)
  const { id } = await params
  await requireProjectManage(id, ctx)

  const body = await readJson<AddMemberBody>(req)
  const userId = typeof body.userId === 'string' ? body.userId.trim() : ''
  if (!userId) {
    throw new HttpError(400, 'invalid_user', 'userId is required.')
  }

  if (typeof body.role !== 'string' || !isValidRole(body.role)) {
    throw new HttpError(400, 'invalid_role', `Role must be one of: ${ROLES.join(', ')}.`)
  }
  const role = body.role

  const user = await db.user.findUnique({ where: { id: userId } })
  if (!user) {
    throw new HttpError(404, 'user_not_found', 'User does not exist.')
  }

  const existing = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId: id, userId } },
  })
  if (existing) {
    throw new HttpError(409, 'member_exists', 'User is already a member of this project.')
  }

  const member = await db.projectMember.create({
    data: { projectId: id, userId, role },
    include: { user: true },
  })

  return Response.json(
    {
      id: member.id,
      userId: member.userId,
      role: member.role as Role,
      email: member.user.email,
      fullName: member.user.fullName,
    },
    { status: 201 },
  )
})
