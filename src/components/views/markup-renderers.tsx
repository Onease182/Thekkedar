'use client'

// Pure helpers + small React SVG components for rendering markups and pins.
// All markup coordinates are normalized 0..1 relative to the page's render
// viewport (canvas pixel size). On render we multiply normalized coords by the
// canvas size to get SVG pixels.

import React from 'react'
import type { MarkupType, TaskPriority, PointXY, RectCoords, CircleCoords, PolylineCoords, TextCoords } from '@/types'
import type { MarkupFE } from '@/lib/client/types'

// ───────────────────────── Color presets + helpers ─────────────────────────

// Avoid indigo/blue per design rules. These cover the common construction
// annotation palette: red, orange, amber, emerald, slate.
export const PRESET_COLORS: readonly string[] = ['#ef4444', '#f97316', '#f59e0b', '#10b981', '#64748b']

export const PRIORITY_COLORS: Record<TaskPriority, string> = {
  P1: '#ef4444', // red — urgent
  P2: '#f59e0b', // amber — important
  P3: '#10b981', // emerald — routine
}

export function priorityColor(p?: TaskPriority | null): string {
  if (!p) return '#64748b'
  return PRIORITY_COLORS[p] ?? '#64748b'
}

// ───────────────────────── Coordinate parsing ─────────────────────────

export function parseCoords<T = unknown>(raw?: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0
  return Math.max(0, Math.min(1, v))
}

// ───────────────────────── Shape geometry ─────────────────────────

/**
 * Build a cloud-like scalloped path around the rectangle.
 * Each side is broken into N semicircular bumps bulging outward (sweep flag = 1).
 */
export function cloudPath(x: number, y: number, w: number, h: number): string {
  if (w <= 1 || h <= 1) return ''
  const maxR = Math.min(w / 4, h / 4, 18)
  const r = Math.max(4, Math.min(12, maxR))
  const topCount = Math.max(2, Math.round(w / (r * 2)))
  const rightCount = Math.max(2, Math.round(h / (r * 2)))
  const bottomCount = topCount
  const leftCount = rightCount

  const topR = w / (topCount * 2)
  const rightR = h / (rightCount * 2)
  const bottomR = w / (bottomCount * 2)
  const leftR = h / (leftCount * 2)

  let d = `M ${x.toFixed(2)} ${y.toFixed(2)}`
  // top edge: left → right
  for (let i = 0; i < topCount; i++) {
    const endX = x + ((i + 1) * w) / topCount
    d += ` A ${topR.toFixed(2)} ${topR.toFixed(2)} 0 0 1 ${endX.toFixed(2)} ${y.toFixed(2)}`
  }
  // right edge: top → bottom
  for (let i = 0; i < rightCount; i++) {
    const endY = y + ((i + 1) * h) / rightCount
    d += ` A ${rightR.toFixed(2)} ${rightR.toFixed(2)} 0 0 1 ${(x + w).toFixed(2)} ${endY.toFixed(2)}`
  }
  // bottom edge: right → left
  for (let i = 0; i < bottomCount; i++) {
    const endX = x + w - ((i + 1) * w) / bottomCount
    d += ` A ${bottomR.toFixed(2)} ${bottomR.toFixed(2)} 0 0 1 ${endX.toFixed(2)} ${(y + h).toFixed(2)}`
  }
  // left edge: bottom → top
  for (let i = 0; i < leftCount; i++) {
    const endY = y + h - ((i + 1) * h) / leftCount
    d += ` A ${leftR.toFixed(2)} ${leftR.toFixed(2)} 0 0 1 ${x.toFixed(2)} ${endY.toFixed(2)}`
  }
  d += ' Z'
  return d
}

/**
 * Three-point polygon string for an arrowhead at the line endpoint.
 */
