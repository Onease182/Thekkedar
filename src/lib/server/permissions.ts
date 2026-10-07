import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { verifyAccessToken } from './auth'
import type { Role } from '@/types'
import { canWrite, canManageProject } from './constants'

export interface AuthContext {
  user: {
    id: string
    email: string
    role: Role
  }
}

export class HttpError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

/** Pull bearer token from Authorization header. */
function extractBearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!h) return null
  const m = /^Bearer\s+(.+)$/i.exec(h)
  return m ? m[1] : null
}

/** Returns the authenticated user, or throws 401. */
export async function requireAuth(req: NextRequest): Promise<AuthContext> {
  const token = extractBearer(req)
  if (!token) throw new HttpError(401, 'unauthenticated', 'Missing or invalid Authorization header.')
  const payload = verifyAccessToken(token)
  if (!payload) throw new HttpError(401, 'invalid_token', 'Access token is invalid or expired.')
  const user = await db.user.findUnique({ where: { id: payload.sub } })
  if (!user) throw new HttpError(401, 'user_not_found', 'User no longer exists.')
  return { user: { id: user.id, email: user.email, role: user.role as Role } }
}

/** Resolves project membership; throws if user is not a member. Returns the membership role. */
export async function requireProjectMember(projectId: string, ctx: AuthContext): Promise<{ role: Role }> {
  // Project owner is implicitly a project_manager-level member.
  const project = await db.project.findUnique({ where: { id: projectId } })
  if (!project) throw new HttpError(404, 'project_not_found', 'Project not found.')
  if (project.ownerId === ctx.user.id) return { role: 'project_manager' as Role }
  const member = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: ctx.user.id } },
  })
  if (!member) throw new HttpError(403, 'not_project_member', 'You are not a member of this project.')
  return { role: member.role as Role }
}

/** Require write permission within a project. */
export async function requireWrite(projectId: string, ctx: AuthContext): Promise<{ role: Role }> {
  const { role } = await requireProjectMember(projectId, ctx)
  if (!canWrite(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit write actions.')
  return { role }
}

/** Require project management permission. */
export async function requireProjectManage(projectId: string, ctx: AuthContext): Promise<{ role: Role }> {
  const { role } = await requireProjectMember(projectId, ctx)
  if (!canManageProject(role)) throw new HttpError(403, 'forbidden', 'Your role does not permit project management.')
  return { role }
}

/** JSON error helper */
export function jsonError(status: number, code: string, message: string, details?: Record<string, unknown>) {
  return Response.json({ error: { code, message, ...(details ? { details } : {}) } }, { status })
}

/** Wrap a route handler with uniform error handling. */
export function withErrors<T extends (req: NextRequest, ...args: any[]) => Promise<Response>>(
  handler: T,
): T {
  return (async (req: NextRequest, ...args: any[]) => {
    try {
      return await handler(req, ...args)
    } catch (e) {
      if (e instanceof HttpError) {
        return jsonError(e.status, e.code, e.message, e.details)
      }
      console.error('[api] unhandled error', e)
      return jsonError(500, 'internal_error', 'An internal server error occurred.')
    }
  }) as T
}

/** Helper: parse JSON body, throw HttpError on bad input. */
export async function readJson<T = Record<string, unknown>>(req: NextRequest): Promise<T> {
  try {
    return (await req.json()) as T
  } catch {
    throw new HttpError(400, 'invalid_json', 'Request body is not valid JSON.')
  }
}
