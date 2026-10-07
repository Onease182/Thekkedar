import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  verifyPassword,
  signAccessToken,
  signRefreshToken,
  storeRefreshToken,
  toAuthUser,
} from '@/lib/server/auth'
import { withErrors, readJson, HttpError } from '@/lib/server/permissions'
import type { Role } from '@/types'

const ACCESS_TTL_MS = 15 * 60 * 1000

interface LoginBody {
  email?: unknown
  password?: unknown
}

export const POST = withErrors(async (req: NextRequest) => {
  const body = await readJson<LoginBody>(req)

  const email =
    typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body.password === 'string' ? body.password : ''

  if (!email || !password) {
    throw new HttpError(400, 'invalid_credentials', 'Email and password are required.')
  }

  const user = await db.user.findUnique({ where: { email } })
  if (!user || !verifyPassword(password, user.passwordHash)) {
    throw new HttpError(401, 'invalid_credentials', 'Invalid email or password.')
  }

  const accessToken = signAccessToken({
    id: user.id,
    email: user.email,
    role: user.role as Role,
  })
  const { token: refreshToken, expiresAt: refreshExpiresAt } = signRefreshToken(user.id)
  await storeRefreshToken(user.id, refreshToken, refreshExpiresAt)

  return Response.json(
    {
      user: toAuthUser({ ...user, role: user.role as Role }),
      accessToken,
      refreshToken,
      expiresAt: Date.now() + ACCESS_TTL_MS,
    },
    { status: 200 },
  )
})
