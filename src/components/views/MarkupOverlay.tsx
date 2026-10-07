'use client'

// Interactive SVG overlay for the PlanViewerView. Handles:
// - Rendering markups (filtered by current page) and task pins (filtered by page).
// - Live preview of in-progress drawings (rectangle, circle, cloud, polyline, arrow).
// - Select / move / resize of existing markups via hit-tested handles.
// - Tool-based pointer event routing (select / pin / rect / circle / cloud / polyline / arrow / text).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MarkupType, PointXY, RectCoords, CircleCoords, PolylineCoords } from '@/types'
import type { MarkupFE, TaskFE } from '@/lib/client/types'
import {
  priorityColor,
  parseCoords,
  clamp01,
  MarkupShape,
  PinMarker,
  hitTestHandle,
  type HandleId,
} from './markup-renderers'

export type ToolId = 'select' | 'pin' | 'rectangle' | 'circle' | 'cloud' | 'polyline' | 'arrow' | 'text'

export interface MarkupOverlayProps {
  width: number
  height: number
  markups: MarkupFE[] // markups for the current page
  tasks: TaskFE[] // tasks with pinCoordinates for the current page
  tool: ToolId
  color: string
  selectedMarkupId: string | null
  selectedTaskId: string | null
  onSelectMarkup: (id: string | null) => void
  onSelectTask: (id: string | null) => void
  onCreateMarkup: (m: { type: MarkupType; coordinates: string; color?: string; metadata?: string }) => void
  onUpdateMarkup: (id: string, patch: { coordinates?: string; color?: string; metadata?: string }) => void
  onPlacePin: (pt: { x: number; y: number }) => void
  onTextCreate?: (pt: { x: number; y: number }) => void
  onWheelZoom?: (deltaY: number, clientX: number, clientY: number) => void
}

interface DrawState {
  start: PointXY // normalized
  current: PointXY // normalized
  points: PointXY[] // for polyline/arrow
}

interface DragState {
  markupId: string
  handle: HandleId
  start: PointXY // normalized pointer position at drag start
  originalCoords: string // the markup's original coordinates JSON
}

interface XY { x: number; y: number }

function toXY(p: PointXY): XY { return { x: p.x, y: p.y } }

