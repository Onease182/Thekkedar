import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  requireAuth,
  requireProjectMember,
  requireProjectManage,
  withErrors,
  readJson,
  HttpError,
} from '@/lib/server/permissions'

interface ProjectParams {
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

export const GET = withErrors(async (req: NextRequest, { params }: ProjectParams) => {
  const ctx = await requireAuth(req)
  const { id } = await params
  await requireProjectMember(id, ctx)

  const project = await db.project.findUnique({ where: { id } })
  if (!project) {
    throw new HttpError(404, 'project_not_found', 'Project not found.')
  }

  const [memberCount, totalTasks, statusGroups] = await Promise.all([
    db.projectMember.count({ where: { projectId: id } }),
    db.task.count({ where: { projectId: id, deletedAt: null } }),
    db.task.groupBy({
      by: ['status'],
      where: { projectId: id, deletedAt: null },
      _count: { _all: true },
    }),
  ])

  const byStatus: Record<string, number> = {}
  for (const g of statusGroups) {
    byStatus[g.status] = g._count._all
  }

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
      memberCount,
      taskCounts: { total: totalTasks, byStatus },
    },
    { status: 200 },
  )
})

interface PatchProjectBody {
  name?: unknown
  description?: unknown
  code?: unknown
  isActive?: unknown
}

export const PATCH = withErrors(async (req: NextRequest, { params }: ProjectParams) => {
  const ctx = await requireAuth(req)
  const { id } = await params
  await requireProjectManage(id, ctx)

  const body = await readJson<PatchProjectBody>(req)
  const data: {
    name?: string
    description?: string | null
    code?: string
    isActive?: boolean
  } = {}

  if (body.name !== undefined) {
    data.name = sanitizeString(body.name, 'name', 255)
  }
  if (body.description !== undefined) {
    data.description =
      body.description === null
        ? null
        : sanitizeString(body.description, 'description', 2000)
  }
  if (body.code !== undefined) {
    data.code = sanitizeString(body.code, 'code', 255).toUpperCase()
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') {
      throw new HttpError(400, 'invalid_field', 'isActive must be a boolean.')
    }
    data.isActive = body.isActive
  }

  if (data.code) {
    const existing = await db.project.findUnique({ where: { code: data.code } })
    if (existing && existing.id !== id) {
      throw new HttpError(409, 'code_taken', 'A project with this code already exists.')
    }
  }

  const updated = await db.project.update({ where: { id }, data })

  return Response.json(
    {
      id: updated.id,
      name: updated.name,
      code: updated.code,
      description: updated.description,
      ownerId: updated.ownerId,
      isActive: updated.isActive,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    },
    { status: 200 },
  )
})

export const DELETE = withErrors(async (req: NextRequest, { params }: ProjectParams) => {
  const ctx = await requireAuth(req)
  const { id } = await params
  await requireProjectManage(id, ctx)

  // Hard delete — cascade removes members, plans, tasks, etc.
  await db.project.delete({ where: { id } })
  return Response.json({ ok: true }, { status: 200 })
})
