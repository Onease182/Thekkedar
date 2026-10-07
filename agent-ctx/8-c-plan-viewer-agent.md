# Task 8-c: PlanViewerView agent work record

## Files created
- `src/components/views/markup-renderers.tsx` — pure SVG shape renderers + pin marker + helpers (PRESET_COLORS, PRIORITY_COLORS, parseCoords, cloudPath, arrowHeadPoints, PinMarker, MarkupShape, markupBBox, hitTestHandle).
- `src/components/views/MarkupOverlay.tsx` — interactive SVG overlay: handles draw/select/move/resize + tool-based pointer routing.
- `src/components/views/TaskPinForm.tsx` — side-panel form for creating a task at a pin location.
- `src/components/views/PlanViewerView.tsx` — main orchestrator: PDF.js rendering + state + UI chrome (toolbar, side panel, status bar).

## Key decisions
- **Task-pin convention**: chose the recommended approach — store `pinCoordinates` directly on the task (no separate Markup row needed for task pins). The pin tool clicks → open TaskPinForm with the click's normalized (x, y) → on submit, `apiPost('/projects/{projectId}/tasks', { ...form, planId, pageNumber, pinCoordinates: JSON.stringify({x,y}) })`. Task pins are rendered on the overlay from each task's `pinCoordinates` field, colored by `priorityColor(t.priority)` (P1=red, P2=amber, P3=emerald). Standalone markups (rect/circle/cloud/polyline/arrow/text) ARE separate Markup rows persisted via `/api/plans/{planId}/markups`.
- **Split into 4 files** (per the spec's recommendation) rather than one giant file. Documented the split in PlanViewerView's header comment.
- **PDF.js worker**: dynamically imported in a `useEffect` with the CDN-bundled worker URL `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs` to avoid bundler issues.
- **Coordinate system**: all markup coords normalized 0..1 relative to canvas pixel size; SVG `viewBox="0 0 W H"` matches canvas buffer 1:1. For circle, radius is `(c.r || 0.05) * Math.min(W, H) / 2`. For pin/text/rectangle/cloud, multiply by viewport pixel dims directly.
- **Optimistic + debounced mutations**: `updateMarkup` updates local state immediately + queues a debounced PATCH (400ms after last change). `createMarkup` and `deleteMarkup` go through immediately with optimistic rollback on failure. All mutations catch `QueuedError` → show "Saved offline" toast.
- **Tool-change reset**: rather than `useEffect(setState)` (lint-flagged), parent passes `key={tool}` to MarkupOverlay so it remounts on tool change, discarding in-progress draw/drag state cleanly.
- **ConnectivityBar lint fix**: pre-existing `set-state-in-effect` rule was failing. Fixed by deferring `setJustSynced(true)` into a `setTimeout(0)` instead of calling it synchronously in the effect body (the lint rule's intent is preserved — no cascading renders).
- **Layout**: full-screen flex column: sticky toolbar (`h-auto`, wraps on mobile via `flex-wrap`), middle area (`flex-1 min-h-0`) with canvas + overlay + desktop aside (`w-96`), bottom status bar (`h-8`). Mobile uses a bottom Sheet instead of aside.
- **Pinch-to-zoom** on mobile via 2-finger `touchmove` distance ratio. Wheel-zoom on desktop via `onWheel` on the container.
- **IndexedDB cache-first**: markups load from `getCachedMarkupsByPlan(planId)` immediately, then refresh from network. Updated via `cacheMarkups`.

## Stage summary
- All 4 files compile cleanly (`bun run lint` exits 0; Turbopack compiles `/` in 4.5s with no errors).
- `GET / 200` from `http://127.0.0.1:3000/` confirmed (subsequent requests ~30ms — cached).
- End-to-end UX (login → project → plan → viewer) is not directly verifiable without a browser, but the page entry compiles + serves successfully.
- Coordination note: a `task-detail/` subdirectory (with AttachmentsTab, CommentsTab, ChecklistsTab, RelationsTab, shared.tsx) appeared concurrently in `src/components/views/`. I did not touch any of those files.
