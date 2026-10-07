import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  rotateRefreshToken,
  signAccessToken,
  toAuthUser,
} from '@/lib/server/auth'
import { withErrors, readJson, HttpError } from '@/lib/server/permissions'
import type { Role } from '@/types'

const ACCESS_TTL_MS = 15 * 60 * 1000

interface RefreshBody {
  refreshToken?: unknown
}

export const POST = withErrors(async (req: NextRequest) => {
  const body = await readJson<RefreshBody>(req)

  const refreshToken =
    typeof body.refreshToken === 'string' ? body.refreshToken.trim() : ''
  if (!refreshToken) {
    throw new HttpError(400, 'invalid_refresh_token', 'Refresh token is required.')
  }

  const rotated = await rotateRefreshToken(refreshToken)
  if (!rotated) {
    throw new HttpError(401, 'invalid_refresh_token', 'Refresh token is invalid or expired.')
  }

  const user = await db.user.findUnique({ where: { id: rotated.userId } })
  if (!user) {
    throw new HttpError(401, 'user_not_found', 'User no longer exists.')
  }

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role as Role,
  })

  return Response.json(
    {
      user: toAuthUser({ ...user, role: user.role as Role }),
      accessToken,
      refreshToken: rotated.newToken,
      expiresAt: Date.now() + ACCESS_TTL_MS,
    },
    { status: 200 },
  )
})
