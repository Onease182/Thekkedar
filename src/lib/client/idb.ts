// IndexedDB layer for offline cache + sync queue.
// Stores: projects, plans, markups, tasks, comments, attachments, checklists, notifications,
// and a `syncQueue` of pending mutations.

import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type {
  ProjectFE,
  PlanFE,
  MarkupFE,
  TaskFE,
  TaskCommentFE,
  TaskAttachmentFE,
  TaskChecklistFE,
  NotificationFE,
  MarkupAttachmentFE,
} from './types'

// ───────────────────────── Queue item shape ─────────────────────────

export interface QueueItem {
  id: string             // client-generated UUID for the queue entry
  localId?: string       // local temp id for optimistic UI (cuid generated client-side)
  method: 'POST' | 'PATCH' | 'DELETE'
  url: string            // relative path e.g. /api/projects/{id}/tasks
  body?: unknown         // JSON-serializable
  headers?: Record<string, string>
  timestamp: number      // epoch ms when enqueued
  retryCount: number
  lastError?: string
  status: 'pending' | 'in-flight' | 'failed-permanent' | 'synced'
  // For multipart uploads queued offline (rare): we store Blob + meta so SW can replay.
  isMultipart?: boolean
  multipartFieldName?: string
  multipartFileName?: string
  multipartMimeType?: string
  // For attachments queued as Blob
  blob?: Blob
}

interface PlanForgeDB extends DBSchema {
  projects: {
    key: string
    value: ProjectFE
    indexes: { 'by-updatedAt': string }
  }
  plans: {
    key: string
    value: PlanFE
    indexes: { 'by-project': string, 'by-updatedAt': string }
  }
  markups: {
    key: string
    value: MarkupFE
    indexes: { 'by-plan': string, 'by-updatedAt': string }
  }
  markupAttachments: {
    key: string
    value: MarkupAttachmentFE
    indexes: { 'by-markup': string }
  }
  tasks: {
    key: string
    value: TaskFE
    indexes: { 'by-project': string, 'by-plan': string, 'by-updatedAt': string }
  }
  comments: {
    key: string
    value: TaskCommentFE
    indexes: { 'by-task': string, 'by-updatedAt': string }
  }
  taskAttachments: {
    key: string
    value: TaskAttachmentFE
    indexes: { 'by-task': string }
  }
  checklists: {
    key: string
    value: TaskChecklistFE
    indexes: { 'by-task': string }
  }
  notifications: {
    key: string
    value: NotificationFE
    indexes: { 'by-created': string, 'by-unread': string }
  }
  syncQueue: {
    key: string
    value: QueueItem
    indexes: { 'by-status': string, 'by-timestamp': number }
  }
  // last-sync cursor per project
  syncCursor: {
    key: string  // projectId
    value: { projectId: string; until: string }
  }
}

let _dbPromise: Promise<IDBPDatabase<PlanForgeDB>> | null = null

export function getDB(): Promise<IDBPDatabase<PlanForgeDB>> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  if (!_dbPromise) {
    _dbPromise = openDB<PlanForgeDB>('planforge', 1, {
      upgrade(db) {
        const projects = db.createObjectStore('projects', { keyPath: 'id' })
        projects.createIndex('by-updatedAt', 'updatedAt')

        const plans = db.createObjectStore('plans', { keyPath: 'id' })
        plans.createIndex('by-project', 'projectId')
        plans.createIndex('by-updatedAt', 'updatedAt')

        const markups = db.createObjectStore('markups', { keyPath: 'id' })
        markups.createIndex('by-plan', 'planId')
        markups.createIndex('by-updatedAt', 'updatedAt')

        const markupAttachments = db.createObjectStore('markupAttachments', { keyPath: 'id' })
        markupAttachments.createIndex('by-markup', 'markupId')

        const tasks = db.createObjectStore('tasks', { keyPath: 'id' })
        tasks.createIndex('by-project', 'projectId')
        tasks.createIndex('by-plan', 'planId')
        tasks.createIndex('by-updatedAt', 'updatedAt')

        const comments = db.createObjectStore('comments', { keyPath: 'id' })
        comments.createIndex('by-task', 'taskId')
        comments.createIndex('by-updatedAt', 'updatedAt')

        const taskAttachments = db.createObjectStore('taskAttachments', { keyPath: 'id' })
        taskAttachments.createIndex('by-task', 'taskId')

        const checklists = db.createObjectStore('checklists', { keyPath: 'id' })
        checklists.createIndex('by-task', 'taskId')

        const notifications = db.createObjectStore('notifications', { keyPath: 'id' })
        notifications.createIndex('by-created', 'createdAt')
        // 'by-unread' index uses a derived key path via function (boolean can't be indexed directly,
        // so we index on a numeric isRead === false → 0)
        notifications.createIndex('by-unread', 'isRead')

        const syncQueue = db.createObjectStore('syncQueue', { keyPath: 'id' })
        syncQueue.createIndex('by-status', 'status')
        syncQueue.createIndex('by-timestamp', 'timestamp')

        db.createObjectStore('syncCursor', { keyPath: 'projectId' })
      },
    })
  }
  return _dbPromise
}

