// Shared application types — used across API routes and frontend.

export type Role = 'admin' | 'project_manager' | 'engineer' | 'foreman' | 'viewer'

export type MarkupType = 'pin' | 'rectangle' | 'circle' | 'cloud' | 'polyline' | 'arrow' | 'text'

export type TaskPriority = 'P1' | 'P2' | 'P3'
export type TaskStatus = 'open' | 'in_progress' | 'blocked' | 'done'

export type NotificationType =
  | 'task_assigned'
  | 'task_status_changed'
  | 'task_comment'

// JSON-coordinate payloads for markups. All coordinates are normalized 0..1
// relative to the page render box.
export interface PointXY { x: number; y: number }

export interface RectCoords { x: number; y: number; w: number; h: number }

export interface CircleCoords { x: number; y: number; r: number }

export interface PolylineCoords { points: PointXY[] }

export interface TextCoords { x: number; y: number; text: string }

// Auth
export interface AuthUser {
  id: string
  email: string
  fullName: string
  role: Role
  createdAt: string
  updatedAt: string
}

export interface AuthSession {
  user: AuthUser
  accessToken: string
  refreshToken: string
  expiresAt: number // epoch ms
}

// API standard error envelope
export interface ApiError {
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

// Sync response — entities updated since a timestamp
export interface SyncTask {
  id: string
  projectId: string
  planId: string | null
  markupId: string | null
  pageNumber: number | null
  pinCoordinates: string | null
  title: string
  description: string | null
  assigneeId: string | null
  trade: string | null
  category: string | null
  locationName: string | null
  priority: string
  status: string
  dueDate: string | null
  startDate: string | null
  tags: string
  estimatedHours: number | null
  actualHours: number | null
  estimatedCost: number | null
  actualCost: number | null
  createdById: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface SyncMarkup {
  id: string
  planId: string
  type: string
  pageNumber: number
  coordinates: string
  color: string
  metadata: string
  createdById: string
  createdAt: string
  updatedAt: string
}

export interface SyncComment {
  id: string
  taskId: string
  authorId: string
  body: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export interface SyncNotification {
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

// Sync response envelope — payload returned by GET /api/sync.
export interface SyncResponse {
  since: string | null
  until: string
  tasks: SyncTask[]
  markups: SyncMarkup[]
  comments: SyncComment[]
  notifications: SyncNotification[]
}