export function arrowHeadPoints(x1: number, y1: number, x2: number, y2: number, size = 14): string {
  const angle = Math.atan2(y2 - y1, x2 - x1)
  const a1 = angle + Math.PI - Math.PI / 7
  const a2 = angle + Math.PI + Math.PI / 7
  const p1x = x2 + size * Math.cos(a1)
  const p1y = y2 + size * Math.sin(a1)
  const p2x = x2 + size * Math.cos(a2)
  const p2y = y2 + size * Math.sin(a2)
  return `${p1x.toFixed(2)},${p1y.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)} ${p2x.toFixed(2)},${p2y.toFixed(2)}`
}

// ───────────────────────── Pin marker ─────────────────────────

export interface PinMarkerProps {
  /** Pixel x of the pin tip (the point touching the page) */
  cx: number
  /** Pixel y of the pin tip */
  cy: number
  color: string
  label?: string | number
  selected?: boolean
  onPointerDown?: (e: React.PointerEvent<SVGGElement>) => void
  onClick?: (e: React.MouseEvent<SVGGElement>) => void
}

/**
 * A teardrop/push-pin marker rendered at (cx, cy). The tip points down at the
 * click location; the bulb extends upward.
 */
export function PinMarker({ cx, cy, color, label, selected, onPointerDown, onClick }: PinMarkerProps) {
  const bulbR = 13
  const bulbCy = cy - bulbR - 4
  // Triangle tip from bulb bottom to (cx, cy)
  const tipPath = `M ${cx} ${cy} L ${cx - 7} ${bulbCy + bulbR - 1} A ${bulbR} ${bulbR} 0 1 1 ${cx + 7} ${bulbCy + bulbR - 1} Z`
  return (
    <g onPointerDown={onPointerDown} onClick={onClick} style={{ cursor: 'pointer' }} role="button" tabIndex={0}>
      {/* invisible hit area for easier clicking */}
      <circle cx={cx} cy={bulbCy} r={bulbR + 6} fill="transparent" />
      <path d={tipPath} fill={color} stroke="#1f2937" strokeWidth={1.5} strokeLinejoin="round" />
      <circle cx={cx} cy={bulbCy} r={bulbR} fill={color} stroke="#1f2937" strokeWidth={1.5} />
      <circle cx={cx} cy={bulbCy} r={bulbR * 0.5} fill="#ffffff" />
      {label !== undefined && label !== '' && (
        <text
          x={cx}
          y={bulbCy + 4}
          textAnchor="middle"
          fontSize={11}
          fontWeight={700}
          fill={color}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          {label}
        </text>
      )}
      {selected && (
        <>
          <circle cx={cx} cy={bulbCy} r={bulbR + 4} fill="none" stroke="#1f2937" strokeWidth={1.5} strokeDasharray="4 3" />
          <circle cx={cx} cy={cy} r={4} fill="#1f2937" />
        </>
      )}
    </g>
  )
}

// ───────────────────────── Markup shape renderer ─────────────────────────

export interface MarkupShapeProps {
  markup: MarkupFE
  width: number
  height: number
  selected?: boolean
  onPointerDown?: (e: React.PointerEvent<SVGElement>) => void
  onClick?: (e: React.MouseEvent<SVGElement>) => void
}

/**
 * Renders a single markup shape (rectangle / circle / cloud / polyline / arrow / text).
 * Pin markups are rendered via the PinMarker component by the overlay (since they
 * need a hit area + label tied to a task).
 */
