'use client'

// PlanViewerView — full-screen PDF plan viewer with markup overlay + task pins.
//
// Architecture (split into 4 files in this directory):
//   - markup-renderers.ts: pure SVG shape renderers + pin marker + helpers.
//   - MarkupOverlay.tsx:    interactive SVG overlay (draw/select/move/resize).
//   - TaskPinForm.tsx:      side-panel form for creating a task at a pin.
//   - PlanViewerView.tsx:   orchestrates PDF.js rendering + state + UI chrome.
//
// Task-pin convention: when the pin tool is active and the user clicks, we open
// the TaskPinForm with the click's normalized (x, y) as pinCoordinates. On
// submit, the task is created with `pinCoordinates` stored directly on the task
// (no separate Markup row needed — recommended by the spec). The pin is then
// rendered on the overlay from the task's pinCoordinates field. Standalone
// markup annotations (rectangle / cloud / etc.) ARE separate Markup rows.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouterStore, useAuthStore, useUiStore } from '@/stores'
import { apiGet, apiPost, apiPatch, apiDelete, apiFetchBlob, isQueuedError, ApiError } from '@/lib/client/api'
import { cacheMarkups, getCachedMarkupsByPlan } from '@/lib/client/idb-offline'
import type { PlanFE, MarkupFE, TaskFE, MarkupAttachmentFE, ProjectMemberFE } from '@/lib/client/types'
import type { MarkupType, TaskPriority } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import {
  Sheet, SheetContent, SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from '@/components/ui/tooltip'
import { useIsMobile } from '@/hooks/use-mobile'
import {
  ArrowLeft, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, Save,
  MousePointer2, MapPin, Square, Circle as CircleIcon, Cloud, Spline,
  ArrowUpRight, Type, ListTodo, Loader2, Trash2, Paperclip, X, ExternalLink, Wifi, WifiOff,
} from 'lucide-react'
import { MarkupOverlay, type ToolId } from './MarkupOverlay'
import { TaskPinForm } from './TaskPinForm'
import { PRESET_COLORS, PRIORITY_COLORS, priorityColor } from './markup-renderers'

// ───────────────────────── Helpers ─────────────────────────

// 24-char lowercase-alphanumeric id matching the markup route's cuid regex ^[a-z0-9]{20,}$.
function genMarkupId(): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  let s = ''
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * 36)]
  return s
}

const TOOL_LIST: Array<{ id: ToolId; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'select', label: 'Select', Icon: MousePointer2 },
  { id: 'pin', label: 'Pin + Task', Icon: MapPin },
  { id: 'rectangle', label: 'Rectangle', Icon: Square },
  { id: 'circle', label: 'Circle', Icon: CircleIcon },
  { id: 'cloud', label: 'Cloud', Icon: Cloud },
  { id: 'polyline', label: 'Polyline', Icon: Spline },
  { id: 'arrow', label: 'Arrow', Icon: ArrowUpRight },
  { id: 'text', label: 'Text', Icon: Type },
]

const STATUS_LABEL: Record<string, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  done: 'Done',
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  open: 'secondary',
  in_progress: 'default',
  blocked: 'destructive',
  done: 'outline',
}

type PanelMode = 'tasks' | 'markup' | 'add-task' | null

// ───────────────────────── Component ─────────────────────────

