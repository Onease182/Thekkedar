import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { db } from '@/lib/db'
import type { AuthUser, Role } from '@/types'
import { ROLES } from './constants'

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'planforge-access-secret-change-me'
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'planforge-refresh-secret-change-me'
const ACCESS_TTL = Number(process.env.JWT_ACCESS_TTL ?? 900) // 15 min
const REFRESH_TTL = Number(process.env.JWT_REFRESH_TTL ?? 604800) // 7 days

export interface AccessJwtPayload {
  sub: string // user id
  email: string
  role: Role
  type: 'access'
}

export interface RefreshJwtPayload {
  sub: string
  jti: string
  type: 'refresh'
}

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, 10)
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash)
}

export function signAccessToken(user: { id: string; email: string; role: Role }): string {
  const payload: AccessJwtPayload = { sub: user.id, email: user.email, role: user.role, type: 'access' }
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL })
}

export function signRefreshToken(userId: string): { token: string; jti: string; expiresAt: Date } {
  const jti = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + REFRESH_TTL * 1000)
  const payload: RefreshJwtPayload = { sub: userId, jti, type: 'refresh' }
  const token = jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL })
  return { token, jti, expiresAt }
}

export function verifyAccessToken(token: string): AccessJwtPayload | null {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET) as AccessJwtPayload
    if (decoded.type !== 'access') return null
    return decoded
  } catch {
    return null
  }
}

export function verifyRefreshToken(token: string): RefreshJwtPayload | null {
  try {
    const decoded = jwt.verify(token, REFRESH_SECRET) as RefreshJwtPayload
    if (decoded.type !== 'refresh') return null
    return decoded
  } catch {
    return null
  }
}

// Persist + revoke refresh tokens (rotating). Stored hashed so DB leak can't replay.
async function hashToken(token: string): Promise<string> {
  // Simple SHA-256 hash via Web Crypto when available; fallback to bcrypt.
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(token).digest('hex')
}

export async function storeRefreshToken(userId: string, token: string, expiresAt: Date): Promise<string> {
  const tokenHash = await hashToken(token)
  const record = await db.refreshToken.create({
    data: { userId, tokenHash, expiresAt },
  })
  return record.id
}

export async function rotateRefreshToken(oldToken: string): Promise<{ userId: string; newToken: string; expiresAt: Date } | null> {
  const payload = verifyRefreshToken(oldToken)
  if (!payload) return null
  const tokenHash = await hashToken(oldToken)
  const existing = await db.refreshToken.findUnique({ where: { tokenHash } })
  if (!existing || existing.revokedAt) return null

  // Revoke old, issue new
  await db.refreshToken.update({ where: { id: existing.id }, data: { revokedAt: new Date() } })
  const { token: newToken, jti, expiresAt } = signRefreshToken(existing.userId)
  await storeRefreshToken(existing.userId, newToken, expiresAt)
  void jti
  return { userId: existing.userId, newToken, expiresAt }
}

export async function revokeRefreshToken(token: string): Promise<void> {
  const tokenHash = await hashToken(token)
  await db.refreshToken.updateMany({ where: { tokenHash }, data: { revokedAt: new Date() } })
}

export function toAuthUser(u: { id: string; email: string; fullName: string; role: Role; createdAt: Date; updatedAt: Date }): AuthUser {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role as Role,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
  }
}

export function isValidRole(value: string): value is Role {
  return (ROLES as string[]).includes(value)
}
