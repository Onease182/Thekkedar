'use client'

import * as React from 'react'
import { Send, Pencil, Trash2, X, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { apiGet, apiPost, apiPatch, apiDelete, isQueuedError, ApiError } from '@/lib/client/api'
import { getCachedCommentsByTask, cacheComments, genLocalId } from '@/lib/client/idb-offline'
import { useUiStore } from '@/stores/ui'
import { useAuthStore } from '@/stores/auth'
import type { TaskCommentFE, AuthUserFE, Role } from '@/lib/client/types'
import { UserAvatar, formatRelative, formatDateTime } from './shared'

interface Props {
  taskId: string
  canWrite: boolean
  /** Project role (for "delete any" permission). */
  role: Role
}

export function CommentsTab({ taskId, canWrite, role }: Props) {
  const showToast = useUiStore((s) => s.showToast)
  const user = useAuthStore((s) => s.user) as AuthUserFE | null
  const [comments, setComments] = React.useState<TaskCommentFE[]>([])
  const [loading, setLoading] = React.useState(true)
  const [draft, setDraft] = React.useState('')
  const [posting, setPosting] = React.useState(false)
  const listRef = React.useRef<HTMLDivElement | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    // Optimistic: show cached comments immediately if present.
    const cached = await getCachedCommentsByTask(taskId)
    if (cached.length > 0) setComments(cached)
    try {
      const data = await apiGet<{ comments: TaskCommentFE[] }>(`/tasks/${taskId}/comments`)
      const next = data?.comments ?? []
      setComments(next)
      await cacheComments(taskId, next)
    } catch (e) {
      // network error — already showed cached if present
      if (!isQueuedError(e)) {
        showToast({ title: 'Failed to load comments', variant: 'error' })
      }
    } finally {
      setLoading(false)
    }
  }, [showToast, taskId])

  React.useEffect(() => {
    void load()
  }, [load])

  // Scroll to bottom when list grows.
  React.useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [comments.length])

  const canDelete = (c: TaskCommentFE) => {
    if (!user) return false
    if (c.authorId === user.id) return true
    // project_manager / admin can delete any
    return role === 'project_manager' || role === 'admin'
  }

  const handlePost = async () => {
    const text = draft.trim()
    if (!text || !canWrite) return
    setPosting(true)
    const localId = genLocalId()
    const optimistic: TaskCommentFE = {
      id: localId,
      taskId,
      authorId: user?.id ?? 'me',
      authorName: user?.fullName ?? 'You',
      body: text,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setComments((cur) => [...cur, optimistic])
    setDraft('')
    try {
      const created = await apiPost<TaskCommentFE>(`/tasks/${taskId}/comments`, { body: text })
      setComments((cur) => cur.map((c) => (c.id === localId ? created : c)))
      // Re-cache
      setComments((cur) => {
        void cacheComments(taskId, cur)
        return cur
      })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', description: 'Your comment will sync when you reconnect.', variant: 'warning' })
      } else {
        // Roll back optimistic on hard error
        setComments((cur) => cur.filter((c) => c.id !== localId))
        setDraft(text)
        const msg = e instanceof ApiError ? e.message : 'Failed to post comment'
        showToast({ title: 'Comment failed', description: msg, variant: 'error' })
      }
    } finally {
      setPosting(false)
    }
  }

  const handleEdit = async (id: string, next: string) => {
    setComments((cur) => cur.map((c) => (c.id === id ? { ...c, body: next, updatedAt: new Date().toISOString() } : c)))
    try {
      await apiPatch(`/comments/${id}`, { body: next })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', description: 'Edit will sync when you reconnect.', variant: 'warning' })
      } else {
        showToast({ title: 'Edit failed', variant: 'error' })
        void load()
      }
    }
  }

  const handleDelete = async (id: string) => {
    const prev = comments
    setComments((cur) => cur.filter((c) => c.id !== id))
    try {
      await apiDelete(`/comments/${id}`)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setComments(prev)
        showToast({ title: 'Delete failed', variant: 'error' })
      }
    }
  }

  if (loading && comments.length === 0) {
    return (
      <div className="space-y-4 py-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="h-7 w-7 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {comments.length === 0 ? (
        <div className="text-center py-12 text-sm text-zinc-500">
          No comments yet. {canWrite && 'Start the conversation below.'}
        </div>
      ) : (
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto pr-1 space-y-4 custom-scroll">
          {comments.map((c) => (
            <CommentRow
              key={c.id}
              comment={c}
              canEdit={!!user && c.authorId === user.id && canWrite}
              canDelete={canDelete(c) && canWrite}
              onEdit={(next) => handleEdit(c.id, next)}
              onDelete={() => handleDelete(c.id)}
            />
          ))}
        </div>
      )}

      {canWrite && (
        <div className="border-t border-zinc-200 pt-3">
          <div className="flex items-start gap-2">
            <UserAvatar name={user?.fullName} />
            <div className="flex-1 space-y-2">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a comment…"
                className="min-h-16"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void handlePost()
                  }
                }}
              />
              <div className="flex items-center justify-between">
                <span className="text-xs text-zinc-400">Cmd/Ctrl + Enter to post</span>
                <Button size="sm" onClick={() => void handlePost()} disabled={!draft.trim() || posting}>
                  {posting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  Post
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function CommentRow({
  comment,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  comment: TaskCommentFE
  canEdit: boolean
  canDelete: boolean
  onEdit: (next: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(comment.body)
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => setDraft(comment.body), [comment.body])

  const commit = async () => {
    const next = draft.trim()
    setEditing(false)
    if (next === comment.body) return
    setSaving(true)
    await onEdit(next)
    setSaving(false)
  }

  return (
    <div className="flex gap-3">
      <UserAvatar name={comment.authorName} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span className="font-medium text-zinc-900 text-sm">{comment.authorName || 'Someone'}</span>
          <span title={formatDateTime(comment.createdAt)}>{formatRelative(comment.createdAt)}</span>
          {saving && <Loader2 className="h-3 w-3 animate-spin" />}
        </div>
        {editing ? (
          <div className="mt-1 space-y-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              className="min-h-16"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void commit() }
                if (e.key === 'Escape') { e.preventDefault(); setEditing(false); setDraft(comment.body) }
              }}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void commit()}>Save</Button>
              <Button size="sm" variant="outline" onClick={() => { setEditing(false); setDraft(comment.body) }}>
                <X className="h-3.5 w-3.5" />Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-1 text-sm text-zinc-800 whitespace-pre-wrap break-words">{comment.body}</div>
        )}
        {!editing && (canEdit || canDelete) && (
          <div className="mt-1 flex gap-1">
            {canEdit && (
              <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditing(true)}>
                <Pencil className="h-3 w-3" />Edit
              </Button>
            )}
            {canDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-red-600 hover:text-red-700">
                    <Trash2 className="h-3 w-3" />Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete comment?</AlertDialogTitle>
                    <AlertDialogDescription>This action cannot be undone.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={onDelete}>
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
