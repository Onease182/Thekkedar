import { db } from '@/lib/db'
import type { NotificationType, Role } from '@/types'

/** Creates a single notification row. */
export async function createNotification(opts: {
  userId: string
  type: NotificationType
  title: string
  body?: string
  relatedTaskId?: string
  relatedProjectId?: string
}): Promise<void> {
  // Don't notify yourself about your own action.
  if (opts.relatedTaskId) {
    const task = await db.task.findUnique({ where: { id: opts.relatedTaskId } })
    if (task?.createdById === opts.userId && opts.type !== 'task_comment') return
  }
  await db.notification.create({
    data: {
      userId: opts.userId,
      type: opts.type,
      title: opts.title,
      body: opts.body,
      relatedTaskId: opts.relatedTaskId,
      relatedProjectId: opts.relatedProjectId,
    },
  })
}

/** Notify on task assignment. */
export async function notifyTaskAssigned(taskId: string, assigneeId: string, byUserName: string, taskTitle: string): Promise<void> {
  if (!assigneeId) return
  await createNotification({
    userId: assigneeId,
    type: 'task_assigned',
    title: `Task assigned to you`,
    body: `${byUserName} assigned you: "${taskTitle}"`,
    relatedTaskId: taskId,
  })
  // Ensure assignee is a watcher
  await db.taskWatcher.upsert({
    where: { taskId_userId: { taskId, userId: assigneeId } },
    create: { taskId, userId: assigneeId },
    update: {},
  })
}

/** Notify on significant status change (to done). */
export async function notifyTaskStatusChanged(taskId: string, newStatus: string, byUserName: string, taskTitle: string): Promise<void> {
  if (newStatus !== 'done') return
  const watchers = await db.taskWatcher.findMany({ where: { taskId } })
  for (const w of watchers) {
    await createNotification({
      userId: w.userId,
      type: 'task_status_changed',
      title: `Task marked done`,
      body: `${byUserName} marked "${taskTitle}" as done.`,
      relatedTaskId: taskId,
    })
  }
}

/** Notify on a comment added (assignee + watchers, excluding the author). */
export async function notifyTaskComment(taskId: string, authorId: string, authorName: string, taskTitle: string, commentBody: string): Promise<void> {
  const watchers = await db.taskWatcher.findMany({ where: { taskId } })
  const task = await db.task.findUnique({ where: { id: taskId } })
  const recipients = new Set<string>()
  if (task?.assigneeId) recipients.add(task.assigneeId)
  for (const w of watchers) recipients.add(w.userId)
  recipients.delete(authorId)
  for (const userId of recipients) {
    await createNotification({
      userId,
      type: 'task_comment',
      title: `New comment on "${taskTitle}"`,
      body: commentBody.slice(0, 200),
      relatedTaskId: taskId,
      relatedProjectId: task?.projectId,
    })
  }
}

/** Convenience: ensure all project members with write permission are watchers? (No — only opt-in.) */
export function roleIsAtLeast(role: Role, required: Role): boolean {
  const rank: Record<Role, number> = { viewer: 0, foreman: 1, engineer: 2, project_manager: 3, admin: 4 }
  return rank[role] >= rank[required]
}