export function MarkupShape({ markup, width, height, selected, onPointerDown, onClick }: MarkupShapeProps) {
  const color = markup.color || '#ef4444'
  const coords = parseCoords(markup.coordinates)
  if (!coords) return null

  const interactiveProps = {
    onPointerDown,
    onClick,
    style: { cursor: 'pointer' as const },
  }

  let element: React.ReactNode = null

  switch (markup.type as MarkupType) {
    case 'rectangle': {
      const r = coords as RectCoords
      if (!r || typeof r.x !== 'number') break
      const x = r.x * width
      const y = r.y * height
      const w = r.w * width
      const h = r.h * height
      element = (
        <rect
          x={x}
          y={y}
          width={Math.abs(w)}
          height={Math.abs(h)}
          fill={color + '22'}
          stroke={color}
          strokeWidth={2}
          {...interactiveProps}
        />
      )
      break
    }
    case 'circle': {
      const c = coords as CircleCoords
      if (!c || typeof c.x !== 'number') break
      const cx = c.x * width
      const cy = c.y * height
      const rad = (c.r || 0.05) * (Math.min(width, height) / 2)
      element = (
        <circle
          cx={cx}
          cy={cy}
          r={rad}
          fill={color + '22'}
          stroke={color}
          strokeWidth={2}
          {...interactiveProps}
        />
      )
      break
    }
    case 'cloud': {
      const r = coords as RectCoords
      if (!r || typeof r.x !== 'number') break
      const x = r.x * width
      const y = r.y * height
      const w = r.w * width
      const h = r.h * height
      element = (
        <path
          d={cloudPath(x, y, Math.abs(w), Math.abs(h))}
          fill={color + '22'}
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          {...interactiveProps}
        />
      )
      break
    }
    case 'polyline': {
      const p = coords as PolylineCoords
      if (!p || !Array.isArray(p.points) || p.points.length < 1) break
      const points = p.points
        .map((pt: PointXY) => `${(pt.x * width).toFixed(2)},${(pt.y * height).toFixed(2)}`)
        .join(' ')
      element = (
        <polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={2.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          {...interactiveProps}
        />
      )
      break
    }
    case 'arrow': {
      const p = coords as PolylineCoords
      if (!p || !Array.isArray(p.points) || p.points.length < 2) break
      const s = p.points[0]
      const e = p.points[1]
      const sx = s.x * width
      const sy = s.y * height
      const ex = e.x * width
      const ey = e.y * height
      const headSize = Math.max(10, Math.min(width, height) * 0.025)
      const head = arrowHeadPoints(sx, sy, ex, ey, headSize)
      element = (
        <g {...interactiveProps}>
          <line x1={sx} y1={sy} x2={ex} y2={ey} stroke={color} strokeWidth={3} strokeLinecap="round" />
          <polygon points={head} fill={color} stroke={color} strokeWidth={1} strokeLinejoin="round" />
        </g>
      )
      break
    }
    case 'text': {
      const t = coords as TextCoords
      if (!t || typeof t.x !== 'number') break
      const x = t.x * width
      const y = t.y * height
      const fontSize = Math.max(12, Math.min(width, height) * 0.022)
      element = (
        <text
          x={x}
          y={y + fontSize}
          fontSize={fontSize}
          fill={color}
          stroke="#ffffff"
          strokeWidth={0.4}
          paintOrder="stroke"
          style={{ cursor: 'pointer', userSelect: 'none' }}
          onPointerDown={onPointerDown}
          onClick={onClick}
        >
          {t.text || ''}
        </text>
      )
      break
    }
    case 'pin': {
      // Handled by overlay via PinMarker; no inline rendering here.
      return null
    }
    default:
      return null
  }

  if (!element) return null

  return (
    <g>
      {element}
      {selected && (
        <SelectionOutline markup={markup} width={width} height={height} />
      )}
    </g>
  )
}

// ───────────────────────── Selection outline + handles ─────────────────────────

function SelectionOutline({ markup, width, height }: { markup: MarkupFE; width: number; height: number }) {
  const bbox = markupBBox(markup, width, height)
  if (!bbox) return null
  const padding = 4
  const x = bbox.x - padding
  const y = bbox.y - padding
  const w = bbox.w + padding * 2
  const h = bbox.h + padding * 2
  const handleSize = 8
  const corners = [
    [x, y],
    [x + w, y],
    [x, y + h],
    [x + w, y + h],
  ]
  return (
    <g style={{ pointerEvents: 'none' }}>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        fill="none"
        stroke="#1f2937"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {corners.map(([cx, cy], i) => (
        <rect
          key={i}
          x={cx - handleSize / 2}
          y={cy - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="#ffffff"
          stroke="#1f2937"
          strokeWidth={1}
        />
      ))}
    </g>
  )
}

/**
 * Compute the bounding box (in SVG pixels) for a markup. Used for selection
 * outline and drag-handle placement.
 */
export function markupBBox(
  markup: MarkupFE,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } | null {
  const coords = parseCoords(markup.coordinates)
  if (!coords) return null
  switch (markup.type as MarkupType) {
    case 'rectangle':
    case 'cloud': {
      const r = coords as RectCoords
      if (!r || typeof r.x !== 'number') return null
      const x = r.x * width
      const y = r.y * height
      const w = r.w * width
      const h = r.h * height
      return {
        x: Math.min(x, x + w),
        y: Math.min(y, y + h),
        w: Math.abs(w),
        h: Math.abs(h),
      }
    }
    case 'circle': {
      const c = coords as CircleCoords
      if (!c || typeof c.x !== 'number') return null
      const cx = c.x * width
      const cy = c.y * height
      const rad = (c.r || 0.05) * (Math.min(width, height) / 2)
      return { x: cx - rad, y: cy - rad, w: rad * 2, h: rad * 2 }
    }
    case 'polyline':
    case 'arrow': {
      const p = coords as PolylineCoords
      if (!p || !Array.isArray(p.points) || p.points.length === 0) return null
      const xs = p.points.map((pt: PointXY) => pt.x * width)
      const ys = p.points.map((pt: PointXY) => pt.y * height)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      const minY = Math.min(...ys)
      const maxY = Math.max(...ys)
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    }
    case 'text': {
      const t = coords as TextCoords
      if (!t || typeof t.x !== 'number') return null
      const fontSize = Math.max(12, Math.min(width, height) * 0.022)
      const approxW = (t.text || '').length * fontSize * 0.55
      return { x: t.x * width, y: t.y * height, w: approxW, h: fontSize * 1.2 }
    }
    case 'pin': {
      const p = coords as { x: number; y: number }
      if (!p || typeof p.x !== 'number') return null
      return { x: p.x * width - 14, y: p.y * height - 38, w: 28, h: 42 }
    }
    default:
      return null
  }
}

// ───────────────────────── Handle hit-test ─────────────────────────

export type HandleId = 'body' | 'tl' | 'tr' | 'bl' | 'br' | 'p0' | 'p1' | 'p-last'

/**
 * Hit-test a pointer position against a markup's selection handles.
 * Returns the handle id ('body' for the shape itself, corner codes for resize
 * handles, point indices for polyline/arrow points) or null if no hit.
 */
export function hitTestHandle(
  markup: MarkupFE,
  px: number,
  py: number,
  width: number,
  height: number,
): HandleId | null {
  const bbox = markupBBox(markup, width, height)
  if (!bbox) return null
  const padding = 4
  const handleSize = 10
  const x = bbox.x - padding
  const y = bbox.y - padding
  const w = bbox.w + padding * 2
  const h = bbox.h + padding * 2

  const corners: Array<[HandleId, number, number]> = [
    ['tl', x, y],
    ['tr', x + w, y],
    ['bl', x, y + h],
    ['br', x + w, y + h],
  ]
  for (const [id, cx, cy] of corners) {
    if (Math.abs(px - cx) <= handleSize && Math.abs(py - cy) <= handleSize) return id
  }

  // For polyline/arrow, also test the actual endpoints
  if (markup.type === 'polyline' || markup.type === 'arrow') {
    const coords = parseCoords<PolylineCoords>(markup.coordinates)
    if (coords && Array.isArray(coords.points)) {
      for (let i = 0; i < coords.points.length; i++) {
        const pt = coords.points[i]
        const cx = pt.x * width
        const cy = pt.y * height
        if (Math.abs(px - cx) <= handleSize && Math.abs(py - cy) <= handleSize) {
          return i === 0 ? 'p0' : i === coords.points.length - 1 ? 'p-last' : ('body' as HandleId)
        }
      }
    }
  }

  // Body hit: inside the bbox
  if (px >= x && px <= x + w && py >= y && py <= y + h) return 'body'
  return null
}
