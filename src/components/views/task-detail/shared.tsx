'use client'

import * as React from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import type { TaskPriority, TaskStatus } from '@/types'

/** Initials from a full name, e.g. "Ada Lovelace" -> "AL". */
export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** A user avatar with initials fallback. */
export function UserAvatar({ name, className }: { name?: string | null; className?: string }) {
  return (
    <Avatar className={cn('h-7 w-7 text-[10px]', className)}>
      <AvatarFallback className="bg-zinc-200 text-zinc-700 font-semibold">{initials(name)}</AvatarFallback>
    </Avatar>
  )
}

const PRIORITY_STYLE: Record<TaskPriority, string> = {
  P1: 'bg-red-100 text-red-700 border-red-200',
  P2: 'bg-amber-100 text-amber-800 border-amber-200',
  P3: 'bg-emerald-100 text-emerald-700 border-emerald-200',
}

const STATUS_STYLE: Record<TaskStatus, string> = {
  open: 'bg-zinc-100 text-zinc-700 border-zinc-200',
  in_progress: 'bg-amber-100 text-amber-800 border-amber-200',
  blocked: 'bg-red-100 text-red-700 border-red-200',
  done: 'bg-emerald-100 text-emerald-700 border-emerald-200',
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  blocked: 'Blocked',
  done: 'Done',
}

export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return <Badge variant="outline" className={cn('font-medium', PRIORITY_STYLE[priority])}>{priority}</Badge>
}

export function StatusBadge({ status }: { status: TaskStatus | string }) {
  const s = (status as TaskStatus) ?? 'open'
  return <Badge variant="outline" className={cn('font-medium', STATUS_STYLE[s] ?? STATUS_STYLE.open)}>{STATUS_LABEL[s] ?? s}</Badge>
}

export function formatDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), "MMM d, yyyy 'at' h:mm a")
  } catch {
    return iso
  }
}

export function formatRelative(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNow(parseISO(iso), { addSuffix: true })
  } catch {
    return iso
  }
}

export function formatFileSize(bytes: number | undefined | null): string {
  if (!bytes && bytes !== 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = bytes
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`
}

/** Convert an ISO date string to the `yyyy-MM-dd` value used by <input type=date>. */
export function toDateInputValue(iso?: string | null): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), 'yyyy-MM-dd')
  } catch {
    return ''
  }
}

/** Convert an ISO date string to the `yyyy-MM-ddTHH:mm` value used by <input type=datetime-local>. */
export function toDateTimeInputValue(iso?: string | null): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), "yyyy-MM-dd'T'HH:mm")
  } catch {
    return ''
  }
}

/**
 * Inline-editable text. Renders as a span/button; click toggles into an Input.
 * Commits on blur or Enter, cancels on Escape. Does not save if unchanged.
 */
export function EditableText({
  value,
  onCommit,
  placeholder = 'Add…',
  disabled = false,
  className,
  inputClassName,
  multiline = false,
  ariaLabel,
}: {
  value: string
  onCommit: (next: string) => void | Promise<void>
  placeholder?: string
  disabled?: boolean
  className?: string
  inputClassName?: string
  multiline?: boolean
  ariaLabel?: string
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(value)
  const inputRef = React.useRef<HTMLTextAreaElement | HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      if (inputRef.current instanceof HTMLInputElement || inputRef.current instanceof HTMLTextAreaElement) {
        const len = inputRef.current.value.length
        inputRef.current.setSelectionRange(len, len)
      }
    }
  }, [editing])

  // Keep draft in sync when value changes externally while not editing.
  React.useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const commit = React.useCallback(() => {
    setEditing(false)
    const next = draft.trim()
    if (next === value) return
    void onCommit(next)
  }, [draft, value, onCommit])

  const cancel = React.useCallback(() => {
    setDraft(value)
    setEditing(false)
  }, [value])

  if (disabled) {
    return (
      <span className={cn('text-sm text-zinc-700', className)}>{value || placeholder}</span>
    )
  }

  if (editing) {
    if (multiline) {
      return (
        <Textarea
          ref={(el) => { inputRef.current = el }}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commit() }
            if (e.key === 'Escape') { e.preventDefault(); cancel() }
          }}
          className={cn('min-h-20', inputClassName)}
          aria-label={ariaLabel}
        />
      )
    }
    return (
      <Input
        ref={(el) => { inputRef.current = el }}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit() }
          if (e.key === 'Escape') { e.preventDefault(); cancel() }
        }}
        className={cn('h-8', inputClassName)}
        aria-label={ariaLabel}
      />
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={cn(
        'text-left rounded px-1 -mx-1 hover:bg-zinc-100 transition-colors min-w-0 truncate',
        !value && 'text-zinc-400 italic',
        className,
      )}
      title={value || placeholder}
      aria-label={ariaLabel ?? `Edit: ${value || placeholder}`}
    >
      {value || placeholder}
    </button>
  )
}

/** Skeleton placeholder for a card/section. */
export function FieldSkeleton({ className }: { className?: string }) {
  return <div className={cn('h-4 w-full bg-zinc-200 animate-pulse rounded', className)} />
}
