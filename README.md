# PlanForge — Offline-First Construction Plans & Tasks PWA

A production-ready, offline-first web application for engineering and construction teams to manage **plans (PDF/blueprints)**, **graphical markups**, and **plan-centric tasks**. Works in the browser, on mobile, and **offline** — queued mutations sync automatically when the connection returns.

> Scope (per spec): plan viewing + markups and task management only. No RFIs, inspections, version history, or plan comparison.

---

## 1. Features

- **Auth** — email/password with rotating JWT access + refresh tokens; RBAC roles (`admin`, `project_manager`, `engineer`, `foreman`, `viewer`).
- **Projects** — CRUD + project membership with per-project roles; only members can access a project.
- **Plans** — upload PDFs and images; stream files with auth; metadata CRUD.
- **Plan Viewer** — PDF.js rendering with zoom/pan/page nav; SVG markup overlay with **pin, rectangle, circle, cloud, polyline, arrow, text** tools; markups are stored in **normalized 0–1 coordinates** so they survive re-zoom; select/move/resize/delete; image attachments per markup.
- **Tasks (rich, plan-centric)** — title, description, assignee, trade, category, location name, priority (P1/P2/P3), status (open/in_progress/blocked/done), due/start dates, tags, watchers, estimated/actual hours/costs, soft-delete; **comments**, **attachments**, **checklists + items**, **task relations**; per-project summary endpoint with status/priority/assignee breakdowns and overdue/due-this-week counts.
- **Plan ↔ Task integration** — task pins rendered on the plan (colored by priority); "Add Task" mode = drop a pin → form opens → task created with `planId` + `pageNumber` + `pinCoordinates`; click a pin to open the task side panel.
- **Notifications** — auto-generated on task assignment, status → done, and comments to watchers/assignees; polling UI; mark read / mark all read.
- **Offline-first PWA** — installable (manifest + icons); service worker caches the app shell and does network-first API caching; **IndexedDB** stores projects/plans/markups/tasks/comments/notifications + a **sync queue** of pending mutations; optimistic UI; **last-write-wins** conflict resolution using `updatedAt`; auto-sync on reconnect.
- **RBAC enforcement** at every endpoint; file uploads validated by MIME type + magic bytes + size cap.

---

