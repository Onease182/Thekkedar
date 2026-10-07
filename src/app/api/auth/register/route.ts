import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import {
  hashPassword,
  signAccessToken,
  signRefreshToken,
  storeRefreshToken,
  toAuthUser,
  isValidRole,
} from '@/lib/server/auth'
import { ROLES } from '@/lib/server/constants'
import { withErrors, readJson, HttpError } from '@/lib/server/permissions'
import type { Role } from '@/types'

const ACCESS_TTL_MS = 15 * 60 * 1000
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

interface RegisterBody {
  email?: unknown
  password?: unknown
  fullName?: unknown
  role?: unknown
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

export const POST = withErrors(async (req: NextRequest) => {
  const body = await readJson<RegisterBody>(req)

  const email = sanitizeString(body.email, 'email', 255).toLowerCase()
  if (!EMAIL_RE.test(email)) {
    throw new HttpError(400, 'invalid_email', 'Email format is invalid.')
  }

  if (typeof body.password !== 'string' || body.password.length < 8) {
    throw new HttpError(400, 'weak_password', 'Password must be at least 8 characters.')
  }
  if (body.password.length > 256) {
    throw new HttpError(400, 'weak_password', 'Password must be at most 256 characters.')
  }
  const password = body.password

  const fullName = sanitizeString(body.fullName, 'fullName', 255)

  let role: Role = 'engineer'
  if (body.role !== undefined && body.role !== null) {
    if (typeof body.role !== 'string' || !isValidRole(body.role)) {
      throw new HttpError(400, 'invalid_role', `Role must be one of: ${ROLES.join(', ')}.`)
    }
    role = body.role
  }

  const existing = await db.user.findUnique({ where: { email } })
  if (existing) {
    throw new HttpError(409, 'email_taken', 'A user with this email already exists.')
  }

  const passwordHash = hashPassword(password)
  const user = await db.user.create({
    data: { email, passwordHash, fullName, role },
  })

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
    { status: 201 },
  )
})
