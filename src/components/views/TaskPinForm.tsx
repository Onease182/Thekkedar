'use client'

// Side-panel form for creating a task anchored to a pin on the plan.
// Pre-fills planId / pageNumber / pinCoordinates from the click that opened it.

import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { Loader2, MapPin, X } from 'lucide-react'
import type { TaskPriority, TaskStatus } from '@/types'
import type { ProjectMemberFE, TaskFE } from '@/lib/client/types'
import { apiPost, isQueuedError, ApiError } from '@/lib/client/api'
import { useUiStore } from '@/stores/ui'

export interface TaskPinFormProps {
  projectId: string
  planId: string
  pageNumber: number
  pinCoordinates: { x: number; y: number }
  members: ProjectMemberFE[]
  onCancel: () => void
  onCreated: (task: TaskFE) => void
}

export function TaskPinForm({
  projectId, planId, pageNumber, pinCoordinates, members, onCancel, onCreated,
}: TaskPinFormProps) {
  const showToast = useUiStore((s) => s.showToast)
  const refreshPending = useUiStore((s) => s.refreshPending)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [assigneeId, setAssigneeId] = useState<string>('__none__')
  const [priority, setPriority] = useState<TaskPriority>('P2')
  const [status, setStatus] = useState<TaskStatus>('open')
  const [dueDate, setDueDate] = useState('')
  const [trade, setTrade] = useState('')
  const [category, setCategory] = useState('')
  const [locationName, setLocationName] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!title.trim()) {
      showToast({ title: 'Title required', variant: 'error' })
      return
    }
    setSaving(true)
    const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean)
    const body = {
      title: title.trim(),
      description: description.trim() || undefined,
      assigneeId: assigneeId === '__none__' ? undefined : assigneeId,
      priority,
      status,
      dueDate: dueDate || undefined,
      trade: trade.trim() || undefined,
      category: category.trim() || undefined,
      locationName: locationName.trim() || undefined,
      tags: tagArr,
      planId,
      pageNumber,
      pinCoordinates: JSON.stringify(pinCoordinates),
    }
    try {
      const created = await apiPost<TaskFE>(`/projects/${projectId}/tasks`, body)
      showToast({ title: 'Task created', variant: 'success' })
      onCreated(created)
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', description: 'Task will sync when you reconnect.', variant: 'warning' })
        refreshPending()
        onCancel()
        return
      }
      const msg = e instanceof ApiError ? e.message : 'Failed to create task'
      showToast({ title: 'Error', description: msg, variant: 'error' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-red-500" />
          <h3 className="font-semibold text-sm">New task at pin</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label="Cancel">
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="t-title">Title <span className="text-red-500">*</span></Label>
          <Input
            id="t-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Fix HVAC rough-in on column 4"
            autoFocus
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-desc">Description</Label>
          <Textarea
            id="t-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Add details, scope, or references…"
            rows={3}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <Select value={priority} onValueChange={(v) => setPriority(v as TaskPriority)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="P1">P1 — Urgent</SelectItem>
                <SelectItem value="P2">P2 — Important</SelectItem>
                <SelectItem value="P3">P3 — Routine</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as TaskStatus)}>
              <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="blocked">Blocked</SelectItem>
                <SelectItem value="done">Done</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-assignee">Assignee</Label>
          <Select value={assigneeId} onValueChange={setAssigneeId}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Unassigned</SelectItem>
              {members.map(m => (
                <SelectItem key={m.userId} value={m.userId}>
                  {m.fullName} <span className="text-zinc-400">· {m.role}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-due">Due date</Label>
          <Input id="t-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </div>
        <Separator />
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="t-trade">Trade</Label>
            <Input id="t-trade" value={trade} onChange={(e) => setTrade(e.target.value)} placeholder="e.g. Electrical" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="t-cat">Category</Label>
            <Input id="t-cat" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="e.g. RFI" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-loc">Location</Label>
          <Input id="t-loc" value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="e.g. Level 3, Grid B-7" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="t-tags">Tags (comma-separated)</Label>
          <Input id="t-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. rough-in, inspection" />
        </div>
      </div>
      <div className="border-t p-3 flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>Cancel</Button>
        <Button size="sm" onClick={submit} disabled={saving || !title.trim()}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Create task
        </Button>
      </div>
    </div>
  )
}
