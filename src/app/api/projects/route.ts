import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  withErrors,
  readJson,
  HttpError,
} from '@/lib/server/permissions'
import type { Role } from '@/types'

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

interface ProjectListItem {
  id: string
  name: string
  code: string
  description: string | null
  ownerId: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  role: Role
}

export const GET = withErrors(async (req: NextRequest) => {
  const ctx = await requireAuth(req)

  const [ownedProjects, memberships] = await Promise.all([
    db.project.findMany({
      where: { ownerId: ctx.user.id },
      orderBy: { createdAt: 'desc' },
    }),
    db.projectMember.findMany({
      where: { userId: ctx.user.id },
      include: { project: true },
    }),
  ])

  const seen = new Set<string>()
  const items: ProjectListItem[] = []

  // Owner sees their own projects as project_manager.
  for (const p of ownedProjects) {
    if (seen.has(p.id)) continue
    seen.add(p.id)
    items.push({
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      ownerId: p.ownerId,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      role: 'project_manager' as Role,
    })
  }

  // Membership-based projects.
  for (const m of memberships) {
    const p = m.project
    if (seen.has(p.id)) continue
    seen.add(p.id)
    items.push({
      id: p.id,
      name: p.name,
      code: p.code,
      description: p.description,
      ownerId: p.ownerId,
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
      role: m.role as Role,
    })
  }

  return Response.json({ projects: items }, { status: 200 })
})

interface CreateProjectBody {
  name?: unknown
  code?: unknown
  description?: unknown
}

export const POST = withErrors(async (req: NextRequest) => {
  const ctx = await requireAuth(req)
  const body = await readJson<CreateProjectBody>(req)

  const name = sanitizeString(body.name, 'name', 255)
  const code = sanitizeString(body.code, 'code', 255).toUpperCase()

  let description: string | null = null
  if (body.description !== undefined && body.description !== null) {
    description = sanitizeString(body.description, 'description', 2000)
  }

  const existing = await db.project.findUnique({ where: { code } })
  if (existing) {
    throw new HttpError(409, 'code_taken', 'A project with this code already exists.')
  }

  const project = await db.$transaction(async (tx) => {
    const p = await tx.project.create({
      data: {
        name,
        code,
        description,
        ownerId: ctx.user.id,
        isActive: true,
      },
    })
    await tx.projectMember.create({
      data: {
        projectId: p.id,
        userId: ctx.user.id,
        role: 'project_manager',
      },
    })
    return p
  })

  return Response.json(
    {
      id: project.id,
      name: project.name,
      code: project.code,
      description: project.description,
      ownerId: project.ownerId,
      isActive: project.isActive,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    },
    { status: 201 },
  )
})
