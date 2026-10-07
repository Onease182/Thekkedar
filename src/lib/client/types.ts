// Frontend-only types mirroring API responses (with JSON fields decoded).

import type { Role, TaskPriority, TaskStatus, MarkupType } from '@/types'

export interface AuthUserFE {
  id: string
  email: string
  fullName: string
  role: Role
  createdAt: string
  updatedAt: string
}

export interface ProjectFE {
  id: string
  name: string
  code: string
  description: string | null
  ownerId: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  role: Role
  memberCount?: number
  taskCounts?: Record<string, number>
}

export interface ProjectMemberFE {
  id: string
  userId: string
  role: Role
  email: string
  fullName: string
}

export interface PlanFE {
  id: string
  projectId: string
  title: string
  description: string | null
  fileName: string
  fileSize: number
  mimeType: string
  uploadedById: string
  uploadedByName: string
  createdAt: string
  updatedAt: string
}

export interface MarkupFE {
  id: string
  planId: string
  type: MarkupType
  pageNumber: number
  coordinates: string // JSON string per backend convention; UI decodes per type
  color: string
  metadata: string
  createdById: string
  createdByName: string
  createdAt: string
  updatedAt: string
  attachmentCount?: number
}

export interface MarkupAttachmentFE {
  id: string
  markupId: string
  fileName: string
  mimeType: string
  fileSize: number
  uploadedById: string
  uploadedByName: string
  createdAt: string
  url: string
}

export interface TaskFE {
  id: string
  projectId: string
  planId: string | null
  markupId: string | null
  pageNumber: number | null
  pinCoordinates: string | null
  title: string
  description: string | null
  assigneeId: string | null
  assigneeName?: string | null
  trade: string | null
  category: string | null
  locationName: string | null
  priority: TaskPriority
  status: TaskStatus
  dueDate: string | null
  startDate: string | null
  tags: string[]
  estimatedHours: number | null
  actualHours: number | null
  estimatedCost: number | null
  actualCost: number | null
  createdById: string
  createdByName: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  commentCount?: number
  attachmentCount?: number
}

export interface TaskCommentFE {
  id: string
  taskId: string
  authorId: string
  authorName: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface TaskAttachmentFE {
  id: string
  taskId: string
  fileName: string
  mimeType: string
  fileSize: number
  uploadedById: string
  uploadedByName: string
  createdAt: string
}

export interface TaskChecklistFE {
  id: string
  taskId: string
  title: string
  order: number
  items: TaskChecklistItemFE[]
}

export interface TaskChecklistItemFE {
  id: string
  checklistId: string
  text: string
  isChecked: boolean
  order: number
}

export interface TaskRelationFE {
  id: string
  taskId: string
  relatedTaskId: string
  relationType: string
  relatedTaskTitle: string
  relatedTaskStatus: string
}

export interface TaskSummaryFE {
  total: number
  byStatus: Record<string, number>
  byPriority: Record<string, number>
  byAssignee: { assigneeId: string | null; fullName: string | null; count: number }[]
  byCategory: { category: string | null; count: number }[]
  byTrade: { trade: string | null; count: number }[]
  overdue: number
  dueThisWeek: number
}

export interface NotificationFE {
  id: string
  userId: string
  type: string
  title: string
  body: string | null
  relatedTaskId: string | null
  relatedProjectId: string | null
  isRead: boolean
  createdAt: string
}

// View-state for the SPA router (no Next routing beyond /).
export type ViewName =
  | 'login'
  | 'register'
  | 'dashboard'
  | 'project'
  | 'plan-viewer'
  | 'task-detail'
  | 'profile'
  | 'notifications'

export interface ViewState {
  view: ViewName
  projectId?: string
  planId?: string
  taskId?: string
}