// ───────────────────────── Generators ─────────────────────────

// Client-side cuid-like generator for offline-created entities (idempotent retries).
export function genLocalId(prefix = ''): string {
  const ts = Date.now().toString(36)
  const rnd = Math.random().toString(36).slice(2, 10)
  return `${prefix}${ts}${rnd}`.slice(0, 24)
}

// ───────────────────────── Queue operations ─────────────────────────

export async function enqueueMutation(item: Omit<QueueItem, 'id' | 'timestamp' | 'retryCount' | 'status'>): Promise<QueueItem> {
  const db = await getDB()
  const full: QueueItem = {
    ...item,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retryCount: 0,
    status: 'pending',
  }
  await db.put('syncQueue', full)
  return full
}

export async function listPendingQueue(): Promise<QueueItem[]> {
  const db = await getDB()
  return db.getAllFromIndex('syncQueue', 'by-timestamp')
}

export async function countPendingQueue(): Promise<number> {
  const db = await getDB()
  const all = await db.getAllFromIndex('syncQueue', 'by-status', 'pending')
  return all.length
}

export async function updateQueueItem(id: string, patch: Partial<QueueItem>): Promise<void> {
  const db = await getDB()
  const existing = await db.get('syncQueue', id)
  if (!existing) return
  await db.put('syncQueue', { ...existing, ...patch })
}

export async function deleteQueueItem(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('syncQueue', id)
}

// ───────────────────────── Cache operations (entities) ─────────────────────────

export async function cacheProject(p: ProjectFE): Promise<void> {
  const db = await getDB()
  await db.put('projects', p)
}

export async function cacheProjects(items: ProjectFE[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('projects', 'readwrite')
  await Promise.all(items.map((p) => tx.store.put(p)))
  await tx.done
}

export async function getCachedProjects(): Promise<ProjectFE[]> {
  const db = await getDB()
  return db.getAllFromIndex('projects', 'by-updatedAt')
}

export async function cachePlans(items: PlanFE[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('plans', 'readwrite')
  await Promise.all(items.map((p) => tx.store.put(p)))
  await tx.done
}

export async function getCachedPlansByProject(projectId: string): Promise<PlanFE[]> {
  const db = await getDB()
  return db.getAllFromIndex('plans', 'by-project', projectId)
}

export async function cacheMarkups(items: MarkupFE[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('markups', 'readwrite')
  await Promise.all(items.map((m) => tx.store.put(m)))
  await tx.done
}

export async function getCachedMarkupsByPlan(planId: string): Promise<MarkupFE[]> {
  const db = await getDB()
  return db.getAllFromIndex('markups', 'by-plan', planId)
}

export async function cacheTasks(items: TaskFE[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('tasks', 'readwrite')
  await Promise.all(items.map((t) => tx.store.put(t)))
  await tx.done
}

export async function getCachedTasksByProject(projectId: string): Promise<TaskFE[]> {
  const db = await getDB()
  return db.getAllFromIndex('tasks', 'by-project', projectId)
}

export async function getCachedTask(id: string): Promise<TaskFE | undefined> {
  const db = await getDB()
  return db.get('tasks', id)
}

export async function cacheTask(t: TaskFE): Promise<void> {
  const db = await getDB()
  await db.put('tasks', t)
}

export async function cacheComments(items: TaskCommentFE[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('comments', 'readwrite')
  await Promise.all(items.map((c) => tx.store.put(c)))
  await tx.done
}

export async function getCachedCommentsByTask(taskId: string): Promise<TaskCommentFE[]> {
  const db = await getDB()
  return db.getAllFromIndex('comments', 'by-task', taskId)
}

export async function cacheNotifications(items: NotificationFE[]): Promise<void> {
  const db = await getDB()
  const tx = db.transaction('notifications', 'readwrite')
  await Promise.all(items.map((n) => tx.store.put(n)))
  await tx.done
}

export async function getCachedNotifications(): Promise<NotificationFE[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('notifications', 'by-created')
  return all.reverse() // newest first
}

// Drop a task from the cache when its server-side soft-delete replicates
export async function dropCachedTask(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('tasks', id)
}

// ───────────────────────── Sync cursor ─────────────────────────

export async function getSyncCursor(projectId: string): Promise<string | null> {
  const db = await getDB()
  const rec = await db.get('syncCursor', projectId)
  return rec?.until ?? null
}

export async function setSyncCursor(projectId: string, until: string): Promise<void> {
  const db = await getDB()
  await db.put('syncCursor', { projectId, until })
}

// Last-write-wins conflict resolution: returns true if the local item's updatedAt
// is newer than or equal to the incoming one. Server is the source of truth — if the
// server's `updatedAt` is later than what we have cached, server wins.
export function newer(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false
  if (!b) return true
  return new Date(a).getTime() >= new Date(b).getTime()
}
