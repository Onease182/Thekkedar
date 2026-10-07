'use client'

import * as React from 'react'
import { Plus, Trash2, Link2, Loader2, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { apiPost, apiGet, apiDelete, isQueuedError, ApiError } from '@/lib/client/api'
import { useUiStore } from '@/stores/ui'
import { useRouterStore } from '@/stores/router'
import type { TaskStatus } from '@/types'
import { StatusBadge } from './shared'

// Actual API response shape — the relatedTask is a nested object (or null).
interface RelationRow {
  id: string
  taskId: string
  relatedTaskId: string
  relationType: string
  relatedTask: { id: string; title: string; status: string } | null
  // Be defensive — older client types may have flattened fields.
  relatedTaskTitle?: string
  relatedTaskStatus?: string
}

const RELATION_TYPES = ['blocks', 'blocked_by', 'related', 'duplicate'] as const
type RelationType = (typeof RELATION_TYPES)[number]

const RELATION_LABEL: Record<RelationType, string> = {
  blocks: 'Blocks',
  blocked_by: 'Blocked by',
  related: 'Related to',
  duplicate: 'Duplicate of',
}

interface Props {
  taskId: string
  projectId: string
  canWrite: boolean
}

export function RelationsTab({ taskId, projectId, canWrite }: Props) {
  const showToast = useUiStore((s) => s.showToast)
  const navigate = useRouterStore((s) => s.navigate)
  const [relations, setRelations] = React.useState<RelationRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [draftTaskId, setDraftTaskId] = React.useState('')
  const [draftType, setDraftType] = React.useState<RelationType>('related')
  const [adding, setAdding] = React.useState(false)

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<{ relations: RelationRow[] }>(`/tasks/${taskId}/relations`)
      setRelations(data?.relations ?? [])
    } catch (e) {
      if (!isQueuedError(e)) showToast({ title: 'Failed to load relations', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [showToast, taskId])

  React.useEffect(() => { void load() }, [load])

  const add = async () => {
    const id = draftTaskId.trim()
    if (!id || !canWrite) return
    setAdding(true)
    const optimistic: RelationRow = {
      id: `local-${Date.now()}`,
      taskId,
      relatedTaskId: id,
      relationType: draftType,
      relatedTask: null,
    }
    setRelations((cur) => [...cur, optimistic])
    setDraftTaskId('')
    try {
      const created = await apiPost<RelationRow>(`/tasks/${taskId}/relations`, {
        relatedTaskId: id,
        relationType: draftType,
      })
      setRelations((cur) => cur.map((r) => (r.id === optimistic.id ? created : r)))
      // Refetch to get the related task title/status
      void load()
      showToast({ title: 'Relation added', variant: 'success' })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setRelations((cur) => cur.filter((r) => r.id !== optimistic.id))
        const msg = e instanceof ApiError ? e.message : 'Add failed'
        showToast({ title: 'Add failed', description: msg, variant: 'error' })
      }
    } finally {
      setAdding(false)
    }
  }

  const remove = async (id: string) => {
    const prev = relations
    setRelations((cur) => cur.filter((r) => r.id !== id))
    try {
      await apiDelete(`/task_relations/${id}`)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setRelations(prev)
        showToast({ title: 'Delete failed', variant: 'error' })
      }
    }
  }

  if (loading && relations.length === 0) {
    return (
      <div className="space-y-3 py-4">
        {[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    )
  }

  return (
    <div className="py-2 space-y-4">
      {relations.length === 0 ? (
        <div className="text-center py-10 text-sm text-zinc-500">
          <Link2 className="h-6 w-6 mx-auto text-zinc-300 mb-2" />
          No relations yet. {canWrite && 'Link this task to another to track dependencies or duplicates.'}
        </div>
      ) : (
        <ul className="space-y-2">
          {relations.map((r) => {
            const title = r.relatedTask?.title ?? r.relatedTaskTitle ?? '—'
            const status = (r.relatedTask?.status ?? r.relatedTaskStatus ?? 'open') as TaskStatus
            const id = r.relatedTaskId
            return (
              <li
                key={r.id}
                className="flex items-center gap-3 border border-zinc-200 rounded-lg p-3 bg-white"
              >
                <Badge type={r.relationType as RelationType} />
                <ArrowRight className="h-4 w-4 text-zinc-400 shrink-0" />
                <button
                  type="button"
                  onClick={() => navigate('task-detail', { projectId, taskId: id })}
                  className="flex-1 min-w-0 text-left"
                  title={`Open task ${id}`}
                >
                  <div className="text-sm font-medium text-zinc-900 truncate hover:underline">{title}</div>
                  <div className="text-xs text-zinc-500 font-mono truncate">{id}</div>
                </button>
                <StatusBadge status={status} />
                {canWrite && (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:text-red-700 shrink-0" aria-label="Delete relation">
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Remove relation?</AlertDialogTitle>
                        <AlertDialogDescription>The link between these two tasks will be removed.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={() => void remove(r.id)}>
                          Remove
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canWrite && (
        <div className="border-t border-zinc-200 pt-3 flex flex-col sm:flex-row gap-2">
          <Input
            value={draftTaskId}
            onChange={(e) => setDraftTaskId(e.target.value)}
            placeholder="Paste related task ID…"
            className="font-mono text-xs h-9 sm:max-w-xs"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void add() }
            }}
          />
          <Select value={draftType} onValueChange={(v) => setDraftType(v as RelationType)}>
            <SelectTrigger className="h-9 sm:w-44 w-full">
              <SelectValue placeholder="Relation type" />
            </SelectTrigger>
            <SelectContent>
              {RELATION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>{RELATION_LABEL[t]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={() => void add()} disabled={!draftTaskId.trim() || adding} className="h-9">
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add relation
          </Button>
        </div>
      )}
    </div>
  )
}

function Badge({ type }: { type: RelationType }) {
  const styles: Record<RelationType, string> = {
    blocks: 'bg-red-100 text-red-700 border-red-200',
    blocked_by: 'bg-amber-100 text-amber-800 border-amber-200',
    related: 'bg-zinc-100 text-zinc-700 border-zinc-200',
    duplicate: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  }
  return (
    <span className={`px-2 py-0.5 rounded-md text-xs font-medium border whitespace-nowrap ${styles[type]}`}>
      {RELATION_LABEL[type]}
    </span>
  )
}