export function PlanViewerView() {
  const navigate = useRouterStore((s) => s.navigate)
  const back = useRouterStore((s) => s.back)
  const planId = useRouterStore((s) => s.planId)
  const projectId = useRouterStore((s) => s.projectId)
  const user = useAuthStore((s) => s.user)
  const showToast = useUiStore((s) => s.showToast)
  const refreshPending = useUiStore((s) => s.refreshPending)
  const online = useUiStore((s) => s.online)
  const isMobile = useIsMobile()

  // ── Plan + PDF state ──
  const [plan, setPlan] = useState<PlanFE | null>(null)
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [numPages, setNumPages] = useState(1)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.0)
  const [rendering, setRendering] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 })
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const initialFitDone = useRef(false)

  // ── Markups + Tasks state ──
  const [markups, setMarkups] = useState<MarkupFE[]>([])
  const [tasks, setTasks] = useState<TaskFE[]>([])
  const [members, setMembers] = useState<ProjectMemberFE[]>([])
  const [selectedMarkupId, setSelectedMarkupId] = useState<string | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [panelMode, setPanelMode] = useState<PanelMode>(null)
  const [pendingPin, setPendingPin] = useState<{ x: number; y: number } | null>(null)

  // ── Tool + color state ──
  const [tool, setTool] = useState<ToolId>('select')
  const [color, setColor] = useState<string>(PRESET_COLORS[0])

  // ── Attachments state (for selected markup) ──
  const [attachments, setAttachments] = useState<MarkupAttachmentFE[]>([])
  const [attachmentUrls, setAttachmentUrls] = useState<Map<string, string>>(new Map())
  const [uploadingAtt, setUploadingAtt] = useState(false)

  // ── Pending mutations (debounced) ──
  const pendingMutations = useRef<Map<string, { coordinates?: string; color?: string; metadata?: string }>>(new Map())
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedMarkup = useMemo(
    () => markups.find(m => m.id === selectedMarkupId) || null,
    [markups, selectedMarkupId],
  )
  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId) || null,
    [tasks, selectedTaskId],
  )

  // ───────────────────────── Load plan + PDF ─────────────────────────

  useEffect(() => {
    let cancelled = false
    let urlToRevoke: string | null = null
    ;(async () => {
      if (!planId) return
      // Plan metadata
      try {
        const data = await apiGet<{ plan: PlanFE }>(`/plans/${planId}`)
        if (cancelled) return
        setPlan(data.plan)
      } catch (e) {
        if (!cancelled) setLoadError((e as Error).message)
        return
      }
      // Plan file as Blob → object URL
      try {
        const blob = await apiFetchBlob(`/plans/${planId}/file`)
        if (cancelled) return
        const url = URL.createObjectURL(blob)
        urlToRevoke = url
        setPdfUrl(url)
      } catch (e) {
        if (!cancelled) setLoadError(`Failed to load PDF: ${(e as Error).message}`)
        return
      }
    })()
    return () => {
      cancelled = true
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke)
    }
  }, [planId])

  // Load PDF document via pdfjs
  useEffect(() => {
    if (!pdfUrl) return
    let cancelled = false
    let doc: any = null
    ;(async () => {
      try {
        const pdfjs = await import('pdfjs-dist')
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
        doc = await pdfjs.getDocument({ url: pdfUrl }).promise
        if (cancelled) { try { doc.destroy() } catch { /* noop */ } ; return }
        setPdfDoc(doc)
        setNumPages(doc.numPages)
        setCurrentPage(1)
      } catch (e) {
        if (!cancelled) {
          setLoadError(`PDF.js error: ${(e as Error).message}`)
          showToast({ title: 'PDF failed to load', description: (e as Error).message, variant: 'error' })
        }
      }
    })()
    return () => {
      cancelled = true
      if (doc) { try { doc.destroy() } catch { /* noop */ } }
    }
  }, [pdfUrl, showToast])

  // ───────────────────────── Render current page ─────────────────────────

  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return
    let cancelled = false
    ;(async () => {
      setRendering(true)
      try {
        // Cancel any in-flight render
        renderTaskRef.current?.cancel()
        renderTaskRef.current = null
        const page = await pdfDoc.getPage(currentPage)
        if (cancelled) return
        const viewport = page.getViewport({ scale })
        const canvas = canvasRef.current
        if (!canvas) return
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        setViewportSize({ w: canvas.width, h: canvas.height })
        const task = page.render({ canvasContext: ctx, viewport })
        renderTaskRef.current = task
        await task.promise
      } catch (e) {
        if (!cancelled && (e as any)?.name !== 'RenderingCancelledException') {
          showToast({ title: 'Render failed', description: (e as Error).message, variant: 'error' })
        }
      } finally {
        if (!cancelled) setRendering(false)
      }
    })()
    return () => {
      cancelled = true
      renderTaskRef.current?.cancel()
      renderTaskRef.current = null
    }
  }, [pdfDoc, currentPage, scale, showToast])

  // Fit-to-width on first render
  useEffect(() => {
    if (initialFitDone.current || !pdfDoc || !containerRef.current || viewportSize.w === 0) return
    const container = containerRef.current
    const containerWidth = container.clientWidth - 32 // padding
    const baseWidth = viewportSize.w / scale
    if (containerWidth > 0 && baseWidth > 0) {
      const fit = Math.max(0.25, Math.min(4, containerWidth / baseWidth))
      setScale(fit)
    }
    initialFitDone.current = true
  }, [pdfDoc, viewportSize, scale])

  // ───────────────────────── Load markups + tasks ─────────────────────────

  useEffect(() => {
    if (!planId) return
    let cancelled = false
    ;(async () => {
      // 1) Render from IndexedDB cache first (instant)
      try {
        const cached = await getCachedMarkupsByPlan(planId)
        if (!cancelled && cached.length > 0) setMarkups(cached)
      } catch { /* ignore */ }
      // 2) Then refresh from network
      try {
        const data = await apiGet<{ markups: MarkupFE[] }>(`/plans/${planId}/markups`)
        if (cancelled) return
        setMarkups(data.markups)
        try { await cacheMarkups(data.markups) } catch { /* ignore */ }
      } catch (e) {
        if (!cancelled) showToast({ title: 'Markups load failed', description: (e as Error).message, variant: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [planId, showToast])

  useEffect(() => {
    if (!projectId || !planId) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiGet<{ tasks: TaskFE[] }>(`/projects/${projectId}/tasks?planId=${planId}`)
        if (cancelled) return
        setTasks(data.tasks)
      } catch (e) {
        if (!cancelled) showToast({ title: 'Tasks load failed', description: (e as Error).message, variant: 'error' })
      }
    })()
    return () => { cancelled = true }
  }, [projectId, planId, showToast])

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiGet<{ members: ProjectMemberFE[] }>(`/projects/${projectId}/members`)
        if (cancelled) return
        setMembers(data.members)
      } catch { /* ignore */ }
    })()
    return () => { cancelled = true }
  }, [projectId])

  // ───────────────────────── Markup mutations ─────────────────────────

  const flushPendingMutations = useCallback(async () => {
    const items = Array.from(pendingMutations.current.entries())
    pendingMutations.current.clear()
    for (const [id, patch] of items) {
      try {
        await apiPatch(`/markups/${id}`, patch)
      } catch (e) {
        if (isQueuedError(e)) {
          showToast({ title: 'Saved offline', variant: 'warning' })
          refreshPending()
        } else {
          showToast({ title: 'Save failed', description: (e as Error).message, variant: 'error' })
        }
      }
    }
  }, [showToast, refreshPending])

  const updateMarkup = useCallback((id: string, patch: { coordinates?: string; color?: string; metadata?: string }) => {
    // Optimistic local update
    setMarkups(prev => prev.map(m =>
      m.id === id ? { ...m, ...patch, updatedAt: new Date().toISOString() } : m,
    ))
    // Queue debounced API PATCH
    pendingMutations.current.set(id, { ...pendingMutations.current.get(id), ...patch })
    if (flushTimer.current) clearTimeout(flushTimer.current)
    flushTimer.current = setTimeout(() => { void flushPendingMutations() }, 400)
  }, [flushPendingMutations])

  const createMarkup = useCallback(async (input: { type: MarkupType; coordinates: string; color?: string; metadata?: string }) => {
    if (!planId) return
    const id = genMarkupId()
    const optimistic: MarkupFE = {
      id,
      planId,
      type: input.type,
      pageNumber: currentPage,
      coordinates: input.coordinates,
      color: input.color || color,
      metadata: input.metadata || '{}',
      createdById: user?.id || '',
      createdByName: user?.fullName || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setMarkups(prev => [...prev, optimistic])
    try {
      const data = await apiPost<{ markup: MarkupFE }>(`/plans/${planId}/markups`, {
        id,
        type: input.type,
        pageNumber: currentPage,
        coordinates: input.coordinates,
        color: input.color || color,
        metadata: input.metadata || '{}',
      }, { localId: id })
      setMarkups(prev => prev.map(m => m.id === id ? data.markup : m))
      showToast({ title: 'Markup saved', variant: 'success' })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
        refreshPending()
      } else {
        // Revert optimistic
        setMarkups(prev => prev.filter(m => m.id !== id))
        const msg = e instanceof ApiError ? e.message : 'Failed to save markup'
        showToast({ title: 'Save failed', description: msg, variant: 'error' })
      }
    }
  }, [planId, currentPage, color, user, showToast, refreshPending])

  const deleteMarkup = useCallback(async (id: string) => {
    const prev = markups
    setMarkups(p => p.filter(m => m.id !== id))
    setSelectedMarkupId(null)
    setPanelMode('tasks')
    try {
      await apiDelete(`/markups/${id}`)
      showToast({ title: 'Markup deleted', variant: 'success' })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Will delete when online', variant: 'warning' })
        refreshPending()
      } else {
        setMarkups(prev)
        showToast({ title: 'Delete failed', description: (e as Error).message, variant: 'error' })
      }
    }
  }, [markups, showToast, refreshPending])

  // ───────────────────────── Attachments ─────────────────────────

  const loadAttachments = useCallback(async (markupId: string) => {
    try {
      const data = await apiGet<{ attachments: MarkupAttachmentFE[] }>(`/markups/${markupId}/attachments`)
      setAttachments(data.attachments)
    } catch {
      setAttachments([])
    }
  }, [])

  // Load attachments when a markup is selected
  useEffect(() => {
    if (!selectedMarkupId) {
      setAttachments([])
      return
    }
    void loadAttachments(selectedMarkupId)
  }, [selectedMarkupId, loadAttachments])

  // Build object URLs for attachment thumbnails
  useEffect(() => {
    if (attachments.length === 0) {
      setAttachmentUrls(new Map())
      return
    }
    let cancelled = false
    const urls = new Map<string, string>()
    Promise.all(attachments.map(async (a) => {
      try {
        const blob = await apiFetchBlob(`/attachments/markup/${a.id}`)
        if (cancelled) return
        urls.set(a.id, URL.createObjectURL(blob))
      } catch { /* ignore */ }
    })).then(() => {
      if (!cancelled) setAttachmentUrls(new Map(urls))
    })
    return () => {
      cancelled = true
      urls.forEach(url => URL.revokeObjectURL(url))
    }
  }, [attachments])

  const uploadAttachment = useCallback(async (markupId: string, file: File) => {
    setUploadingAtt(true)
    try {
      await apiPost(`/markups/${markupId}/attachments`, undefined, {
        multipart: { field: 'file', file, fileName: file.name, mimeType: file.type },
      })
      await loadAttachments(markupId)
      showToast({ title: 'Attachment uploaded', variant: 'success' })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline', variant: 'warning' })
        refreshPending()
      } else {
        showToast({ title: 'Upload failed', description: (e as Error).message, variant: 'error' })
      }
    } finally {
      setUploadingAtt(false)
    }
  }, [loadAttachments, showToast, refreshPending])

  const deleteAttachment = useCallback(async (attachmentId: string) => {
    try {
      await apiDelete(`/attachments/markup/${attachmentId}`)
      setAttachments(prev => prev.filter(a => a.id !== attachmentId))
      showToast({ title: 'Attachment removed', variant: 'success' })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Will delete when online', variant: 'warning' })
        refreshPending()
      } else {
        showToast({ title: 'Delete failed', description: (e as Error).message, variant: 'error' })
      }
    }
  }, [showToast, refreshPending])

  // ───────────────────────── Overlay callbacks ─────────────────────────

  const handlePlacePin = useCallback((pt: { x: number; y: number }) => {
    setPendingPin(pt)
    setPanelMode('add-task')
    setTool('select') // exit pin mode after placement
  }, [])

  const handleTextCreate = useCallback((pt: { x: number; y: number }) => {
    const text = window.prompt('Markup text:')
    if (!text || !text.trim()) return
    void createMarkup({
      type: 'text',
      coordinates: JSON.stringify({ x: pt.x, y: pt.y, text: text.trim() }),
    })
  }, [createMarkup])

  const handleSelectMarkup = useCallback((id: string | null) => {
    setSelectedMarkupId(id)
    setSelectedTaskId(null)
    setPanelMode(id ? 'markup' : 'tasks')
  }, [])

  const handleSelectTask = useCallback((id: string | null) => {
    setSelectedTaskId(id)
    setSelectedMarkupId(null)
    if (id) setPanelMode('tasks')
  }, [])

  const handleWheelZoom = useCallback((deltaY: number) => {
    const factor = deltaY < 0 ? 1.1 : 1 / 1.1
    setScale(s => Math.max(0.25, Math.min(4, +(s * factor).toFixed(3))))
  }, [])

  // Pinch-to-zoom on touch devices (basic 2-finger detection)
  const touchState = useRef<{ id1: number; id2: number; dist: number; scale: number } | null>(null)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const t1 = e.touches[0]
      const t2 = e.touches[1]
      const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
      touchState.current = { id1: t1.identifier, id2: t2.identifier, dist, scale }
    }
  }, [scale])
  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    const st = touchState.current
    if (!st || e.touches.length !== 2) return
    const t1 = e.touches[0]
    const t2 = e.touches[1]
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY)
    if (st.dist > 0) {
      const factor = dist / st.dist
      const next = Math.max(0.25, Math.min(4, +(st.scale * factor).toFixed(3)))
      setScale(next)
    }
    e.preventDefault()
  }, [])
  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (e.touches.length < 2) touchState.current = null
  }, [])

  // ───────────────────────── Filter markups + tasks for current page ─────────────────────────

  const pageMarkups = useMemo(
    () => markups.filter(m => m.pageNumber === currentPage),
    [markups, currentPage],
  )
  const pageTasks = useMemo(
    () => tasks.filter(t => t.pageNumber === currentPage && t.pinCoordinates),
    [tasks, currentPage],
  )

  // ───────────────────────── Pinch + wheel handlers on container ─────────────────────────

  const handleContainerWheel = useCallback((e: React.WheelEvent) => {
    // Only zoom on Ctrl+wheel or always-zoom (to match desktop PDF reader UX)
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
    setScale(s => Math.max(0.25, Math.min(4, +(s * factor).toFixed(3))))
  }, [])

  // ───────────────────────── Render ─────────────────────────

  const toolbar = (
    <Toolbar
      planTitle={plan?.title ?? 'Plan'}
      currentPage={currentPage}
      numPages={numPages}
      onPrevPage={() => setCurrentPage(p => Math.max(1, p - 1))}
      onNextPage={() => setCurrentPage(p => Math.min(numPages, p + 1))}
      scale={scale}
      onZoomOut={() => setScale(s => Math.max(0.25, +(s - 0.1).toFixed(3)))}
      onZoomIn={() => setScale(s => Math.min(4, +(s + 0.1).toFixed(3)))}
      onFit={() => {
        if (containerRef.current && viewportSize.w > 0) {
          const cw = containerRef.current.clientWidth - 32
          const base = viewportSize.w / scale
          if (cw > 0 && base > 0) setScale(Math.max(0.25, Math.min(4, cw / base)))
        }
      }}
      onResetZoom={() => setScale(1)}
      tool={tool}
      onToolChange={setTool}
      color={color}
      onColorChange={setColor}
      onRefresh={() => {
        showToast({ title: 'All changes saved', description: 'Markups persist automatically.', variant: 'success' })
      }}
      onToggleTasks={() => {
        setPanelMode(p => {
          if (p === 'tasks') return null
          setSelectedTaskId(null)
          return 'tasks'
        })
      }}
      tasksPanelOpen={panelMode === 'tasks'}
      onBack={back}
    />
  )

  const panelContent = (() => {
    if (panelMode === 'add-task' && pendingPin && projectId && planId) {
      return (
        <TaskPinForm
          projectId={projectId}
          planId={planId}
          pageNumber={currentPage}
          pinCoordinates={pendingPin}
          members={members}
          onCancel={() => { setPendingPin(null); setPanelMode('tasks') }}
          onCreated={(task) => {
            setTasks(prev => [task, ...prev])
            setPendingPin(null)
            setSelectedTaskId(task.id)
            setPanelMode('tasks')
            showToast({ title: 'Task created at pin', variant: 'success' })
          }}
        />
      )
    }
    if (panelMode === 'markup' && selectedMarkup) {
      return (
        <MarkupPanel
          markup={selectedMarkup}
          attachments={attachments}
          attachmentUrls={attachmentUrls}
          uploading={uploadingAtt}
          onUpload={(file) => void uploadAttachment(selectedMarkup.id, file)}
          onDeleteAttachment={(id) => void deleteAttachment(id)}
          onDeleteMarkup={() => void deleteMarkup(selectedMarkup.id)}
          onColorChange={(c) => updateMarkup(selectedMarkup.id, { color: c })}
        />
      )
    }
    if (panelMode === 'tasks' && selectedTask) {
      return (
        <TaskSummaryPanel
          task={selectedTask}
          onBack={() => setSelectedTaskId(null)}
          onOpen={() => navigate('task-detail', { projectId: projectId!, taskId: selectedTask.id })}
        />
      )
    }
    // Default: tasks list
    return (
      <TasksListPanel
        tasks={tasks}
        currentPage={currentPage}
        onPick={(id) => { setSelectedTaskId(id); setCurrentPage(tasks.find(t => t.id === id)?.pageNumber ?? currentPage) }}
        onOpenTask={(id) => navigate('task-detail', { projectId: projectId!, taskId: id })}
      />
    )
  })()

  return (
    <div className="flex flex-col h-full min-h-0 bg-zinc-50">
      {toolbar}
      <div className="flex-1 flex min-h-0">
        {/* Canvas + overlay area */}
        <div
          ref={containerRef}
          className="flex-1 overflow-auto relative bg-zinc-100"
          onWheel={handleContainerWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {loadError && (
            <div className="absolute inset-0 grid place-items-center p-6 text-center">
              <div className="max-w-md space-y-2">
                <div className="text-red-600 font-semibold">Failed to load plan</div>
                <div className="text-sm text-zinc-600">{loadError}</div>
                <Button variant="outline" size="sm" onClick={back}>
                  <ArrowLeft className="h-4 w-4" /> Go back
                </Button>
              </div>
            </div>
          )}
          {!loadError && !pdfDoc && (
            <div className="absolute inset-0 grid place-items-center">
              <div className="flex flex-col items-center gap-2 text-zinc-500">
                <Loader2 className="h-6 w-6 animate-spin" />
                <span className="text-sm">Loading PDF…</span>
              </div>
            </div>
          )}
          {pdfDoc && (
            <div
              className="relative mx-auto my-4 shadow-lg"
              style={{
                width: viewportSize.w > 0 ? viewportSize.w : 'auto',
                height: viewportSize.h > 0 ? viewportSize.h : 600,
              }}
            >
              <canvas
                ref={canvasRef}
                className="block bg-white"
                style={{ pointerEvents: 'none' }}
              />
              {rendering && (
                <div className="absolute inset-0 grid place-items-center bg-white/40 backdrop-blur-sm pointer-events-none">
                  <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
                </div>
              )}
              <MarkupOverlay
                key={tool /* remount on tool change → clears in-progress draw/drag state */}
                width={viewportSize.w}
                height={viewportSize.h}
                markups={pageMarkups}
                tasks={pageTasks}
                tool={tool}
                color={color}
                selectedMarkupId={selectedMarkupId}
                selectedTaskId={selectedTaskId}
                onSelectMarkup={handleSelectMarkup}
                onSelectTask={handleSelectTask}
                onCreateMarkup={createMarkup}
                onUpdateMarkup={updateMarkup}
                onPlacePin={handlePlacePin}
                onTextCreate={handleTextCreate}
                onWheelZoom={handleWheelZoom}
              />
            </div>
          )}
        </div>

        {/* Desktop aside panel */}
        {!isMobile && panelMode !== null && (
          <aside className="w-96 border-l border-zinc-200 bg-white flex flex-col min-h-0">
            {panelContent}
          </aside>
        )}
      </div>

      {/* Mobile bottom sheet */}
      {isMobile && panelMode !== null && (
        <Sheet open={panelMode !== null} onOpenChange={(open) => { if (!open) setPanelMode(null) }}>
          <SheetContent side="bottom" className="h-[80vh] p-0">
            <SheetTitle className="sr-only">Panel</SheetTitle>
            {panelContent}
          </SheetContent>
        </Sheet>
      )}

      {/* Bottom status bar */}
      <div className="h-8 border-t border-zinc-200 bg-white px-4 flex items-center justify-between text-xs text-zinc-600">
        <div className="flex items-center gap-3">
          <span>Page {currentPage} / {numPages}</span>
          <span>·</span>
          <span>{Math.round(scale * 100)}%</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            {online ? <Wifi className="h-3 w-3 text-emerald-500" /> : <WifiOff className="h-3 w-3 text-amber-500" />}
            {online ? 'Online' : 'Offline'}
          </span>
          {pageMarkups.length > 0 && <span>{pageMarkups.length} markups</span>}
          {pageTasks.length > 0 && <span>{pageTasks.length} pins</span>}
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Sub-components ─────────────────────────

function Toolbar(props: {
  planTitle: string
  currentPage: number
  numPages: number
  onPrevPage: () => void
  onNextPage: () => void
  scale: number
  onZoomOut: () => void
  onZoomIn: () => void
  onFit: () => void
  onResetZoom: () => void
  tool: ToolId
  onToolChange: (t: ToolId) => void
  color: string
  onColorChange: (c: string) => void
  onRefresh: () => void
  onToggleTasks: () => void
  tasksPanelOpen: boolean
  onBack: () => void
}) {
  return (
    <header className="sticky top-0 z-30 bg-white border-b border-zinc-200">
      <div className="px-3 py-2 flex flex-wrap items-center gap-2">
        {/* Back + title */}
        <div className="flex items-center gap-2 min-w-0">
          <Button variant="ghost" size="icon" onClick={props.onBack} aria-label="Back to project">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="font-semibold text-sm truncate max-w-[14rem]" title={props.planTitle}>
            {props.planTitle}
          </span>
        </div>

        <Separator orientation="vertical" className="h-6 hidden md:block" />

        {/* Page nav */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={props.onPrevPage}
            disabled={props.currentPage <= 1} aria-label="Previous page">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs text-zinc-600 px-1 min-w-[5rem] text-center">
            Page {props.currentPage} / {props.numPages}
          </span>
          <Button variant="outline" size="icon" onClick={props.onNextPage}
            disabled={props.currentPage >= props.numPages} aria-label="Next page">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 hidden md:block" />

        {/* Zoom */}
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={props.onZoomOut} aria-label="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={props.onResetZoom} className="min-w-[3rem]">
            {Math.round(props.scale * 100)}%
          </Button>
          <Button variant="outline" size="icon" onClick={props.onZoomIn} aria-label="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={props.onFit} aria-label="Fit to width">
            <Maximize className="h-4 w-4" />
          </Button>
        </div>

        <Separator orientation="vertical" className="h-6 hidden md:block" />

        {/* Tool selector */}
        <div className="flex items-center gap-1 flex-wrap">
          {TOOL_LIST.map(({ id, label, Icon }) => (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <Button
                  variant={props.tool === id ? 'default' : 'outline'}
                  size="icon"
                  onClick={() => props.onToolChange(id)}
                  aria-label={label}
                  className={props.tool === id ? 'bg-zinc-900 text-white' : ''}
                >
                  <Icon className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">{label}</TooltipContent>
            </Tooltip>
          ))}
        </div>

        {/* Color picker */}
        <div className="flex items-center gap-1 ml-1">
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              onClick={() => props.onColorChange(c)}
              aria-label={`Color ${c}`}
              className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                props.color === c ? 'border-zinc-900 scale-110' : 'border-white'
              }`}
              style={{ backgroundColor: c, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)' }}
            />
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={props.onRefresh} className="hidden sm:flex">
            <Save className="h-4 w-4" /> Saved
          </Button>
          <Button
            variant={props.tasksPanelOpen ? 'default' : 'outline'}
            size="sm"
            onClick={props.onToggleTasks}
            className={props.tasksPanelOpen ? 'bg-zinc-900 text-white' : ''}
          >
            <ListTodo className="h-4 w-4" /> Tasks
          </Button>
        </div>
      </div>
    </header>
  )
}

// ───────────────────────── Tasks list panel ─────────────────────────

function TasksListPanel(props: {
  tasks: TaskFE[]
  currentPage: number
  onPick: (id: string) => void
  onOpenTask: (id: string) => void
}) {
  const { tasks, currentPage, onPick, onOpenTask } = props
  const sorted = useMemo(() => {
    return [...tasks].sort((a, b) => {
      // P1 first, then P2, then P3; ties broken by due date.
      const p = ['P1', 'P2', 'P3']
      const pd = p.indexOf(a.priority) - p.indexOf(b.priority)
      if (pd !== 0) return pd
      return (a.dueDate || '9999').localeCompare(b.dueDate || '9999')
    })
  }, [tasks])
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center justify-between">
        <h3 className="font-semibold text-sm">Tasks on this plan</h3>
        <Badge variant="secondary">{tasks.length}</Badge>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {sorted.length === 0 && (
            <div className="text-sm text-zinc-500 text-center py-8">
              No tasks on this plan yet.
              <br />
              <span className="text-xs">Use the Pin tool to drop one.</span>
            </div>
          )}
          {sorted.map(t => (
            <button
              key={t.id}
              onClick={() => onPick(t.id)}
              className="w-full text-left rounded-md border border-zinc-200 p-3 hover:bg-zinc-50 transition-colors"
            >
              <div className="flex items-start gap-2">
                <span
                  className="mt-0.5 inline-flex items-center justify-center h-5 w-5 rounded-full text-[10px] font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: priorityColor(t.priority as TaskPriority) }}
                  title={`Priority ${t.priority}`}
                >
                  {t.priority.replace('P', '')}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">{t.title}</div>
                  {t.description && (
                    <div className="text-xs text-zinc-500 line-clamp-2 mt-0.5">{t.description}</div>
                  )}
                  <div className="flex flex-wrap items-center gap-1 mt-1.5">
                    <Badge variant={STATUS_VARIANT[t.status] || 'outline'} className="text-[10px]">
                      {STATUS_LABEL[t.status] || t.status}
                    </Badge>
                    {t.pageNumber !== null && (
                      <Badge variant="outline" className="text-[10px]">P{t.pageNumber}</Badge>
                    )}
                    {t.dueDate && (
                      <Badge variant="outline" className="text-[10px]">
                        Due {new Date(t.dueDate).toLocaleDateString()}
                      </Badge>
                    )}
                    {t.assigneeName && (
                      <Badge variant="outline" className="text-[10px]">{t.assigneeName}</Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-2 flex justify-end">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs"
                  onClick={(e) => { e.stopPropagation(); onOpenTask(t.id) }}
                >
                  Open task <ExternalLink className="h-3 w-3" />
                </Button>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// ───────────────────────── Task summary panel ─────────────────────────

function TaskSummaryPanel(props: {
  task: TaskFE
  onBack: () => void
  onOpen: () => void
}) {
  const { task, onBack, onOpen } = props
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-200 flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to list">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="font-semibold text-sm">Task summary</h3>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-3">
          <div>
            <div className="text-xs text-zinc-500 uppercase mb-1">Title</div>
            <div className="font-medium">{task.title}</div>
          </div>
          {task.description && (
            <div>
              <div className="text-xs text-zinc-500 uppercase mb-1">Description</div>
              <div className="text-sm whitespace-pre-wrap">{task.description}</div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Priority">
              <span
                className="inline-flex items-center justify-center h-5 px-2 rounded-full text-[10px] font-bold text-white"
                style={{ backgroundColor: priorityColor(task.priority as TaskPriority) }}
              >
                {task.priority}
              </span>
            </Field>
            <Field label="Status">
              <Badge variant={STATUS_VARIANT[task.status] || 'outline'}>{STATUS_LABEL[task.status] || task.status}</Badge>
            </Field>
            <Field label="Page"><span className="text-sm">P{task.pageNumber ?? '-'}</span></Field>
            <Field label="Due">
              <span className="text-sm">{task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '—'}</span>
            </Field>
            <Field label="Assignee"><span className="text-sm">{task.assigneeName || 'Unassigned'}</span></Field>
            <Field label="Trade"><span className="text-sm">{task.trade || '—'}</span></Field>
            <Field label="Category"><span className="text-sm">{task.category || '—'}</span></Field>
            <Field label="Location"><span className="text-sm">{task.locationName || '—'}</span></Field>
          </div>
          {task.tags.length > 0 && (
            <div>
              <div className="text-xs text-zinc-500 uppercase mb-1">Tags</div>
              <div className="flex flex-wrap gap-1">
                {task.tags.map(tag => <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>)}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
      <div className="border-t border-zinc-200 p-3">
        <Button onClick={onOpen} className="w-full">
          <ExternalLink className="h-4 w-4" /> Open task
        </Button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 uppercase mb-0.5">{label}</div>
      <div>{children}</div>
    </div>
  )
}

// ───────────────────────── Markup properties panel ─────────────────────────

function MarkupPanel(props: {
  markup: MarkupFE
  attachments: MarkupAttachmentFE[]
  attachmentUrls: Map<string, string>
  uploading: boolean
  onUpload: (file: File) => void
  onDeleteAttachment: (id: string) => void
  onDeleteMarkup: () => void
  onColorChange: (c: string) => void
}) {
  const { markup, attachments, attachmentUrls, uploading, onUpload, onDeleteAttachment, onDeleteMarkup, onColorChange } = props
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-zinc-200">
        <h3 className="font-semibold text-sm capitalize">{markup.type} markup</h3>
        <p className="text-xs text-zinc-500 mt-0.5">Page {markup.pageNumber}</p>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          <div>
            <div className="text-xs text-zinc-500 uppercase mb-1.5">Color</div>
            <div className="flex items-center gap-1.5">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => onColorChange(c)}
                  className={`h-6 w-6 rounded-full border-2 transition-transform hover:scale-110 ${
                    markup.color === c ? 'border-zinc-900' : 'border-white'
                  }`}
                  style={{ backgroundColor: c, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)' }}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-zinc-500 uppercase mb-1">Created by</div>
            <div className="text-sm">{markup.createdByName || 'Unknown'}</div>
            <div className="text-xs text-zinc-400 mt-0.5">
              {new Date(markup.createdAt).toLocaleString()}
            </div>
          </div>

          <Separator />

          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-zinc-500 uppercase">Attachments</div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                Add
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) onUpload(f)
                  e.target.value = ''
                }}
              />
            </div>
            {attachments.length === 0 && (
              <div className="text-xs text-zinc-400 text-center py-3">No attachments.</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              {attachments.map(a => {
                const url = attachmentUrls.get(a.id)
                return (
                  <div key={a.id} className="relative group rounded-md overflow-hidden border border-zinc-200">
                    {url ? (
                      <img src={url} alt={a.fileName} className="w-full h-24 object-cover" />
                    ) : (
                      <div className="w-full h-24 grid place-items-center bg-zinc-100">
                        <Loader2 className="h-4 w-4 animate-spin text-zinc-400" />
                      </div>
                    )}
                    <div className="px-1.5 py-1 text-[10px] text-zinc-600 truncate" title={a.fileName}>
                      {a.fileName}
                    </div>
                    <button
                      onClick={() => onDeleteAttachment(a.id)}
                      className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 text-white grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity"
                      aria-label="Delete attachment"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )
              })}
            </div>
          </div>

          <Separator />

          <div>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="w-full"
            >
              <Trash2 className="h-4 w-4" /> Delete markup
            </Button>
          </div>
        </div>
      </ScrollArea>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete markup?</DialogTitle>
            <DialogDescription>
              This will remove the markup and its attachments. Linked tasks will be preserved.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => { setConfirmDelete(false); onDeleteMarkup() }}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
