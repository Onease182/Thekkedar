import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { toAuthUser } from '@/lib/server/auth'
import {
  requireAuth,
  withErrors,
  HttpError,
} from '@/lib/server/permissions'
import type { Role } from '@/types'

export const GET = withErrors(async (req: NextRequest) => {
  const ctx = await requireAuth(req)
  const user = await db.user.findUnique({ where: { id: ctx.user.id } })
  if (!user) {
    throw new HttpError(401, 'user_not_found', 'User no longer exists.')
  }
  return Response.json(
    { user: toAuthUser({ ...user, role: user.role as Role }) },
    { status: 200 },
  )
})