export function MarkupOverlay(props: MarkupOverlayProps) {
  const {
    width, height, markups, tasks, tool, color,
    selectedMarkupId, selectedTaskId,
    onSelectMarkup, onSelectTask,
    onCreateMarkup, onUpdateMarkup, onPlacePin, onTextCreate, onWheelZoom,
  } = props

  const svgRef = useRef<SVGSVGElement | null>(null)
  const [drawState, setDrawState] = useState<DrawState | null>(null)
  const [dragState, setDragState] = useState<DragState | null>(null)

  // Convert a pointer event's clientX/Y to normalized (0..1) coordinates within the SVG viewport.
  const toLocal = useCallback((clientX: number, clientY: number): PointXY => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const px = rect.width > 0 ? (clientX - rect.left) / rect.width : 0
    const py = rect.height > 0 ? (clientY - rect.top) / rect.height : 0
    return { x: clamp01(px), y: clamp01(py) }
  }, [])

  // ─── Background pointer-down ───
  const handleBackgroundPointerDown = useCallback((e: React.PointerEvent<SVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    const pt = toLocal(e.clientX, e.clientY)

    if (tool === 'select') {
      // Empty-area click → deselect
      onSelectMarkup(null)
      onSelectTask(null)
      return
    }

    if (tool === 'pin') {
      onPlacePin(pt)
      return
    }

    if (tool === 'text') {
      onTextCreate?.(pt)
      return
    }

    if (tool === 'rectangle' || tool === 'circle' || tool === 'cloud') {
      setDrawState({ start: pt, current: pt, points: [pt] })
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* noop */ }
      return
    }

    if (tool === 'polyline' || tool === 'arrow') {
      setDrawState((s) => {
        if (tool === 'arrow' && s && s.points.length >= 1) {
          // Second click → finalize
          const next = [...s.points, pt]
          // Defer finalization to after state settle
          setTimeout(() => {
            if (next.length >= 2) {
              const [a, b] = next
              onCreateMarkup({ type: 'arrow', coordinates: JSON.stringify({ points: [a, b] }), color })
            }
            setDrawState(null)
          }, 0)
          return s
        }
        if (s) {
          return { ...s, current: pt, points: [...s.points, pt] }
        }
        return { start: pt, current: pt, points: [pt] }
      })
      return
    }
  }, [tool, onPlacePin, onTextCreate, onSelectMarkup, onSelectTask, toLocal, onCreateMarkup, color])

  // ─── Pointer move ───
  const handlePointerMove = useCallback((e: React.PointerEvent<SVGElement>) => {
    const pt = toLocal(e.clientX, e.clientY)
    if (dragState) {
      const dx = pt.x - dragState.start.x
      const dy = pt.y - dragState.start.y
      const orig = parseCoords<unknown>(dragState.originalCoords)
      if (!orig) return
      const markup = markups.find(m => m.id === dragState.markupId)
      if (!markup) return
      let newCoords: unknown = orig

      if (dragState.handle === 'body') {
        if (markup.type === 'rectangle' || markup.type === 'cloud') {
          const o = orig as RectCoords
          newCoords = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h }
        } else if (markup.type === 'circle') {
          const o = orig as CircleCoords
          newCoords = { x: o.x + dx, y: o.y + dy, r: o.r }
        } else if (markup.type === 'polyline' || markup.type === 'arrow') {
          const o = orig as PolylineCoords
          newCoords = { points: o.points.map(p => ({ x: p.x + dx, y: p.y + dy })) }
        } else if (markup.type === 'pin' || markup.type === 'text') {
          const o = orig as { x: number; y: number }
          newCoords = { ...o, x: o.x + dx, y: o.y + dy }
        }
      } else if (dragState.handle === 'tl' || dragState.handle === 'tr' ||
                 dragState.handle === 'bl' || dragState.handle === 'br') {
        if (markup.type === 'rectangle' || markup.type === 'cloud') {
          const o = orig as RectCoords
          let nx = o.x, ny = o.y, nw = o.w, nh = o.h
          if (dragState.handle === 'br') {
            nw = Math.max(0.01, o.w + dx)
            nh = Math.max(0.01, o.h + dy)
          } else if (dragState.handle === 'tr') {
            nw = Math.max(0.01, o.w + dx)
            ny = Math.min(o.y + dy, o.y + o.h - 0.01)
            nh = Math.max(0.01, o.h - dy)
          } else if (dragState.handle === 'bl') {
            nx = Math.min(o.x + dx, o.x + o.w - 0.01)
            nw = Math.max(0.01, o.w - dx)
            nh = Math.max(0.01, o.h + dy)
          } else if (dragState.handle === 'tl') {
            nx = Math.min(o.x + dx, o.x + o.w - 0.01)
            ny = Math.min(o.y + dy, o.y + o.h - 0.01)
            nw = Math.max(0.01, o.w - dx)
            nh = Math.max(0.01, o.h - dy)
          }
          newCoords = { x: nx, y: ny, w: nw, h: nh }
        } else if (markup.type === 'circle') {
          const o = orig as CircleCoords
          const dist = Math.sqrt((pt.x - o.x) ** 2 + (pt.y - o.y) ** 2)
          newCoords = { x: o.x, y: o.y, r: Math.max(0.005, dist * 2) }
        }
      } else if (dragState.handle === 'p0' || dragState.handle === 'p-last') {
        if (markup.type === 'polyline' || markup.type === 'arrow') {
          const o = orig as PolylineCoords
          const points = o.points.map(p => ({ ...p }))
          if (dragState.handle === 'p0') points[0] = { x: pt.x, y: pt.y }
          else points[points.length - 1] = { x: pt.x, y: pt.y }
          newCoords = { points }
        }
      }

      onUpdateMarkup(dragState.markupId, { coordinates: JSON.stringify(newCoords) })
      return
    }

    if (drawState) {
      setDrawState(s => s ? { ...s, current: pt } : s)
    }
  }, [dragState, drawState, markups, onUpdateMarkup, toLocal])

  // ─── Pointer up ───
  const handlePointerUp = useCallback((e: React.PointerEvent<SVGElement>) => {
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId) } catch { /* noop */ }
    if (dragState) {
      setDragState(null)
      return
    }
    if (!drawState) return
    const s = drawState
    if (tool === 'rectangle' || tool === 'cloud') {
      const x1 = Math.min(s.start.x, s.current.x)
      const y1 = Math.min(s.start.y, s.current.y)
      const x2 = Math.max(s.start.x, s.current.x)
      const y2 = Math.max(s.start.y, s.current.y)
      const w = x2 - x1
      const h = y2 - y1
      if (w >= 0.005 && h >= 0.005) {
        onCreateMarkup({ type: tool, coordinates: JSON.stringify({ x: x1, y: y1, w, h }), color })
      }
      setDrawState(null)
      return
    }
    if (tool === 'circle') {
      const cx = (s.start.x + s.current.x) / 2
      const cy = (s.start.y + s.current.y) / 2
      const r = Math.max(Math.abs(s.current.x - s.start.x), Math.abs(s.current.y - s.start.y)) / 2
      if (r >= 0.005) {
        onCreateMarkup({ type: 'circle', coordinates: JSON.stringify({ x: cx, y: cy, r }), color })
      }
      setDrawState(null)
      return
    }
    // polyline/arrow are finalized via double-click or Enter — pointerup leaves the preview as-is.
  }, [dragState, drawState, tool, color, onCreateMarkup])

  // ─── Polyline/Arrow completion ───
  const finishPolyline = useCallback(() => {
    if (!drawState) return
    if (drawState.points.length < 2) {
      setDrawState(null)
      return
    }
    if (tool === 'arrow') {
      const [a, b] = drawState.points.slice(0, 2)
      onCreateMarkup({ type: 'arrow', coordinates: JSON.stringify({ points: [a, b] }), color })
    } else {
      onCreateMarkup({ type: 'polyline', coordinates: JSON.stringify({ points: drawState.points }), color })
    }
    setDrawState(null)
  }, [drawState, tool, color, onCreateMarkup])

  useEffect(() => {
    if (!drawState) return
    if (tool !== 'polyline' && tool !== 'arrow') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); finishPolyline() }
      else if (e.key === 'Escape') setDrawState(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawState, tool, finishPolyline])

  // Note: when the tool changes, the parent remounts this component via
  // `key={tool}` so any in-progress drawing/dragging state is discarded
  // automatically — no setState-in-effect needed here.

  // ─── Markup pointer-down (select / drag) ───
  const handleMarkupPointerDown = useCallback((markupId: string) => (e: React.PointerEvent<SVGElement>) => {
    if (tool !== 'select') return
    e.stopPropagation()
    const markup = markups.find(m => m.id === markupId)
    if (!markup) return
    const pt = toLocal(e.clientX, e.clientY)
    const handle = hitTestHandle(markup, pt.x * width, pt.y * height, width, height)
    onSelectMarkup(markupId)
    onSelectTask(null)
    if (handle) {
      setDragState({ markupId, handle, start: pt, originalCoords: markup.coordinates })
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId) } catch { /* noop */ }
    }
  }, [tool, markups, width, height, onSelectMarkup, onSelectTask, toLocal])

  // ─── Task pin click ───
  const handleTaskPinClick = useCallback((taskId: string) => (e: React.MouseEvent<SVGGElement>) => {
    if (tool !== 'select') return
    e.stopPropagation()
    onSelectTask(taskId)
    onSelectMarkup(null)
  }, [tool, onSelectMarkup, onSelectTask])

  // ─── Wheel zoom (passthrough to parent) ───
  const handleWheel = useCallback((e: React.WheelEvent<SVGElement>) => {
    if (onWheelZoom && e.ctrlKey === false) {
      // Default: zoom on wheel
      onWheelZoom(e.deltaY, e.clientX, e.clientY)
    }
  }, [onWheelZoom])

  // ─── Live preview of in-progress drawing ───
  // Computed inline (not memoized) — the compiler had trouble preserving a
  // useMemo here because the inferred deps diverged from the manual list.
  // The work is cheap enough to recompute on every render.
  let previewMarkup: MarkupFE | null = null
  if (drawState) {
    const base: Omit<MarkupFE, 'type' | 'coordinates'> = {
      id: '__preview__',
      planId: '',
      pageNumber: 0,
      color,
      metadata: '{}',
      createdById: '',
      createdByName: '',
      createdAt: '',
      updatedAt: '',
    }
    if (tool === 'rectangle' || tool === 'cloud') {
      const x1 = Math.min(drawState.start.x, drawState.current.x)
      const y1 = Math.min(drawState.start.y, drawState.current.y)
      const x2 = Math.max(drawState.start.x, drawState.current.x)
      const y2 = Math.max(drawState.start.y, drawState.current.y)
      previewMarkup = { ...base, type: tool, coordinates: JSON.stringify({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }) }
    } else if (tool === 'circle') {
      const cx = (drawState.start.x + drawState.current.x) / 2
      const cy = (drawState.start.y + drawState.current.y) / 2
      const r = Math.max(Math.abs(drawState.current.x - drawState.start.x), Math.abs(drawState.current.y - drawState.start.y)) / 2
      previewMarkup = { ...base, type: 'circle', coordinates: JSON.stringify({ x: cx, y: cy, r }) }
    } else if (tool === 'polyline' || tool === 'arrow') {
      const points = [...drawState.points, toXY(drawState.current)]
      previewMarkup = { ...base, type: tool, coordinates: JSON.stringify({ points }) }
    }
  }

  // ─── Rendered markups (memoized) ───
  const renderedMarkups = useMemo(() => {
    return markups.map(m => {
      if (m.type === 'pin') {
        const c = parseCoords<{ x: number; y: number }>(m.coordinates)
        if (!c) return null
        return (
          <PinMarker
            key={m.id}
            cx={c.x * width}
            cy={c.y * height}
            color={m.color}
            selected={m.id === selectedMarkupId}
            onPointerDown={handleMarkupPointerDown(m.id)}
          />
        )
      }
      return (
        <g key={m.id}>
          <MarkupShape
            markup={m}
            width={width}
            height={height}
            selected={m.id === selectedMarkupId}
            onPointerDown={handleMarkupPointerDown(m.id)}
          />
        </g>
      )
    })
  }, [markups, width, height, selectedMarkupId, handleMarkupPointerDown])

  // ─── Rendered task pins (memoized) ───
  const renderedTaskPins = useMemo(() => {
    return tasks.map(t => {
      const c = parseCoords<{ x: number; y: number }>(t.pinCoordinates)
      if (!c) return null
      return (
        <PinMarker
          key={`task-${t.id}`}
          cx={c.x * width}
          cy={c.y * height}
          color={priorityColor(t.priority)}
          label={t.priority.replace('P', '')}
          selected={t.id === selectedTaskId}
          onClick={handleTaskPinClick(t.id)}
          onPointerDown={(e) => { e.stopPropagation() }}
        />
      )
    })
  }, [tasks, width, height, selectedTaskId, handleTaskPinClick])

  const cursorClass = tool === 'select' ? 'cursor-default' : 'cursor-crosshair'

  return (
    <svg
      ref={svgRef}
      className={`absolute inset-0 ${cursorClass}`}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      onPointerDown={handleBackgroundPointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onWheel={handleWheel}
      onDoubleClick={(e) => {
        if (tool === 'polyline' || tool === 'arrow') {
          e.preventDefault()
          finishPolyline()
        }
      }}
      style={{ touchAction: 'none' }}
    >
      <rect x={0} y={0} width={width} height={height} fill="transparent" />
      {renderedMarkups}
      {renderedTaskPins}
      {previewMarkup && (
        <g style={{ pointerEvents: 'none', opacity: 0.85 }}>
          <MarkupShape markup={previewMarkup} width={width} height={height} selected={false} />
        </g>
      )}
    </svg>
  )
}
