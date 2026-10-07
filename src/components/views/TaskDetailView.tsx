'use client'

import * as React from 'react'
import { ArrowLeft, MoreVertical, Trash2, Pencil, Plus, X, MapPin, Loader2, CheckCircle2, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { apiGet, apiPatch, apiDelete, isQueuedError, ApiError } from '@/lib/client/api'
import { getCachedTask, cacheTask } from '@/lib/client/idb-offline'
import { useRouterStore } from '@/stores/router'
import { useAuthStore } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'
import type { TaskFE, ProjectMemberFE } from '@/lib/client/types'
import type { TaskPriority, TaskStatus, Role } from '@/types'
import { CommentsTab } from './task-detail/CommentsTab'
import { AttachmentsTab } from './task-detail/AttachmentsTab'
import { ChecklistsTab } from './task-detail/ChecklistsTab'
import { RelationsTab } from './task-detail/RelationsTab'
import {
  UserAvatar,
  PriorityBadge,
  StatusBadge,
  EditableText,
  formatDate,
  formatDateTime,
  formatRelative,
  toDateInputValue,
  FieldSkeleton,
} from './task-detail/shared'

const PRIORITIES: TaskPriority[] = ['P1', 'P2', 'P3']
const STATUSES: TaskStatus[] = ['open', 'in_progress', 'blocked', 'done']
const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

function roleCanWrite(role: Role | undefined): boolean {
  if (!role) return false
  return role !== 'viewer'
}

export function TaskDetailView() {
  const router = useRouterStore()
  const taskId = router.taskId
  const projectId = router.projectId
  const navigate = router.navigate
  const back = router.back

  const showToast = useUiStore((s) => s.showToast)
  const user = useAuthStore((s) => s.user)
  const role = user?.role as Role | undefined

  const [task, setTask] = React.useState<TaskFE | null>(null)
  const [members, setMembers] = React.useState<ProjectMemberFE[]>([])
  const [loading, setLoading] = React.useState(true)
  const [tab, setTab] = React.useState<'details' | 'comments' | 'attachments' | 'checklists' | 'relations'>('details')
  const [deleting, setDeleting] = React.useState(false)
  const [tagInput, setTagInput] = React.useState('')
  const [descriptionDraft, setDescriptionDraft] = React.useState('')
  const [descriptionDirty, setDescriptionDirty] = React.useState(false)

  const canWrite = roleCanWrite(role)

  const load = React.useCallback(async () => {
    if (!taskId) return
    setLoading(true)
    // Optimistic: pull from IDB cache first.
    const cached = await getCachedTask(taskId)
    if (cached) setTask(cached)
    try {
      const data = await apiGet<TaskFE>(`/tasks/${taskId}`)
      setTask(data)
      await cacheTask(data)
      setDescriptionDraft(data.description ?? '')
      setDescriptionDirty(false)
    } catch (e) {
      if (!isQueuedError(e)) {
        showToast({ title: 'Failed to load task', variant: 'error' })
      }
    } finally {
      setLoading(false)
    }
  }, [showToast, taskId])

  const loadMembers = React.useCallback(async () => {
    if (!projectId) return
    try {
      const data = await apiGet<{ members: ProjectMemberFE[] }>(`/projects/${projectId}/members`)
      setMembers(data?.members ?? [])
    } catch (e) {
      if (!isQueuedError(e)) {
        console.warn('Failed to load project members', e)
      }
    }
  }, [projectId])

  React.useEffect(() => {
    void load()
    void loadMembers()
  }, [load, loadMembers])

  // Update task + persist to IDB cache. Sends a PATCH in the background,
  // rolls back silently on hard error, surfaces a toast on QueuedError.
  const patchTask = React.useCallback(
    async (patch: Partial<TaskFE>, opts?: { silent?: boolean }) => {
      if (!task) return
      const prev = task
      const next = { ...prev, ...patch }
      setTask(next)
      void cacheTask(next)
      try {
        const updated = await apiPatch<TaskFE>(`/tasks/${prev.id}`, patch)
        // Merge server response (may include server-side fields like assigneeName).
        const merged = { ...next, ...updated }
        setTask(merged)
        void cacheTask(merged)
      } catch (e) {
        if (isQueuedError(e)) {
          if (!opts?.silent) {
            showToast({ title: 'Saved offline', description: 'Changes will sync when you reconnect.', variant: 'warning' })
          }
        } else {
          setTask(prev)
          void cacheTask(prev)
          const msg = e instanceof ApiError ? e.message : 'Update failed'
          showToast({ title: 'Update failed', description: msg, variant: 'error' })
        }
      }
    },
    [task, showToast],
  )

  const handleStatusChange = async (next: TaskStatus) => {
    if (!task || task.status === next) return
    const prev = task.status
    await patchTask({ status: next })
    if (next === 'done' && prev !== 'done') {
      showToast({ title: 'Marked as done', description: 'Watchers have been notified.', variant: 'success' })
    }
  }

  const handleAssigneeChange = async (nextUserId: string | null) => {
    if (!task || task.assigneeId === nextUserId) return
    await patchTask({ assigneeId: nextUserId })
    if (nextUserId) {
      const member = members.find((m) => m.userId === nextUserId)
      showToast({
        title: 'Assignee updated',
        description: `${member?.fullName ?? 'New assignee'} has been notified.`,
        variant: 'success',
      })
    }
  }

  const handlePriorityChange = async (next: TaskPriority) => {
    if (!task || task.priority === next) return
    await patchTask({ priority: next })
  }

  const handleDueDateChange = async (value: string) => {
    if (!task) return
    // value is yyyy-MM-dd or empty
    const iso = value ? new Date(`${value}T12:00:00Z`).toISOString() : null
    if ((task.dueDate ?? null) === iso) return
    await patchTask({ dueDate: iso })
  }

  const handleStartDateChange = async (value: string) => {
    if (!task) return
    const iso = value ? new Date(`${value}T08:00:00Z`).toISOString() : null
    if ((task.startDate ?? null) === iso) return
    await patchTask({ startDate: iso })
  }

  const handleTitleCommit = async (title: string) => {
    if (!task || title === task.title) return
    await patchTask({ title })
  }

  const handleDescriptionBlur = async () => {
    if (!task) return
    const next = descriptionDraft.trim()
    setDescriptionDirty(false)
    if (next === (task.description ?? '')) return
    await patchTask({ description: next })
  }

  const handleMetadataCommit = async (field: keyof TaskFE, value: string | number | null) => {
    if (!task) return
    if ((task[field] as unknown) === value) return
    await patchTask({ [field]: value } as Partial<TaskFE>)
  }

  const addTag = async () => {
    if (!task) return
    const t = tagInput.trim()
    if (!t || task.tags.includes(t)) {
      setTagInput('')
      return
    }
    const next = [...task.tags, t]
    setTagInput('')
    await patchTask({ tags: next })
  }

  const removeTag = async (t: string) => {
    if (!task) return
    const next = task.tags.filter((x) => x !== t)
    await patchTask({ tags: next })
  }

  const handleDelete = async () => {
    if (!task) return
    setDeleting(true)
    try {
      await apiDelete(`/tasks/${task.id}`)
      showToast({ title: 'Task deleted', variant: 'success' })
      // Navigate back to the project (or dashboard if no history).
      if (projectId) navigate('project', { projectId })
      else navigate('dashboard')
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', description: 'Deletion will sync when you reconnect.', variant: 'warning' })
        // Still navigate away since the optimistic UI should hide it.
        if (projectId) navigate('project', { projectId })
        else navigate('dashboard')
      } else {
        const msg = e instanceof ApiError ? e.message : 'Delete failed'
        showToast({ title: 'Delete failed', description: msg, variant: 'error' })
      }
    } finally {
      setDeleting(false)
    }
  }

  if (!taskId) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <div className="text-center py-12 text-zinc-500">No task selected.</div>
      </div>
    )
  }

  if (loading && !task) {
    return <TaskDetailSkeleton />
  }

  if (!task) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <Button variant="ghost" size="sm" onClick={() => back()} className="mb-4 -ml-2">
          <ArrowLeft className="h-4 w-4" />Back
        </Button>
        <div className="text-center py-12 text-zinc-500">Task not found or you don&apos;t have access.</div>
      </div>
    )
  }

  const assignee = members.find((m) => m.userId === task.assigneeId)
  const assigneeName = assignee?.fullName ?? task.assigneeName ?? 'Unassigned'

  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start gap-3 mb-4">
        <Button variant="ghost" size="icon" onClick={() => back()} className="mt-0.5 -ml-2" aria-label="Back to project">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {task.dueDate && (
              <Badge variant="outline" className="font-medium border-zinc-200 text-zinc-700 bg-zinc-50">
                Due {formatDate(task.dueDate)}
              </Badge>
            )}
          </div>
          <EditableText
            value={task.title}
            onCommit={handleTitleCommit}
            disabled={!canWrite}
            placeholder="Untitled task"
            className="text-xl sm:text-2xl font-semibold text-zinc-900"
            inputClassName="text-xl sm:text-2xl font-semibold"
            ariaLabel="Edit task title"
          />
          <div className="flex items-center gap-2 mt-1 text-xs text-zinc-500">
            <UserAvatar name={assigneeName} className="h-5 w-5" />
            <span>{assigneeName}</span>
            <span>·</span>
            <span>Created {formatRelative(task.createdAt)} by {task.createdByName ?? 'Someone'}</span>
          </div>
        </div>
        <div className="shrink-0">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Task actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTab('details')}>
                <Pencil className="h-3.5 w-3.5" />Edit details
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <DropdownMenuItem
                    className="text-red-600 focus:text-red-700 focus:bg-red-50"
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Trash2 className="h-3.5 w-3.5" />Delete task
                  </DropdownMenuItem>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete this task?</AlertDialogTitle>
                    <AlertDialogDescription>
                      &ldquo;{task.title}&rdquo; will be soft-deleted. Comments, attachments, checklists, and relations will be preserved for audit history.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-red-600 hover:bg-red-700 text-white"
                      disabled={deleting}
                      onClick={(e) => { e.preventDefault(); void handleDelete() }}
                    >
                      {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      Delete
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Quick row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
        <QuickField label="Status">
          <Select
            value={task.status}
            onValueChange={(v) => void handleStatusChange(v as TaskStatus)}
            disabled={!canWrite}
          >
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}
            </SelectContent>
          </Select>
        </QuickField>
        <QuickField label="Priority">
          <Select
            value={task.priority}
            onValueChange={(v) => void handlePriorityChange(v as TaskPriority)}
            disabled={!canWrite}
          >
            <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </QuickField>
        <QuickField label="Assignee">
          <Select
            value={task.assigneeId ?? '__none__'}
            onValueChange={(v) => void handleAssigneeChange(v === '__none__' ? null : v)}
            disabled={!canWrite || members.length === 0}
          >
            <SelectTrigger className="h-8 w-full text-xs">
              <SelectValue placeholder={members.length === 0 ? 'No members' : 'Unassigned'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {members.map((m) => (
                <SelectItem key={m.userId} value={m.userId}>{m.fullName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </QuickField>
        <QuickField label="Due date">
          <Input
            type="date"
            value={toDateInputValue(task.dueDate)}
            onChange={(e) => void handleDueDateChange(e.target.value)}
            disabled={!canWrite}
            className="h-8 text-xs"
          />
        </QuickField>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <TabsList className="w-full sm:w-auto grid grid-cols-5 sm:flex sm:w-auto">
            <TabsTrigger value="details" className="text-xs sm:text-sm">Details</TabsTrigger>
            <TabsTrigger value="comments" className="text-xs sm:text-sm">
              Comments{task.commentCount ? <span className="ml-1 text-zinc-400">·{task.commentCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="attachments" className="text-xs sm:text-sm">
              Files{task.attachmentCount ? <span className="ml-1 text-zinc-400">·{task.attachmentCount}</span> : null}
            </TabsTrigger>
            <TabsTrigger value="checklists" className="text-xs sm:text-sm">Checklists</TabsTrigger>
            <TabsTrigger value="relations" className="text-xs sm:text-sm">Relations</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="details">
          <DetailsTabContent
            task={task}
            canWrite={canWrite}
            projectId={projectId}
            descriptionDraft={descriptionDraft}
            descriptionDirty={descriptionDirty}
            onDescriptionChange={(v) => { setDescriptionDraft(v); setDescriptionDirty(true) }}
            onDescriptionBlur={handleDescriptionBlur}
            onMetadataCommit={handleMetadataCommit}
            onStartDateChange={handleStartDateChange}
            onOpenPlan={() => {
              if (task.planId && projectId) navigate('plan-viewer', { projectId, planId: task.planId })
            }}
            tagInput={tagInput}
            onTagInputChange={setTagInput}
            onAddTag={addTag}
            onRemoveTag={removeTag}
          />
        </TabsContent>

        <TabsContent value="comments">
          <CommentsTab taskId={task.id} canWrite={canWrite} role={role ?? 'viewer'} />
        </TabsContent>

        <TabsContent value="attachments">
          <AttachmentsTab taskId={task.id} canWrite={canWrite} />
        </TabsContent>

        <TabsContent value="checklists">
          <ChecklistsTab taskId={task.id} canWrite={canWrite} />
        </TabsContent>

        <TabsContent value="relations">
          {projectId ? (
            <RelationsTab taskId={task.id} projectId={projectId} canWrite={canWrite} />
          ) : (
            <div className="text-center py-10 text-sm text-zinc-500">Project context unavailable.</div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function QuickField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">{label}</label>
      {children}
    </div>
  )
}

interface DetailsTabContentProps {
  task: TaskFE
  canWrite: boolean
  projectId?: string
  descriptionDraft: string
  descriptionDirty: boolean
  onDescriptionChange: (v: string) => void
  onDescriptionBlur: () => void
  onMetadataCommit: (field: keyof TaskFE, value: string | number | null) => void | Promise<void>
  onStartDateChange: (value: string) => void
  onOpenPlan: () => void
  tagInput: string
  onTagInputChange: (v: string) => void
  onAddTag: () => void
  onRemoveTag: (t: string) => void
}

function DetailsTabContent({
  task,
  canWrite,
  projectId,
  descriptionDraft,
  descriptionDirty,
  onDescriptionChange,
  onDescriptionBlur,
  onMetadataCommit,
  onStartDateChange,
  onOpenPlan,
  tagInput,
  onTagInputChange,
  onAddTag,
  onRemoveTag,
}: DetailsTabContentProps) {
  const navigate = useRouterStore((s) => s.navigate)
  return (
    <div className="py-4 space-y-6">
      {/* Description */}
      <section>
        <SectionTitle>Description</SectionTitle>
        <Textarea
          value={descriptionDraft}
          onChange={(e) => onDescriptionChange(e.target.value)}
          onBlur={onDescriptionBlur}
          disabled={!canWrite}
          placeholder="Add a description…"
          className="min-h-24"
        />
        {descriptionDirty && (
          <p className="text-xs text-zinc-400 mt-1">Unsaved — blur to save (Cmd/Ctrl+Enter).</p>
        )}
      </section>

      {/* Metadata grid */}
      <section>
        <SectionTitle>Details</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <MetadataField label="Trade">
            <EditableText
              value={task.trade ?? ''}
              onCommit={(v) => onMetadataCommit('trade', v || null)}
              disabled={!canWrite}
              placeholder="e.g. Electrical"
              inputClassName="h-8"
            />
          </MetadataField>
          <MetadataField label="Category">
            <EditableText
              value={task.category ?? ''}
              onCommit={(v) => onMetadataCommit('category', v || null)}
              disabled={!canWrite}
              placeholder="e.g. Inspection"
              inputClassName="h-8"
            />
          </MetadataField>
          <MetadataField label="Location">
            <EditableText
              value={task.locationName ?? ''}
              onCommit={(v) => onMetadataCommit('locationName', v || null)}
              disabled={!canWrite}
              placeholder="e.g. Level 3, North"
              inputClassName="h-8"
            />
          </MetadataField>
          <MetadataField label="Start date">
            <Input
              type="date"
              value={toDateInputValue(task.startDate)}
              onChange={(e) => void onStartDateChange(e.target.value)}
              disabled={!canWrite}
              className="h-8"
            />
          </MetadataField>
          <MetadataField label="Due date">
            <Input
              type="date"
              value={toDateInputValue(task.dueDate)}
              onChange={(e) => void onMetadataCommit('dueDate', e.target.value ? new Date(`${e.target.value}T12:00:00Z`).toISOString() : null)}
              disabled={!canWrite}
              className="h-8"
            />
          </MetadataField>
          <MetadataField label="Est. hours">
            <NumberInputCell
              value={task.estimatedHours}
              onCommit={(v) => onMetadataCommit('estimatedHours', v)}
              disabled={!canWrite}
              placeholder="0"
            />
          </MetadataField>
          <MetadataField label="Actual hours">
            <NumberInputCell
              value={task.actualHours}
              onCommit={(v) => onMetadataCommit('actualHours', v)}
              disabled={!canWrite}
              placeholder="0"
            />
          </MetadataField>
          <MetadataField label="Est. cost ($)">
            <NumberInputCell
              value={task.estimatedCost}
              onCommit={(v) => onMetadataCommit('estimatedCost', v)}
              disabled={!canWrite}
              placeholder="0"
              step="0.01"
            />
          </MetadataField>
          <MetadataField label="Actual cost ($)">
            <NumberInputCell
              value={task.actualCost}
              onCommit={(v) => onMetadataCommit('actualCost', v)}
              disabled={!canWrite}
              placeholder="0"
              step="0.01"
            />
          </MetadataField>
        </div>
      </section>

      {/* Tags */}
      <section>
        <SectionTitle>Tags</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          {task.tags.length === 0 && <span className="text-sm text-zinc-400">No tags yet.</span>}
          {task.tags.map((t) => (
            <Badge key={t} variant="outline" className="bg-zinc-50 border-zinc-200 text-zinc-700">
              {t}
              {canWrite && (
                <button
                  type="button"
                  onClick={() => onRemoveTag(t)}
                  className="ml-1 text-zinc-400 hover:text-red-600"
                  aria-label={`Remove tag ${t}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}
          {canWrite && (
            <div className="flex items-center gap-1">
              <Input
                value={tagInput}
                onChange={(e) => onTagInputChange(e.target.value)}
                placeholder="Add tag…"
                className="h-7 w-32 text-xs"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); onAddTag() }
                }}
              />
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onAddTag} aria-label="Add tag">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Plan location */}
      {task.planId && (
        <section>
          <SectionTitle>Plan location</SectionTitle>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onOpenPlan}>
              <MapPin className="h-3.5 w-3.5" />
              Open on plan
            </Button>
            {task.pageNumber && (
              <span className="text-xs text-zinc-500">Page {task.pageNumber}</span>
            )}
          </div>
        </section>
      )}

      {/* Created / updated footer */}
      <section className="border-t border-zinc-200 pt-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-zinc-500">
          <div>
            <div className="font-medium text-zinc-700 mb-0.5 flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3" />Created by
            </div>
            <div className="flex items-center gap-1.5">
              <UserAvatar name={task.createdByName} className="h-5 w-5" />
              <span>{task.createdByName ?? 'Someone'}</span>
            </div>
            <div className="mt-0.5" title={formatDateTime(task.createdAt)}>{formatDateTime(task.createdAt)}</div>
          </div>
          <div>
            <div className="font-medium text-zinc-700 mb-0.5 flex items-center gap-1">
              <Bell className="h-3 w-3" />Last updated
            </div>
            <div title={formatDateTime(task.updatedAt)}>{formatDateTime(task.updatedAt)}</div>
          </div>
          <div>
            <div className="font-medium text-zinc-700 mb-0.5">Project</div>
            <button
              type="button"
              onClick={() => projectId && navigate('project', { projectId })}
              className="text-zinc-600 hover:underline truncate"
              title="Open project"
            >
              {projectId ?? '—'}
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 mb-2">{children}</h3>
}

function MetadataField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border border-zinc-200 rounded-md p-2 bg-white">
      <label className="text-[10px] uppercase tracking-wide text-zinc-500 font-medium">{label}</label>
      {children}
    </div>
  )
}

function NumberInputCell({
  value,
  onCommit,
  disabled,
  placeholder,
  step = '0.01',
}: {
  value: number | null
  onCommit: (next: number | null) => void | Promise<void>
  disabled?: boolean
  placeholder?: string
  step?: string
}) {
  const [draft, setDraft] = React.useState(value != null ? String(value) : '')
  React.useEffect(() => { setDraft(value != null ? String(value) : '') }, [value])
  const commit = () => {
    if (!draft.trim()) {
      if (value != null) void onCommit(null)
      return
    }
    const n = Number(draft)
    if (Number.isNaN(n) || n === value) return
    void onCommit(n)
  }
  if (disabled) {
    return <span className="text-sm text-zinc-700">{value != null ? value : '—'}</span>
  }
  return (
    <Input
      type="number"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur() }
        if (e.key === 'Escape') { e.preventDefault(); setDraft(value != null ? String(value) : '') }
      }}
      placeholder={placeholder}
      step={step}
      className="h-8 text-sm"
    />
  )
}

function TaskDetailSkeleton() {
  return (
    <div className="max-w-5xl mx-auto p-4 sm:p-6">
      <div className="flex items-start gap-3 mb-4">
        <Skeleton className="h-8 w-8 rounded-md" />
        <div className="flex-1 space-y-2">
          <div className="flex gap-2"><Skeleton className="h-5 w-10" /><Skeleton className="h-5 w-16" /></div>
          <Skeleton className="h-7 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 p-3 bg-zinc-50 border border-zinc-200 rounded-lg">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="space-y-1">
            <FieldSkeleton className="h-3 w-10" />
            <FieldSkeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-9 w-full sm:w-80" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  )
}
