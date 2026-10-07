import type { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireAuth, requireProjectMember, withErrors } from '@/lib/server/permissions'

export const dynamic = 'force-dynamic'

function startOfWeek(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  // Treat Monday as the start of the week.
  const day = r.getDay() // 0=Sun..6=Sat
  const diff = (day + 6) % 7
  r.setDate(r.getDate() - diff)
  return r
}

// GET /api/projects/[projectId]/tasks/summary — aggregated counts by status,
// priority, assignee, category, trade, plus overdue/dueThisWeek totals.
export const GET = withErrors(
  async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params; const projectId = id
    const ctx = await requireAuth(req)
    await requireProjectMember(projectId, ctx)

    const tasks = await db.task.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        status: true,
        priority: true,
        assigneeId: true,
        category: true,
        trade: true,
        dueDate: true,
      },
    })

    const total = tasks.length
    const byStatus: Record<string, number> = { open: 0, in_progress: 0, blocked: 0, done: 0 }
    const byPriority: Record<string, number> = { P1: 0, P2: 0, P3: 0 }
    const assigneeMap = new Map<string, number>()
    const categoryMap = new Map<string, number>()
    const tradeMap = new Map<string, number>()

    const weekStart = startOfWeek(new Date())
    const weekEnd = new Date(weekStart)
    weekEnd.setDate(weekEnd.getDate() + 7)

    const today = new Date()
    today.setHours(0, 0, 0, 0)

    let overdue = 0
    let dueThisWeek = 0

    for (const t of tasks) {
      if (byStatus[t.status] !== undefined) byStatus[t.status]++
      if (byPriority[t.priority] !== undefined) byPriority[t.priority]++
      if (t.assigneeId) assigneeMap.set(t.assigneeId, (assigneeMap.get(t.assigneeId) ?? 0) + 1)
      if (t.category) categoryMap.set(t.category, (categoryMap.get(t.category) ?? 0) + 1)
      if (t.trade) tradeMap.set(t.trade, (tradeMap.get(t.trade) ?? 0) + 1)
      if (t.dueDate) {
        const due = new Date(t.dueDate)
        if (t.status !== 'done' && due < today) overdue++
        if (due >= weekStart && due < weekEnd) dueThisWeek++
      }
    }

    const assigneeIds = Array.from(assigneeMap.keys())
    const users = assigneeIds.length
      ? await db.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, fullName: true } })
      : []
    const userMap = new Map(users.map((u) => [u.id, u.fullName]))

    const byAssignee = assigneeIds.map((id) => ({
      assigneeId: id,
      fullName: userMap.get(id) ?? 'Unknown',
      count: assigneeMap.get(id) ?? 0,
    }))
    const byCategory = Array.from(categoryMap.entries()).map(([category, count]) => ({ category, count }))
    const byTrade = Array.from(tradeMap.entries()).map(([trade, count]) => ({ trade, count }))

    return Response.json({
      total,
      byStatus,
      byPriority,
      byAssignee,
      byCategory,
      byTrade,
      overdue,
      dueThisWeek,
    })
  },
)
