'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import {
  Bell,
  CheckCheck,
  CheckCircle,
  Loader2,
  MessageSquare,
  UserPlus,
  type LucideIcon,
} from 'lucide-react'
import { apiGet, apiPatch, apiPost, isQueuedError } from '@/lib/client/api'
import { useRouterStore } from '@/stores/router'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { NotificationFE } from '@/lib/client/types'

function iconFor(type: string): LucideIcon {
  switch (type) {
    case 'task_assigned':
      return UserPlus
    case 'task_status_changed':
      return CheckCircle
    case 'task_comment':
      return MessageSquare
    default:
      return Bell
  }
}

export function NotificationsView() {
  const online = useUiStore((s) => s.online)
  const showToast = useUiStore((s) => s.showToast)
  const navigate = useRouterStore((s) => s.navigate)

  const [items, setItems] = useState<NotificationFE[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)

  const fetchList = useCallback(async () => {
    try {
      const data = await apiGet<{ notifications: NotificationFE[]; unreadCount: number }>(
        '/notifications?unread=true&limit=50',
      )
      setItems(data.notifications)
      setUnreadCount(data.unreadCount)
    } catch {
      // Silently swallow — the connectivity bar already reports offline state.
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + start polling every 20s when online.
  useEffect(() => {
    void fetchList()
    if (!online) return
    const t = setInterval(() => {
      void fetchList()
    }, 20000)
    return () => clearInterval(t)
  }, [fetchList, online])

  const markAllRead = async () => {
    setMarkingAll(true)
    try {
      await apiPost('/notifications/mark-all-read')
      await fetchList()
      showToast({ title: 'All notifications marked read', variant: 'success' })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline — will sync when online' })
      } else {
        showToast({ title: 'Failed to mark all read', variant: 'error' })
      }
    } finally {
      setMarkingAll(false)
    }
  }

  const markOneRead = async (id: string) => {
    try {
      await apiPatch(`/notifications/${id}`, { isRead: true })
      setItems((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      )
      setUnreadCount((c) => Math.max(0, c - 1))
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline — will sync when online' })
      } else {
        showToast({ title: 'Failed to mark read', variant: 'error' })
      }
    }
  }

  const onNotificationClick = (n: NotificationFE) => {
    if (n.relatedTaskId) {
      navigate('task-detail', { taskId: n.relatedTaskId })
    }
  }

  const showSkeleton = loading && items.length === 0

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900">Notifications</h1>
          <p className="text-sm text-zinc-500">
            {unreadCount > 0 ? `${unreadCount} unread` : 'All caught up'}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={markAllRead}
          disabled={markingAll || items.length === 0}
        >
          {markingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCheck className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">Mark all read</span>
          <span className="sm:hidden">Mark all</span>
        </Button>
      </div>

      {showSkeleton ? (
        <Card>
          <CardContent className="py-10 flex items-center justify-center text-sm text-zinc-500 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-zinc-500 flex flex-col items-center gap-3">
            <Bell className="h-8 w-8 text-zinc-300" />
            <p className="text-sm">No notifications yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((n) => {
            const Icon = iconFor(n.type)
            const clickable = !!n.relatedTaskId
            return (
              <Card
                key={n.id}
                onClick={() => clickable && onNotificationClick(n)}
                role={clickable ? 'button' : undefined}
                tabIndex={clickable ? 0 : undefined}
                onKeyDown={(e) => {
                  if (!clickable) return
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNotificationClick(n)
                  }
                }}
                className={`transition-colors ${
                  clickable ? 'cursor-pointer hover:bg-zinc-50' : ''
                } ${!n.isRead ? 'border-l-4 border-l-zinc-900' : ''}`}
              >
                <CardContent className="flex items-start gap-3 py-4">
                  <div className="h-9 w-9 rounded-full bg-zinc-100 grid place-items-center shrink-0">
                    <Icon className="h-4 w-4 text-zinc-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="font-medium text-sm text-zinc-900 truncate">
                        {n.title}
                      </p>
                      {!n.isRead && (
                        <Badge
                          variant="secondary"
                          className="bg-zinc-900 text-white text-[10px]"
                        >
                          New
                        </Badge>
                      )}
                    </div>
                    {n.body && (
                      <p className="text-sm text-zinc-600 break-words whitespace-pre-line">
                        {n.body}
                      </p>
                    )}
                    <p className="text-xs text-zinc-400 mt-1">
                      {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true })}
                    </p>
                  </div>
                  {!n.isRead && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        void markOneRead(n.id)
                      }}
                      className="shrink-0"
                    >
                      Mark read
                    </Button>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
