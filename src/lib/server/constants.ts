import type { Role, TaskPriority, TaskStatus } from '@/types'

export const ROLES: Role[] = [
  'admin',
  'project_manager',
  'engineer',
  'foreman',
  'viewer',
]

export const PRIORITIES: TaskPriority[] = ['P1', 'P2', 'P3']
export const STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'done']

export const MARKUP_TYPES = [
  'pin',
  'rectangle',
  'circle',
  'cloud',
  'polyline',
  'arrow',
  'text',
] as const

// File size + mime validation
export const MAX_FILE_SIZE_MB = Number(process.env.MAX_FILE_SIZE_MB ?? 50)
export const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024
export const ALLOWED_PLAN_MIMES = (process.env.ALLOWED_PLAN_MIMES ?? 'application/pdf,image/png,image/jpeg,image/webp').split(',')
export const ALLOWED_ATTACHMENT_MIMES = (process.env.ALLOWED_ATTACHMENT_MIMES ?? 'image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain').split(',')

// Role hierarchy — higher index = more permissions.
const ROLE_RANK: Record<Role, number> = {
  viewer: 0,
  foreman: 1,
  engineer: 2,
  project_manager: 3,
  admin: 4,
}

/** Returns true if `actor` role has at least the `required` role level. */
export function roleAtLeast(actor: Role, required: Role): boolean {
  return ROLE_RANK[actor] >= ROLE_RANK[required]
}

/** Roles that may write (create/update/delete) tasks, markups, comments, attachments. */
export function canWrite(role: Role): boolean {
  return roleAtLeast(role, 'foreman')
}

/** Roles that may manage project membership + settings. */
export function canManageProject(role: Role): boolean {
  return roleAtLeast(role, 'project_manager')
}

/** Roles that may delete projects entirely. */
export function canDeleteProject(role: Role): boolean {
  return roleAtLeast(role, 'admin')
}

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  P1: '#dc2626', // red-600
  P2: '#f59e0b', // amber-500
  P3: '#22c55e', // green-500
}

export const STATUS_COLORS: Record<TaskStatus, string> = {
  open: '#3b82f6',         // blue-500
  in_progress: '#f59e0b',  // amber-500
  blocked: '#dc2626',     // red-600
  done: '#22c55e',         // green-500
}
