'use client'

import * as React from 'react'
import { Plus, Trash2, Pencil, ChevronUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog'
import { apiPost, apiPatch, apiDelete, apiGet, isQueuedError, ApiError } from '@/lib/client/api'
import { useUiStore } from '@/stores/ui'
import { genLocalId } from '@/lib/client/idb-offline'
import type { TaskChecklistFE, TaskChecklistItemFE } from '@/lib/client/types'

interface Props {
  taskId: string
  canWrite: boolean
}

export function ChecklistsTab({ taskId, canWrite }: Props) {
  const showToast = useUiStore((s) => s.showToast)
  const [checklists, setChecklists] = React.useState<TaskChecklistFE[]>([])
  const [loading, setLoading] = React.useState(true)
  const [addingTitle, setAddingTitle] = React.useState('')

  const load = React.useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiGet<{ checklists: TaskChecklistFE[] }>(`/tasks/${taskId}/checklists`)
      setChecklists(data?.checklists ?? [])
    } catch (e) {
      if (!isQueuedError(e)) showToast({ title: 'Failed to load checklists', variant: 'error' })
    } finally {
      setLoading(false)
    }
  }, [showToast, taskId])

  React.useEffect(() => { void load() }, [load])

  const addChecklist = async () => {
    const title = addingTitle.trim()
    if (!title || !canWrite) return
    const localId = genLocalId()
    const order = checklists.length
    const optimistic: TaskChecklistFE = { id: localId, taskId, title, order, items: [] }
    setChecklists((cur) => [...cur, optimistic])
    setAddingTitle('')
    try {
      const created = await apiPost<TaskChecklistFE>(`/tasks/${taskId}/checklists`, { title, order })
      setChecklists((cur) => cur.map((c) => (c.id === localId ? created : c)))
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setChecklists((cur) => cur.filter((c) => c.id !== localId))
        setAddingTitle(title)
        showToast({ title: 'Failed to add checklist', variant: 'error' })
      }
    }
  }

  const updateChecklist = async (id: string, patch: Partial<TaskChecklistFE>) => {
    setChecklists((cur) => cur.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    try {
      await apiPatch(`/checklists/${id}`, patch)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        showToast({ title: 'Update failed', variant: 'error' })
        void load()
      }
    }
  }

  const deleteChecklist = async (id: string) => {
    const prev = checklists
    setChecklists((cur) => cur.filter((c) => c.id !== id))
    try {
      await apiDelete(`/checklists/${id}`)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setChecklists(prev)
        showToast({ title: 'Delete failed', variant: 'error' })
      }
    }
  }

  const moveChecklist = async (id: string, dir: -1 | 1) => {
    const idx = checklists.findIndex((c) => c.id === id)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= checklists.length) return
    const reordered = [...checklists]
    const [moved] = reordered.splice(idx, 1)
    reordered.splice(swapWith, 0, moved)
    const withOrders = reordered.map((c, i) => ({ ...c, order: i }))
    setChecklists(withOrders)
    try {
      await Promise.all(
        withOrders.map((c) => apiPatch(`/checklists/${c.id}`, { order: c.order })),
      )
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        showToast({ title: 'Reorder failed', variant: 'error' })
        void load()
      }
    }
  }

  const addItem = async (checklistId: string, text: string) => {
    if (!canWrite || !text.trim()) return
    const localId = genLocalId()
    const order = checklists.find((c) => c.id === checklistId)?.items.length ?? 0
    const newItem: TaskChecklistItemFE = {
      id: localId,
      checklistId,
      text: text.trim(),
      isChecked: false,
      order,
    }
    setChecklists((cur) => cur.map((c) => (c.id === checklistId ? { ...c, items: [...c.items, newItem] } : c)))
    try {
      const created = await apiPost<TaskChecklistItemFE>(`/checklists/${checklistId}/items`, { text: text.trim(), order })
      setChecklists((cur) => cur.map((c) => (c.id === checklistId ? { ...c, items: c.items.map((it) => (it.id === localId ? created : it)) } : c)))
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setChecklists((cur) => cur.map((c) => (c.id === checklistId ? { ...c, items: c.items.filter((it) => it.id !== localId) } : c)))
        const msg = e instanceof ApiError ? e.message : 'Failed to add item'
        showToast({ title: 'Add failed', description: msg, variant: 'error' })
      }
    }
  }

  const updateItem = async (itemId: string, patch: Partial<TaskChecklistItemFE>) => {
    setChecklists((cur) => cur.map((c) => ({
      ...c,
      items: c.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)),
    })))
    try {
      await apiPatch(`/checklist_items/${itemId}`, patch)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        showToast({ title: 'Update failed', variant: 'error' })
        void load()
      }
    }
  }

  const deleteItem = async (itemId: string) => {
    const prev = checklists
    setChecklists((cur) => cur.map((c) => ({
      ...c,
      items: c.items.filter((it) => it.id !== itemId),
    })))
    try {
      await apiDelete(`/checklist_items/${itemId}`)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        setChecklists(prev)
        showToast({ title: 'Delete failed', variant: 'error' })
      }
    }
  }

  const moveItem = async (checklistId: string, itemId: string, dir: -1 | 1) => {
    const cl = checklists.find((c) => c.id === checklistId)
    if (!cl) return
    const idx = cl.items.findIndex((it) => it.id === itemId)
    const swapWith = idx + dir
    if (idx < 0 || swapWith < 0 || swapWith >= cl.items.length) return
    const reordered = [...cl.items]
    const [moved] = reordered.splice(idx, 1)
    reordered.splice(swapWith, 0, moved)
    const withOrders = reordered.map((it, i) => ({ ...it, order: i }))
    setChecklists((cur) => cur.map((c) => (c.id === checklistId ? { ...c, items: withOrders } : c)))
    try {
      await Promise.all(
        withOrders.map((it) => apiPatch(`/checklist_items/${it.id}`, { order: it.order })),
      )
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
      } else {
        showToast({ title: 'Reorder failed', variant: 'error' })
        void load()
      }
    }
  }

  if (loading && checklists.length === 0) {
    return (
      <div className="space-y-4 py-4">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="py-2 space-y-4">
      {checklists.length === 0 ? (
        <div className="text-center py-10 text-sm text-zinc-500">
          No checklists yet. {canWrite && 'Add one below to track sub-tasks.'}
        </div>
      ) : (
        checklists.map((c, idx) => (
          <ChecklistCard
            key={c.id}
            checklist={c}
            canWrite={canWrite}
            isFirst={idx === 0}
            isLast={idx === checklists.length - 1}
            onRename={(title) => void updateChecklist(c.id, { title })}
            onDelete={() => void deleteChecklist(c.id)}
            onMove={(dir) => void moveChecklist(c.id, dir)}
            onAddItem={(text) => addItem(c.id, text)}
            onUpdateItem={(itemId, patch) => updateItem(itemId, patch)}
            onDeleteItem={(itemId) => deleteItem(itemId)}
            onMoveItem={(itemId, dir) => moveItem(c.id, itemId, dir)}
          />
        ))
      )}

      {canWrite && (
        <div className="flex items-center gap-2 pt-2 border-t border-zinc-200">
          <Input
            value={addingTitle}
            onChange={(e) => setAddingTitle(e.target.value)}
            placeholder="New checklist title…"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); void addChecklist() }
            }}
          />
          <Button onClick={() => void addChecklist()} disabled={!addingTitle.trim()}>
            <Plus className="h-4 w-4" />Add checklist
          </Button>
        </div>
      )}
    </div>
  )
}

