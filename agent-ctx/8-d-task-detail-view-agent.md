# Task 8-d — TaskDetailView (rich task editor)

Agent: task-detail-view-agent

## Files created
- `src/components/views/TaskDetailView.tsx` — main shell (header, quick-row, tabs, details, relations-orchestration)
- `src/components/views/task-detail/shared.tsx` — shared helpers (UserAvatar, badges, EditableText, date/file formatters, Skeleton)
- `src/components/views/task-detail/CommentsTab.tsx` — comments list + composer + edit/delete with optimistic UI
- `src/components/views/task-detail/AttachmentsTab.tsx` — grid + drag-drop upload + image thumbnails via blob + download/delete
- `src/components/views/task-detail/ChecklistsTab.tsx` — CRUD for checklists + items, progress bar, inline edit, up/down reorder
- `src/components/views/task-detail/RelationsTab.tsx` — list + add by task ID + relation type select + delete + navigate-to-related

## Key decisions
- Split the spec into one main view + 5 helper files for maintainability. Shared file holds small reusable primitives (EditableText, UserAvatar, badges, date + file-size formatters).
- Optimistic UI: every mutation (PATCH task, POST/PATCH/DELETE comment, POST attachment, POST/PATCH/DELETE checklist + items, POST/DELETE relation) updates local state immediately; PATCH/POST/DELETE then runs in background. On `QueuedError`, surface a "Saved offline" warning toast and keep the optimistic state. On hard `ApiError`, roll back + error toast.
- Auto-save on blur for editable text fields (title, description, metadata cells, tags). EditableText commits on Enter/blur and cancels on Escape; uses local draft so typing doesn't trigger network traffic.
- Status change to `done` → toast "Marked as done — watchers have been notified" (the backend auto-fans-out the notification).
- Assignee change → toast "Assignee updated — they've been notified" (backend's notifyTaskAssigned fires).
- IDB integration: `getCachedTask` is consulted on load to render the cached task immediately when offline; `cacheTask` keeps the cache fresh after every successful PATCH.
- Comments use `getCachedCommentsByTask` for optimistic read + `cacheComments` for write-back.
- Relation response shape: backend returns `{ id, taskId, relatedTaskId, relationType, relatedTask: { id, title, status } | null }` (nested object, OR null), not the flattened `relatedTaskTitle`/`relatedTaskStatus` in the existing `TaskRelationFE` type. Built a local `RelationRow` type and read both shapes defensively.
- RelationsTab add uses `genLocalId` for the optimistic row, then re-fetches the full list once the server returns the new relation (the server's POST response omits `relatedTask`, so the refetch is needed to populate title/status display).
- Attachment thumbnails: fetch bytes via `apiFetchBlob('/attachments/task/{id}')`, create an object URL, revoke on unmount. Non-image files render a file icon (PDF red, others grey).
- Drag-and-drop upload: a single `<div>` drop zone with onDrop/onDragOver handlers, plus a hidden `<input type=file multiple>` triggered by the "Select files" button. MIME acceptance matches the backend allow-list.
- Checklists: each row has a progress bar (% of items checked), title editable inline, items support checkbox toggle, double-click to edit text, up/down buttons for reorder (calls PATCH with new `order` field on each affected item).
- Permissions: `canWrite = useAuthStore.user.role !== 'viewer'`. All inputs/Selects/Buttons get `disabled={!canWrite}`. Edit/Delete controls are hidden entirely when read-only.
- AlertDialog used for destructive confirmations (task delete, comment delete, attachment delete, checklist delete, relation remove).
- Mobile: tabs list scrolls horizontally (`overflow-x-auto`), grid collapses to 2 columns on small screens, quick-row becomes 2-col grid.
- Footer: created-by avatar + name + timestamp, last-updated timestamp, project link (clickable → navigate to project view). All read-only.
- Plan location: if `task.planId` set, an "Open on plan" button calls `navigate('plan-viewer', { projectId, planId })`.

## What works
- Loading the task + project members in parallel, with cached fallback for the task.
- Inline editing of: title, description, status, priority, assignee, due date, start date, trade, category, location, estimated/actual hours, estimated/actual cost, tags.
- Comments: optimistic post with local ID, edit (Cmd/Ctrl+Enter to commit), delete with AlertDialog confirm, scroll-to-bottom on new comments, cached fallback for offline read.
- Attachments: drag-drop + multi-file upload, image thumbnails via blob URL, PDF/file-icon fallback, download via temporary `<a>` element, delete with AlertDialog.
- Checklists: create/rename/delete checklists, add/edit/delete items, checkbox toggle, progress bar, up/down reorder for both checklists and items.
- Relations: add by task ID + relation type select, view related task (click navigates to that task's detail), delete with confirm.
- Read-only mode for viewers (all inputs disabled, edit/delete buttons hidden).
- Offline: every mutation queues via the API client; "Saved offline" toast surfaced; optimistic state persists; on reconnect the sync worker will flush.
- Lint: my files (TaskDetailView.tsx + task-detail/*.tsx) pass `bunx eslint` with exit 0. Pre-existing errors in `MarkupOverlay.tsx`, `markup-renderers.ts`, `ConnectivityBar.tsx`, `ProjectView.tsx` are out of scope.
- Dev server: `GET /` returns 200; dev.log shows successful `✓ Compiled` entries after my files were added.