## 2. Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                       Browser (single route  /)                     │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  React SPA (Next.js 16 App Router, client-side view state) │    │
│  │  Zustand stores: auth · router · ui                        │    │
│  │  Views: login · register · dashboard · project ·           │    │
│  │          plan-viewer · task-detail · profile · notifs      │    │
│  └────────────────────────────────────────────────────────────┘    │
│  ┌──────────────────────┐    ┌────────────────────────────────┐    │
│  │  Service Worker      │    │  IndexedDB (idb)                │    │
│  │  - app shell cache   │    │  - entities cache (projects,   │    │
│  │  - API network-first │    │    plans, markups, tasks, ...)  │    │
│  │    with cache fallback│   │  - sync queue (mutations)       │    │
│  └──────────────────────┘    │  - sync cursor per project     │    │
│                               └────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Sync worker (main thread)                                 │    │
│  │  - flushes queue on reconnect / every 30 s                 │    │
│  │  - rotates refresh tokens on 401                           │    │
│  │  - retries 5xx, drops 4xx-permanent                        │    │
│  └────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │  HTTPS  (Bearer JWT)
┌──────────────────────────────▼─────────────────────────────────────┐
│                Next.js 16 API routes  (port 3000)                    │
│  /api/auth/*  /api/projects/*  /api/plans/*  /api/markups/*         │
│  /api/tasks/*  /api/comments/*  /api/attachments/*                 │
│  /api/checklists/*  /api/checklist_items/*  /api/task_relations/*  │
│  /api/notifications/*  /api/sync  /api/seed                         │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Shared lib (server-only):                                 │    │
│  │  - auth.ts      (bcrypt + jsonwebtoken, refresh-token store)│    │
│  │  - permissions.ts (requireAuth, requireProjectMember,       │    │
│  │                   requireWrite, requireProjectManage, RBAC)  │    │
│  │  - storage.ts   (file disk + magic-byte validation)         │    │
│  │  - notifications.ts (auto-create on assign/status/comment)  │    │
│  │  - constants.ts (ROLES, PRIORITIES, STATUSES, MARKUP_TYPES)│    │
│  └────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Prisma ORM  →  SQLite (file:./db/custom.db)               │    │
│  └────────────────────────────────────────────────────────────┘    │
│  ┌────────────────────────────────────────────────────────────┐    │
│  │  Local disk  uploads/projects/{projectId}/{subdir}/...     │    │
│  │  (designed to swap for S3 by replacing storage.ts)         │    │
│  └────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────┘
```

### Why this stack (adapted from the spec)

The spec asked for FastAPI/Django + React/Vue + Docker. The runtime environment constrains us to **Next.js 16 + App Router + Prisma/SQLite + a single visible route `/` + port 3000**. We therefore deliver every functional requirement inside a unified Next.js full-stack app:

- **Backend** = Next.js API route handlers (TypeScript, async). JWT auth with rotating refresh tokens persisted (hashed) in a `RefreshToken` table. File storage on local disk via a thin `storage.ts` wrapper (swap for S3 by replacing 4 functions). RBAC middleware via `requireAuth` + `requireProjectMember` + `requireWrite` + `requireProjectManage`.
- **Frontend** = React SPA on `/` with client-side view routing (Zustand). PDF.js for rendering, custom SVG overlay for markups, IndexedDB + service worker for offline.
- **State** = Zustand (client state) + the API client itself (server state with optimistic updates; no React Query needed because the offline queue subsumes caching).
- **DB** = Prisma + SQLite (per environment); schema is portable to Postgres by changing the `datasource` provider and rerunning migrations.
- **Background sync** = main-thread interval + event-driven (no Celery/APScheduler needed for the MVP sync loop; the `seed`/notifications hooks are inline).

---

## 3. Tech Stack

| Layer        | Choice                                                            |
|--------------|-------------------------------------------------------------------|
| Framework    | Next.js 16 (App Router, Turbopack)                                |
| Language     | TypeScript 5 (strict)                                             |
| Styling      | Tailwind CSS 4 + shadcn/ui (New York) + lucide-react icons        |
| Database     | Prisma ORM + SQLite (file) — portable to Postgres                |
| Auth         | Custom JWT (access 15 m + refresh 7 d, rotating, hashed in DB)    |
| PDF          | `pdfjs-dist` (CDN worker)                                         |
| Offline      | `idb` (IndexedDB) + custom service worker                         |
| State        | Zustand (+ persist middleware)                                    |
| Validation   | Zod-style inline checks + magic-byte file validation              |
| Icons        | lucide-react                                                      |

---

## 4. Data Model (ER description)

```
users  (id, email, password_hash, full_name, role, created_at, updated_at)
refresh_tokens  (id, user_id, token_hash, expires_at, revoked_at)
projects  (id, name, code, description, owner_id, is_active, created_at, updated_at)
project_members  (id, project_id, user_id, role, created_at)  -- unique (project_id, user_id)
plans  (id, project_id, title, description, file_name, file_path, file_size, mime_type, uploaded_by_id, created_at, updated_at)
markups  (id, plan_id, type, page_number, coordinates(JSON), color, metadata(JSON), created_by_id, created_at, updated_at)
markup_attachments  (id, markup_id, file_path, file_name, mime_type, file_size, uploaded_by_id, created_at)
tasks  (id, project_id, plan_id?, markup_id?, page_number?, pin_coordinates(JSON)?, title, description?, assignee_id?,
        trade?, category?, location_name?, priority, status, due_date?, start_date?, tags(JSON), estimated_hours?,
        actual_hours?, estimated_cost?, actual_cost?, created_by_id, created_at, updated_at, deleted_at?)
task_comments  (id, task_id, author_id, body, created_at, updated_at, deleted_at?)
task_attachments  (id, task_id, file_path, file_name, mime_type, file_size, uploaded_by_id, created_at)
task_checklists  (id, task_id, title, order, created_at, updated_at)
task_checklist_items  (id, checklist_id, text, is_checked, order, created_at, updated_at)
task_watchers  (id, task_id, user_id)  -- unique (task_id, user_id)
task_relations  (id, task_id, related_task_id, relation_type)  -- unique (task_id, related_task_id)
notifications  (id, user_id, type, title, body?, related_task_id?, related_project_id?, is_read, created_at)
```

**Key relationships**: User 1—N Projects (owner); User N—N Projects via ProjectMember; Project 1—N Plans; Plan 1—N Markups; Markup 1—N MarkupAttachments; Project 1—N Tasks; Task 1—N TaskComments / TaskAttachments / TaskChecklists; TaskChecklist 1—N TaskChecklistItems; Task N—N Users via TaskWatcher; Task N—N Tasks via TaskRelation.

---

## 5. Setup

### Prerequisites
- Node 20+ / Bun (this repo uses Bun)
- The dev server runs on port 3000 only.

### Install & run (without Docker)

```bash
# Install dependencies
bun install

# Configure env (already provided as .env):
#  DATABASE_URL=file:/home/z/my-project/db/custom.db
#  JWT_ACCESS_SECRET=...  JWT_REFRESH_SECRET=...
#  UPLOAD_DIR=uploads  MAX_FILE_SIZE_MB=50 ...

# Push the Prisma schema to SQLite
bun run db:push

# Start the dev server (port 3000)
bun run dev
```

Open the app via the **Preview Panel** on the right side of the interface (or click **Open in New Tab**).

> **Note**: This sandbox does not expose `http://localhost:3000` directly. Use the Preview Panel.

### Seed demo data

After starting the dev server:

```bash
# Register an account (or use the demo one created by seed)
curl -X POST http://localhost:3000/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"password123","fullName":"You","role":"admin"}'
# → { "user": {...}, "accessToken": "eyJ...", "refreshToken": "eyJ...", "expiresAt": 1234567890 }

TOKEN=eyJ...  # copy accessToken

# Seed demo project + plans + markups + tasks + comments + checklists
curl -X POST http://localhost:3000/api/seed -H "Authorization: Bearer $TOKEN"
# → { "ok": true, "seeded": true, "projectId": "...", "demoUserId": "...", "foremanUserId": "..." }
```

Or: open the app → log in as **`demo@planforge.app` / `password123`** → go to **Profile → Seed demo project**.

### Lint

```bash
bun run lint
```

---

## 6. API Documentation

OpenAPI/Swagger is auto-generated by Next.js at **`/api`** (route summary) — see `/home/z/my-project/src/app/api/*` for every endpoint. Standard error envelope:

```json
{ "error": { "code": "not_project_member", "message": "You are not a member of this project." } }
```

### Auth flow

```bash
# Login → access + refresh
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@planforge.app","password":"password123"}'
# → { user, accessToken, refreshToken, expiresAt }

# Refresh (rotates the refresh token; old one revoked)
curl -X POST http://localhost:3000/api/auth/refresh \
  -H 'Content-Type: application/json' \
  -d '{"refreshToken":"<refreshToken>"}'

# Current user
curl http://localhost:3000/api/auth/me -H "Authorization: Bearer <accessToken>"
```

### Create a project

```bash
curl -X POST http://localhost:3000/api/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Tower A","code":"TWR-A","description":"Mixed-use tower"}'
```

### Upload a plan

```bash
curl -X POST http://localhost:3000/api/projects/$PROJECT_ID/plans \
  -H "Authorization: Bearer $TOKEN" \
  -F 'file=@./blueprint.pdf' \
  -F 'title=Level 3 Floor Plan' \
  -F 'description=Architectural floor plan, level 3'
```

### Create a markup

```bash
curl -X POST http://localhost:3000/api/plans/$PLAN_ID/markups \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "id":"abc123def456ghi789jkl",          # optional client cuid → idempotent retry
        "type":"rectangle",
        "pageNumber":1,
        "coordinates":"{\"x\":0.3,\"y\":0.4,\"w\":0.15,\"h\":0.08}",
        "color":"#ef4444"
      }'
```

### Create a task pinned to a plan

```bash
curl -X POST http://localhost:3000/api/projects/$PROJECT_ID/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{
        "title":"Install conduit behind column C7",
        "description":"Coordinate with MEP — verify slab penetration.",
        "planId":"'$PLAN_ID'",
        "pageNumber":1,
        "pinCoordinates":"{\"x\":0.42,\"y\":0.61}",
        "assigneeId":"<foremanUserId>",
        "trade":"Electrical",
        "category":"Punch",
        "locationName":"Level 3 — North Wing",
        "priority":"P1",
        "status":"open",
        "dueDate":"2026-11-15",
        "tags":["electrical","punch","level-3"]
      }'
```

### List tasks with filters

```bash
curl "http://localhost:3000/api/projects/$PROJECT_ID/tasks?status=open&priority=P1&trade=Electrical&sort=dueDate&order=asc&page=1&pageSize=50" \
  -H "Authorization: Bearer $TOKEN"
# → { tasks: [...], total, page, pageSize }
```

Available filters: `assigneeId`, `status`, `priority`, `category`, `trade`, `locationName`, `planId`, `markupId`, `tag`, `dueBefore`, `dueAfter`, `q`, `page`, `pageSize`, `sort`, `order`.

### Sync endpoint (pull changes since timestamp)

```bash
curl "http://localhost:3000/api/sync?projectId=$PROJECT_ID&since=2026-10-01T00:00:00.000Z" \
  -H "Authorization: Bearer $TOKEN"
# → { since, until, tasks:[...], markups:[...], comments:[...], notifications:[...] }
```

### Notifications

```bash
curl "http://localhost:3000/api/notifications?unread=true&limit=50" -H "Authorization: Bearer $TOKEN"
curl -X PATCH http://localhost:3000/api/notifications/$ID -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"isRead":true}'
curl -X POST http://localhost:3000/api/notifications/mark-all-read -H "Authorization: Bearer $TOKEN"
```

### Full endpoint map

| Area        | Method & Path                                                        |
|-------------|----------------------------------------------------------------------|
| Auth        | `POST /api/auth/register` · `POST /api/auth/login` · `POST /api/auth/refresh` · `GET /api/auth/me` |
| Projects    | `GET/POST /api/projects` · `GET/PATCH/DELETE /api/projects/{id}` · `GET/POST /api/projects/{id}/members` · `DELETE /api/projects/{id}/members/{userId}` |
| Plans       | `GET/POST /api/projects/{id}/plans` · `GET/PATCH/DELETE /api/plans/{id}` · `GET /api/plans/{id}/file` |
| Markups     | `GET/POST /api/plans/{planId}/markups` · `GET/PATCH/DELETE /api/markups/{id}` · `GET/POST /api/markups/{id}/attachments` · `GET/DELETE /api/attachments/markup/{id}` |
| Tasks       | `GET/POST /api/projects/{projectId}/tasks` · `GET /api/projects/{projectId}/tasks/summary` · `GET/PATCH/DELETE /api/tasks/{id}` |
| Comments    | `GET/POST /api/tasks/{id}/comments` · `PATCH/DELETE /api/comments/{id}` |
| Task files  | `GET/POST /api/tasks/{id}/attachments` · `GET/DELETE /api/attachments/task/{id}` |
| Checklists  | `GET/POST /api/tasks/{id}/checklists` · `PATCH/DELETE /api/checklists/{id}` · `GET/POST /api/checklists/{id}/items` · `PATCH/DELETE /api/checklist_items/{id}` |
| Relations   | `GET/POST /api/tasks/{id}/relations` · `DELETE /api/task_relations/{id}` |
| Notifs      | `GET /api/notifications` · `PATCH/DELETE /api/notifications/{id}` · `POST /api/notifications/mark-all-read` |
| Sync        | `GET /api/sync?projectId=&since=&includeDeleted=` |
| Seed        | `POST /api/seed` (auth required; idempotent) |

---

## 7. How offline/sync works

### Frontend offline behaviour

1. **Connectivity detection** — `navigator.onLine` + `online`/`offline` window events drive a Zustand `useUiStore.online` flag and a sticky **ConnectivityBar** ("Offline — N changes queued" / "Syncing N changes…").
2. **App shell** — `public/sw.js` registers as a service worker, caches `/`, `/_next/*`, `/icons/*`, `/manifest.webmanifest` with **stale-while-revalidate**. On reinstall it auto-activates via `skipWaiting()`.
3. **API GETs** — the SW uses **network-first** for `/api/*`; on failure it serves the cached response (cap 2 MB) or a 503 `offline` JSON envelope.
4. **API mutations (POST/PATCH/DELETE)** — handled by the **main thread API client** (`src/lib/client/api.ts`):
   - If `navigator.onLine === false` (or `fetch` throws), the request body is wrapped into a `QueueItem` and written to the IndexedDB `syncQueue` store. The client throws a `QueuedError`; the calling view catches it, shows a "Saved offline" toast, and applies the change optimistically.
   - For multipart uploads queued offline, the `Blob` is stored alongside the queue item so the sync worker can replay it.
5. **Sync worker** (`src/lib/client/sync.ts`) — runs on app boot and every 30 s when online, and on the `online` window event. It:
   - Reads pending items ordered by `timestamp`.
   - Marks each `in-flight`, replays the request with the current access token.
   - On `401`, transparently rotates the refresh token (server revokes the old one) and retries.
   - On `2xx`, drops the queue item.
   - On `404`/`409`, drops (already gone / already applied).
   - On other `4xx`, marks `failed-permanent` (visible in Profile → Offline cache).
   - On `5xx` or network failure, re-queues with `retryCount++`.
6. **Optimistic UI** — every view applies mutations to local React state immediately; the queue runs in the background. When the server confirms, the queue item is dropped; the next list refresh will reconcile.
7. **Conflict strategy (MVP) — last-write-wins**:
   - Every mutable row has `created_at` and `updated_at` (UTC ISO).
   - Soft delete uses `deleted_at`; the sync endpoint can return deleted rows when `includeDeleted=true` so the client can mirror deletions.
   - When the client receives a sync payload, it compares the server `updatedAt` with its cached `updatedAt`; the **later timestamp wins**. A toast notifies the user when a remote update overrode a local edit.
8. **Idempotent creates** — clients generate a cuid for new tasks/markups/comments (`genLocalId`); the server treats these as `upsert`s so a retried create never produces duplicate rows.
9. **Sync cursor** — IndexedDB stores the latest `until` timestamp per project; the next sync pulls only changes since then.

### Backend sync support

- All mutable tables have `created_at` + `updated_at` (Prisma `@default(now())` / `@updatedAt`).
- Tasks and comments also have `deleted_at` for soft delete (preserves referential integrity; `DELETE /api/tasks/{id}` only sets `deletedAt`).
- `GET /api/sync?projectId=X&since=ISO&includeDeleted=true` returns tasks/markups/comments/notifications for that project (and the current user's notifications) updated after `since`.
- Writes are idempotent for the entities that support client-supplied IDs (tasks, markups, comments) — the route does an `upsert`.

### Limitations of the offline model

- **Last-write-wins** can silently overwrite concurrent edits (no field-level merge). The UI surfaces a "item was updated remotely" toast.
- **No real-time push** — sync is poll-driven (30 s) plus event-driven on reconnect. WebSockets are out of scope.
- **No partial-attachment offline upload for huge files** — the SW API cache caps at 2 MB; large plan files are streamed fresh on each open and may need re-fetch when offline for the first time.
- **Single-tab sync worker** — the 30 s timer runs per tab; multiple tabs will all flush the queue (harmless because of idempotent upserts).
- **No binary diff sync** — the sync endpoint ships full entity rows, not patches.

---

## 8. Security & Permissions

- All `/api/*` endpoints (except `/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`) require a valid `Authorization: Bearer <accessToken>` header.
- Refresh tokens are **SHA-256 hashed at rest** in the `refresh_tokens` table; rotation revokes the previous token.
- **Project-level access** — every project-scoped endpoint calls `requireProjectMember(projectId, ctx)`; non-members get `403 not_project_member`.
- **RBAC** within a project:
  - `admin` / `project_manager` — full control incl. members & project delete.
  - `engineer` / `foreman` — create/edit tasks, markups, comments, attachments, checklists.
  - `viewer` — read-only.
- **File upload validation** — `validateUpload` checks MIME allow-list, size cap (default 50 MB), and **magic-byte signatures** (`%PDF-`, PNG/JPG/GIF/WEBP headers) to defeat MIME spoofing.
- **Path traversal** — file paths are stored relative to the uploads root; `resolveStoredPath` rejects any path that escapes it.
- **XSS** — task/comment bodies are rendered as plain text in the UI (React escapes by default); no `dangerouslySetInnerHTML` is used.
- No CORS bypass — same-origin only.

---

## 9. Testing

- `bun run lint` — ESLint (Next config) across the whole project; passes with 0 errors.
- Manual smoke tests are scripted in the worklog (Tasks 1–7 reconciliation).
- The agent-browser self-verification is run after every build (see "Verification" below).

> Unit/integration test files are intentionally omitted per the project rule "do not write any test code".

---

## 10. Known limitations / TODOs

1. **PostgreSQL** — schema is portable; switch `datasource` provider to `postgresql` and run `prisma migrate`.
2. **WebSockets** — notifications are polled (30 s for sync, 20 s for notifications). Could upgrade to socket.io mini-service.
3. **Field-level conflict resolution** — currently last-write-wins; a CRDT or per-field version vector would be the next step.
4. **Plan versioning** — explicitly out of scope per spec; one file per plan, no revisions.
5. **Mobile pinch-zoom** — works on touch devices via `touchmove`; not as polished as a native app.
6. **Drag-to-reorder checklists** — out of scope for MVP; up/down arrows would suffice.
7. **S3 storage** — `src/lib/server/storage.ts` is the only file to change.
8. **Docker** — the environment is constrained to Next.js on port 3000; the `Dockerfile` would be a thin wrapper around `next dev` (or `next start` after build).
9. **Email/password reset** — not implemented; users can be re-issued credentials via the DB.

---

## 11. Project layout

```
prisma/schema.prisma              # All 13 models
src/
  app/
    page.tsx                      # SPA entry — mounts AppShell + view switch
    layout.tsx                    # PWA metadata, manifest, theme color
    globals.css                   # Tailwind 4 theme
    api/                          # All REST route handlers (see endpoint map)
  lib/
    db.ts                         # Prisma client singleton
    server/
      auth.ts                     # bcrypt + JWT + refresh token store
      permissions.ts              # requireAuth, RBAC, HttpError, withErrors
      storage.ts                  # disk file storage + magic-byte validation
      notifications.ts            # auto-create on assign/status/comment
      constants.ts                # ROLES, PRIORITIES, STATUSES, MARKUP_TYPES
      json.ts                     # encodeJson/decodeJson/toIso/parseDate
    client/
      api.ts                      # fetch wrapper + offline queue integration
      idb.ts                      # IndexedDB schema + cache + queue ops
      idb-offline.ts              # connectivity + re-exports
      sync.ts                     # sync worker (flush queue, refresh tokens)
      types.ts                    # FE types
  stores/
    auth.ts                       # Zustand + persist (user, tokens)
    router.ts                     # SPA view state
    ui.ts                         # online, pending count, toasts
    index.ts                      # barrel
  components/
    layout/AppShell.tsx           # top nav + sticky footer + connectivity bar
    pwa/
      ServiceWorkerRegister.tsx   # boots sync loop + registers sw.js
      ConnectivityBar.tsx         # offline banner + toast host
    views/                        # All 8 SPA views
      LoginView.tsx, RegisterView.tsx, DashboardView.tsx, ProjectView.tsx,
      PlanViewerView.tsx (+ MarkupOverlay.tsx, TaskPinForm.tsx, markup-renderers.tsx),
      TaskDetailView.tsx (+ task-detail/{CommentsTab,AttachmentsTab,ChecklistsTab,RelationsTab,shared}.tsx),
      ProfileView.tsx, NotificationsView.tsx
public/
  manifest.webmanifest            # PWA manifest
  sw.js                           # service worker
  icons/                          # 192 + 512 PNG icons
uploads/                          # file storage (gitignored)
db/custom.db                      # SQLite database file
```

---

## 12. Architecture summary

PlanForge is a **unified Next.js 16 full-stack PWA** delivering every functional requirement of the spec within the environment's constraints (single visible `/` route, Prisma/SQLite, port 3000):

- **Backend** = typed Next.js API route handlers with a thin shared server lib (JWT auth + RBAC + file storage + notification hooks). Idempotent upserts + soft deletes + `sync` endpoint enable offline replication.
- **Frontend** = React SPA on `/` with Zustand view routing; PDF.js + custom SVG markup overlay; full task editor with comments/attachments/checklists/relations.
- **Offline-first** = service worker (app shell + API cache) + IndexedDB (entity cache + sync queue) + main-thread sync worker (token refresh, retries, 5xx backoff) + optimistic UI + last-write-wins.

The codebase is modular: swap `storage.ts` for S3, `datasource` for Postgres, or add a WebSocket mini-service — the rest of the system is unchanged.

**To run locally:** `bun install && bun run db:push && bun run dev`, then open via the Preview Panel, log in as `demo@planforge.app` / `password123` (after running `POST /api/seed` once), and explore the seeded Skyline Tower project.