function ChecklistCard({
  checklist,
  canWrite,
  isFirst,
  isLast,
  onRename,
  onDelete,
  onMove,
  onAddItem,
  onUpdateItem,
  onDeleteItem,
  onMoveItem,
}: {
  checklist: TaskChecklistFE
  canWrite: boolean
  isFirst: boolean
  isLast: boolean
  onRename: (title: string) => void
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
  onAddItem: (text: string) => void | Promise<void>
  onUpdateItem: (itemId: string, patch: Partial<TaskChecklistItemFE>) => void | Promise<void>
  onDeleteItem: (itemId: string) => void | Promise<void>
  onMoveItem: (itemId: string, dir: -1 | 1) => void | Promise<void>
}) {
  const [newItemText, setNewItemText] = React.useState('')
  const [renaming, setRenaming] = React.useState(false)
  const [renameDraft, setRenameDraft] = React.useState(checklist.title)

  React.useEffect(() => setRenameDraft(checklist.title), [checklist.title])

  const total = checklist.items.length
  const done = checklist.items.filter((it) => it.isChecked).length
  const pct = total === 0 ? 0 : Math.round((done / total) * 100)

  const commitRename = () => {
    setRenaming(false)
    const t = renameDraft.trim()
    if (t && t !== checklist.title) onRename(t)
    else setRenameDraft(checklist.title)
  }

  const submitItem = () => {
    if (!newItemText.trim()) return
    void onAddItem(newItemText.trim())
    setNewItemText('')
  }

  return (
    <div className="border border-zinc-200 rounded-lg bg-white">
      <div className="flex items-center gap-2 p-3 border-b border-zinc-100">
        {canWrite && (
          <div className="flex flex-col">
            <Button size="icon" variant="ghost" className="h-5 w-5" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Move up">
              <ChevronUp className="h-3 w-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-5 w-5" disabled={isLast} onClick={() => onMove(1)} aria-label="Move down">
              <ChevronDown className="h-3 w-3" />
            </Button>
          </div>
        )}
        <div className="flex-1 min-w-0">
          {renaming ? (
            <Input
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                if (e.key === 'Escape') { setRenaming(false); setRenameDraft(checklist.title) }
              }}
              autoFocus
              className="h-7 text-sm font-medium"
            />
          ) : (
            <button
              type="button"
              onClick={() => canWrite && setRenaming(true)}
              className="text-sm font-semibold text-zinc-900 text-left hover:bg-zinc-100 rounded px-1 -mx-1 truncate"
              title={checklist.title}
            >
              {checklist.title}
            </button>
          )}
        </div>
        <span className="text-xs text-zinc-500 tabular-nums">{done}/{total}</span>
        {canWrite && (
          <>
            <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setRenaming(true)} aria-label="Rename checklist">
              <Pencil className="h-3 w-3" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon" variant="ghost" className="h-6 w-6 text-red-600 hover:text-red-700" aria-label="Delete checklist">
                  <Trash2 className="h-3 w-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete checklist?</AlertDialogTitle>
                  <AlertDialogDescription>
                    &ldquo;{checklist.title}&rdquo; and all its items will be removed.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction className="bg-red-600 hover:bg-red-700 text-white" onClick={onDelete}>
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      {total > 0 && (
        <div className="px-3 pt-2">
          <Progress value={pct} className="h-1.5" />
        </div>
      )}

      <ul className="divide-y divide-zinc-100">
        {checklist.items.map((it, idx) => (
          <ChecklistItemRow
            key={it.id}
            item={it}
            canWrite={canWrite}
            isFirst={idx === 0}
            isLast={idx === checklist.items.length - 1}
            onToggle={(checked) => onUpdateItem(it.id, { isChecked: checked })}
            onEdit={(text) => onUpdateItem(it.id, { text })}
            onDelete={() => onDeleteItem(it.id)}
            onMove={(dir) => onMoveItem(it.id, dir)}
          />
        ))}
        {checklist.items.length === 0 && (
          <li className="px-3 py-3 text-xs text-zinc-400">No items yet — add one below.</li>
        )}
      </ul>

      {canWrite && (
        <div className="flex items-center gap-2 p-2 border-t border-zinc-100">
          <Input
            value={newItemText}
            onChange={(e) => setNewItemText(e.target.value)}
            placeholder="Add an item…"
            className="h-8"
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); submitItem() }
            }}
          />
          <Button size="sm" variant="outline" onClick={submitItem} disabled={!newItemText.trim()}>
            <Plus className="h-3.5 w-3.5" />Add
          </Button>
        </div>
      )}
    </div>
  )
}

function ChecklistItemRow({
  item,
  canWrite,
  isFirst,
  isLast,
  onToggle,
  onEdit,
  onDelete,
  onMove,
}: {
  item: TaskChecklistItemFE
  canWrite: boolean
  isFirst: boolean
  isLast: boolean
  onToggle: (checked: boolean) => void
  onEdit: (text: string) => void | Promise<void>
  onDelete: () => void
  onMove: (dir: -1 | 1) => void
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(item.text)
  React.useEffect(() => setDraft(item.text), [item.text])

  const commit = () => {
    setEditing(false)
    const t = draft.trim()
    if (t && t !== item.text) void onEdit(t)
    else setDraft(item.text)
  }

  return (
    <li className="flex items-center gap-2 px-3 py-2 group">
      <Checkbox
        checked={item.isChecked}
        disabled={!canWrite}
        onCheckedChange={(v) => onToggle(!!v)}
        aria-label="Toggle item"
      />
      {editing ? (
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setEditing(false); setDraft(item.text) }
          }}
          autoFocus
          className="h-7 flex-1"
        />
      ) : (
        <span
          onDoubleClick={() => canWrite && setEditing(true)}
          className={`flex-1 text-sm cursor-text ${item.isChecked ? 'line-through text-zinc-400' : 'text-zinc-800'}`}
        >
          {item.text}
        </span>
      )}
      {canWrite && !editing && (
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={isFirst} onClick={() => onMove(-1)} aria-label="Move item up">
            <ChevronUp className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={isLast} onClick={() => onMove(1)} aria-label="Move item down">
            <ChevronDown className="h-3 w-3" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-600 hover:text-red-700" onClick={onDelete} aria-label="Delete item">
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      )}
    </li>
  )
}
