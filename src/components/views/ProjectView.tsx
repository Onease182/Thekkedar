'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format, formatDistanceToNow, parseISO, isPast } from 'date-fns'
import {
  ArrowLeft,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Users as UsersIcon,
  Calendar,
  FileText,
  Image as ImageIcon,
  Upload,
  Loader2,
  AlertCircle,
  WifiOff,
  Search,
  X,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  Filter,
  Ban,
  PlayCircle,
  CircleDot,
  CheckCircle2,
  Clock,
  CalendarClock,
  LayoutGrid,
  List as ListIcon,
  User as UserIcon,
  Tag,
  MapPin,
} from 'lucide-react'
import { useRouterStore, useUiStore, useAuthStore } from '@/stores'
import {
  apiGet,
  apiPost,
  apiPatch,
  apiDelete,
  isQueuedError,
  ApiError,
} from '@/lib/client/api'
import {
  getCachedPlansByProject,
  getCachedTasksByProject,
  cachePlans,
  cacheTasks,
  genLocalId,
} from '@/lib/client/idb-offline'
import type {
  ProjectFE,
  ProjectMemberFE,
  PlanFE,
  TaskFE,
  TaskSummaryFE,
} from '@/lib/client/types'
import type { Role, TaskPriority, TaskStatus } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface ProjectDetailFE extends ProjectFE {
  memberCount?: number
  taskCounts?: { total?: number; byStatus?: Record<string, number> }
}

interface ProjectApiResponse extends ProjectFE {
  memberCount: number
  taskCounts: { total: number; byStatus: Record<string, number> }
}

const STATUS_META: Record<
  TaskStatus,
  { label: string; badge: string; dot: string; text: string; icon: typeof CircleDot }
> = {
  open: {
    label: 'Open',
    badge: 'bg-zinc-100 text-zinc-800 border-zinc-200',
    dot: 'bg-zinc-400',
    text: 'text-zinc-700',
    icon: CircleDot,
  },
  in_progress: {
    label: 'In progress',
    badge: 'bg-blue-100 text-blue-800 border-blue-200',
    dot: 'bg-blue-400',
    text: 'text-blue-700',
    icon: PlayCircle,
  },
  blocked: {
    label: 'Blocked',
    badge: 'bg-red-100 text-red-800 border-red-200',
    dot: 'bg-red-400',
    text: 'text-red-700',
    icon: Ban,
  },
  done: {
    label: 'Done',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    dot: 'bg-emerald-500',
    text: 'text-emerald-700',
    icon: CheckCircle2,
  },
}

const PRIORITY_META: Record<TaskPriority, { label: string; badge: string }> = {
  P1: { label: 'P1', badge: 'bg-red-100 text-red-800 border-red-200' },
  P2: { label: 'P2', badge: 'bg-amber-100 text-amber-800 border-amber-200' },
  P3: { label: 'P3', badge: 'bg-zinc-100 text-zinc-700 border-zinc-200' },
}

const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  engineer: 'Engineer',
  foreman: 'Foreman',
  viewer: 'Viewer',
}

const ROLE_BADGE: Record<Role, string> = {
  admin: 'bg-zinc-900 text-white border-zinc-900',
  project_manager: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  engineer: 'bg-sky-100 text-sky-800 border-sky-200',
  foreman: 'bg-amber-100 text-amber-800 border-amber-200',
  viewer: 'bg-zinc-100 text-zinc-700 border-zinc-200',
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function initials(name: string): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), 'MMM d, yyyy')
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return format(parseISO(iso), "MMM d, yyyy 'at' h:mm a")
  } catch {
    return iso
  }
}

function fmtDateInput(iso: string | null): string {
  if (!iso) return ''
  try {
    return format(parseISO(iso), 'yyyy-MM-dd')
  } catch {
    return ''
  }
}

export function ProjectView() {
  const projectId = useRouterStore((s) => s.projectId)
  const navigate = useRouterStore((s) => s.navigate)
  const back = useRouterStore((s) => s.back)
  const showToast = useUiStore((s) => s.showToast)
  const online = useUiStore((s) => s.online)
  const user = useAuthStore((s) => s.user)

  const [tab, setTab] = useState<'overview' | 'plans' | 'tasks'>('overview')
  const [project, setProject] = useState<ProjectDetailFE | null>(null)
  const [members, setMembers] = useState<ProjectMemberFE[]>([])
  const [plans, setPlans] = useState<PlanFE[]>([])
  const [tasks, setTasks] = useState<TaskFE[]>([])
  const [taskTotal, setTaskTotal] = useState(0)
  const [taskPage, setTaskPage] = useState(1)
  const [pageSize] = useState(50)
  const [summary, setSummary] = useState<TaskSummaryFE | null>(null)
  const [usingCache, setUsingCache] = useState(false)

  // Filters
  const [q, setQ] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [assigneeFilter, setAssigneeFilter] = useState<string>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [tradeFilter, setTradeFilter] = useState('')
  const [sortBy, setSortBy] = useState<'title' | 'dueDate' | 'priority' | 'status' | 'createdAt' | 'updatedAt'>('createdAt')
  const [order, setOrder] = useState<'asc' | 'desc'>('desc')

  // Loading flags
  const [loadingProject, setLoadingProject] = useState(true)
  const [loadingMembers, setLoadingMembers] = useState(true)
  const [loadingPlans, setLoadingPlans] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingSummary, setLoadingSummary] = useState(false)

  // Dialog state
  const [editProjectOpen, setEditProjectOpen] = useState(false)
  const [membersSheetOpen, setMembersSheetOpen] = useState(false)
  const [deleteProjectOpen, setDeleteProjectOpen] = useState(false)
  const [uploadPlanOpen, setUploadPlanOpen] = useState(false)
  const [editPlanTarget, setEditPlanTarget] = useState<PlanFE | null>(null)
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [taskRowMenuFor, setTaskRowMenuFor] = useState<string | null>(null)
  void taskRowMenuFor

  // ─────────────────────────── Permission check ───────────────────────────
  const canManage = useMemo(() => {
    if (!user) return false
    if (user.role === 'admin') return true
    if (project?.ownerId === user.id) return true
    const myMembership = members.find((m) => m.userId === user.id)
    if (myMembership && (myMembership.role === 'admin' || myMembership.role === 'project_manager')) {
      return true
    }
    return false
  }, [user, project, members])

  // ─────────────────────────── Loaders ───────────────────────────
  const loadProject = useCallback(async () => {
    if (!projectId) return
    setLoadingProject(true)
    setUsingCache(false)
    try {
      const data = await apiGet<ProjectApiResponse>(`/projects/${projectId}`)
      setProject(data)
    } catch (e) {
      // Try cached projects list to find a fallback
      try {
        const { getCachedProjects } = await import('@/lib/client/idb-offline')
        const cached = await getCachedProjects()
        const found = cached.find((p) => p.id === projectId)
        if (found) {
          setProject(found as ProjectDetailFE)
          setUsingCache(true)
        } else {
          showToast({
            title: 'Project not found',
            description: e instanceof Error ? e.message : 'Unknown error',
            variant: 'error',
          })
          navigate('dashboard')
        }
      } catch {
        navigate('dashboard')
      }
    } finally {
      setLoadingProject(false)
    }
  }, [projectId, navigate, showToast])

  const loadMembers = useCallback(async () => {
    if (!projectId) return
    setLoadingMembers(true)
    try {
      const data = await apiGet<{ members: ProjectMemberFE[] }>(`/projects/${projectId}/members`)
      setMembers(data.members)
    } catch (e) {
      if (online) {
        showToast({
          title: 'Failed to load members',
          description: e instanceof Error ? e.message : undefined,
          variant: 'error',
        })
      }
    } finally {
      setLoadingMembers(false)
    }
  }, [projectId, online, showToast])

  const loadPlans = useCallback(async () => {
    if (!projectId) return
    setLoadingPlans(true)
    try {
      const data = await apiGet<{ plans: PlanFE[] }>(`/projects/${projectId}/plans`)
      setPlans(data.plans)
      void cachePlans(data.plans).catch(() => undefined)
    } catch (e) {
      try {
        const cached = await getCachedPlansByProject(projectId)
        setPlans(cached)
        setUsingCache(true)
        if (cached.length === 0 && online) {
          showToast({
            title: 'Failed to load plans',
            description: e instanceof Error ? e.message : undefined,
            variant: 'error',
          })
        }
      } catch {
        // ignore
      }
    } finally {
      setLoadingPlans(false)
    }
  }, [projectId, online, showToast])

  const loadSummary = useCallback(async () => {
    if (!projectId) return
    setLoadingSummary(true)
    try {
      const data = await apiGet<TaskSummaryFE>(`/projects/${projectId}/tasks/summary`)
      setSummary(data)
    } catch {
      // Non-fatal — overview tab will just show fewer stats
    } finally {
      setLoadingSummary(false)
    }
  }, [projectId])

  const loadTasks = useCallback(async () => {
    if (!projectId) return
    setLoadingTasks(true)
    const params = new URLSearchParams()
    params.set('page', String(taskPage))
    params.set('pageSize', String(pageSize))
    params.set('sort', sortBy)
    params.set('order', order)
    if (q.trim()) params.set('q', q.trim())
    if (statusFilter !== 'all') params.set('status', statusFilter)
    if (priorityFilter !== 'all') params.set('priority', priorityFilter)
    if (assigneeFilter !== 'all') params.set('assigneeId', assigneeFilter)
    if (categoryFilter.trim()) params.set('category', categoryFilter.trim())
    if (tradeFilter.trim()) params.set('trade', tradeFilter.trim())
    try {
      const data = await apiGet<{ tasks: TaskFE[]; total: number; page: number; pageSize: number }>(
        `/projects/${projectId}/tasks?${params.toString()}`,
      )
      setTasks(data.tasks)
      setTaskTotal(data.total)
      void cacheTasks(data.tasks).catch(() => undefined)
    } catch (e) {
      try {
        const cached = await getCachedTasksByProject(projectId)
        // Apply filters locally
        const filtered = cached.filter((t) => {
          if (statusFilter !== 'all' && t.status !== statusFilter) return false
          if (priorityFilter !== 'all' && t.priority !== priorityFilter) return false
          if (assigneeFilter !== 'all') {
            if (assigneeFilter === '__unassigned__') {
              if (t.assigneeId !== null) return false
            } else if (t.assigneeId !== assigneeFilter) return false
          }
          if (categoryFilter.trim() && t.category !== categoryFilter.trim()) return false
          if (tradeFilter.trim() && t.trade !== tradeFilter.trim()) return false
          if (q.trim() && !t.title.toLowerCase().includes(q.trim().toLowerCase())) return false
          return true
        })
        setTasks(filtered)
        setTaskTotal(filtered.length)
        setUsingCache(true)
        if (filtered.length === 0 && online) {
          showToast({
            title: 'Failed to load tasks',
            description: e instanceof Error ? e.message : undefined,
            variant: 'error',
          })
        }
      } catch {
        // ignore
      }
    } finally {
      setLoadingTasks(false)
    }
  }, [projectId, taskPage, pageSize, sortBy, order, q, statusFilter, priorityFilter, assigneeFilter, categoryFilter, tradeFilter, online, showToast])

  // ─────────────────────────── Effects ───────────────────────────
  useEffect(() => {
    void loadProject()
    void loadMembers()
  }, [loadProject, loadMembers])

  useEffect(() => {
    if (projectId) void loadSummary()
  }, [projectId, loadSummary])

  useEffect(() => {
    if (tab === 'plans' && projectId) void loadPlans()
  }, [tab, projectId, loadPlans])

  // Tasks re-fetch on filter/sort/page change
  useEffect(() => {
    if (tab === 'tasks' && projectId) void loadTasks()
  }, [tab, projectId, taskPage, sortBy, order, statusFilter, priorityFilter, assigneeFilter, categoryFilter, tradeFilter, loadTasks])

  // Debounce search input
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (tab !== 'tasks') return
    searchTimer.current = setTimeout(() => {
      setTaskPage(1)
      void loadTasks()
    }, 350)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
  }, [q, tab, loadTasks])

  // ─────────────────────────── Project actions ───────────────────────────
  const handleUpdateProject = useCallback(
    async (patch: { name?: string; code?: string; description?: string | null }) => {
      if (!projectId) return
      try {
        const updated = await apiPatch<ProjectFE>(`/projects/${projectId}`, patch)
        setProject((p) => (p ? { ...p, ...updated } : p))
        setEditProjectOpen(false)
        showToast({ title: 'Project updated', variant: 'success' })
      } catch (e) {
        if (isQueuedError(e)) {
          showToast({
            title: 'Saved offline',
            description: 'Will sync when you reconnect',
            variant: 'warning',
          })
          setEditProjectOpen(false)
        } else {
          const msg = e instanceof ApiError ? e.message : 'Failed to update'
          showToast({ title: 'Could not update project', description: msg, variant: 'error' })
        }
      }
    },
    [projectId, showToast],
  )

  const handleDeleteProject = useCallback(async () => {
    if (!projectId) return
    try {
      await apiDelete(`/projects/${projectId}`)
      showToast({ title: 'Project deleted', variant: 'success' })
      setDeleteProjectOpen(false)
      navigate('dashboard')
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({
          title: 'Queued for deletion',
          description: 'Will sync when you reconnect',
          variant: 'warning',
        })
        setDeleteProjectOpen(false)
        navigate('dashboard')
      } else {
        const msg = e instanceof ApiError ? e.message : 'Failed to delete'
        showToast({ title: 'Could not delete project', description: msg, variant: 'error' })
      }
    }
  }, [projectId, navigate, showToast])

  // ─────────────────────────── Member actions ───────────────────────────
  const handleAddMember = useCallback(
    async (userId: string, role: Role) => {
      if (!projectId || !userId.trim()) return
      try {
        await apiPost(`/projects/${projectId}/members`, { userId: userId.trim(), role })
        showToast({ title: 'Member added', variant: 'success' })
        await loadMembers()
      } catch (e) {
        if (isQueuedError(e)) {
          showToast({
            title: 'Saved offline',
            description: 'Will sync when you reconnect',
            variant: 'warning',
          })
        } else {
          const msg = e instanceof ApiError ? e.message : 'Failed to add member'
          showToast({ title: 'Could not add member', description: msg, variant: 'error' })
        }
      }
    },
    [projectId, loadMembers, showToast],
  )

  const handleRemoveMember = useCallback(
    async (userId: string) => {
      if (!projectId) return
      try {
        await apiDelete(`/projects/${projectId}/members/${userId}`)
        showToast({ title: 'Member removed', variant: 'success' })
        await loadMembers()
      } catch (e) {
        if (isQueuedError(e)) {
          showToast({
            title: 'Saved offline',
            description: 'Will sync when you reconnect',
            variant: 'warning',
          })
        } else {
          const msg = e instanceof ApiError ? e.message : 'Failed to remove'
          showToast({ title: 'Could not remove member', description: msg, variant: 'error' })
        }
      }
    },
    [projectId, loadMembers, showToast],
  )

  // ─────────────────────────── Plan actions ───────────────────────────
  const handleUploadPlan = useCallback(
    async (file: File, title: string, description: string) => {
      if (!projectId) return
      try {
        const data = await apiPost<{ plan: PlanFE }>(
          `/projects/${projectId}/plans`,
          { title, description: description || undefined },
          {
            multipart: {
              field: 'file',
              file,
              fileName: file.name,
              mimeType: file.type || 'application/octet-stream',
            },
          },
        )
        setPlans((prev) => [data.plan, ...prev])
        setUploadPlanOpen(false)
        showToast({ title: 'Plan uploaded', description: data.plan.title, variant: 'success' })
      } catch (e) {
        if (isQueuedError(e)) {
          showToast({
            title: 'Saved offline',
            description: 'Will upload when you reconnect',
            variant: 'warning',
          })
          setUploadPlanOpen(false)
        } else {
          const msg = e instanceof ApiError ? e.message : 'Failed to upload'
          showToast({ title: 'Could not upload plan', description: msg, variant: 'error' })
        }
      }
    },
    [projectId, showToast],
  )

  const handleUpdatePlan = useCallback(
    async (planId: string, patch: { title?: string; description?: string | null }) => {
      try {
        const updated = await apiPatch<PlanFE>(`/plans/${planId}`, patch)
        setPlans((prev) => prev.map((p) => (p.id === planId ? updated : p)))
        setEditPlanTarget(null)
        showToast({ title: 'Plan updated', variant: 'success' })
      } catch (e) {
        if (isQueuedError(e)) {
          showToast({
            title: 'Saved offline',
            description: 'Will sync when you reconnect',
            variant: 'warning',
          })
          setEditPlanTarget(null)
        } else {
          const msg = e instanceof ApiError ? e.message : 'Failed to update'
          showToast({ title: 'Could not update plan', description: msg, variant: 'error' })
        }
      }
    },
    [showToast],
  )

  const handleDeletePlan = useCallback(
    async (planId: string) => {
      try {
        await apiDelete(`/plans/${planId}`)
        setPlans((prev) => prev.filter((p) => p.id !== planId))
        showToast({ title: 'Plan deleted', variant: 'success' })
      } catch (e) {
        if (isQueuedError(e)) {
          showToast({
            title: 'Queued for deletion',
            description: 'Will sync when you reconnect',
            variant: 'warning',
          })
          setPlans((prev) => prev.filter((p) => p.id !== planId))
        } else {
          const msg = e instanceof ApiError ? e.message : 'Failed to delete'
          showToast({ title: 'Could not delete plan', description: msg, variant: 'error' })
        }
      }
    },
    [showToast],
  )

  // ─────────────────────────── Task actions ───────────────────────────
  const handleCreateTask = useCallback(
    async (incomingBody: Record<string, unknown>) => {
      if (!projectId) return
      // Inject a client-generated id so the backend's upsert is idempotent on offline retry.
      const body: Record<string, unknown> = { ...incomingBody }
      if (!body.id) body.id = genLocalId('t_')
      try {
        const created = await apiPost<TaskFE>(`/projects/${projectId}/tasks`, body)
        setTasks((prev) => [created, ...prev])
        setTaskTotal((n) => n + 1)
        setNewTaskOpen(false)
        showToast({ title: 'Task created', description: created.title, variant: 'success' })
        // Refresh summary
        void loadSummary()
      } catch (e) {
        if (isQueuedError(e)) {
          // Optimistic UI: build a local TaskFE so the user sees the new task immediately.
          // The server will assign the real row when the queue flushes; the local id matches
          // the body.id we sent so the upsert is idempotent on retry.
          const localId = (body.id as string) || genLocalId('t_')
          const now = new Date().toISOString()
          const optimisticTask: TaskFE = {
            id: localId,
            projectId: projectId!,
            planId: (body.planId as string) ?? null,
            markupId: (body.markupId as string) ?? null,
            pageNumber: (body.pageNumber as number) ?? null,
            pinCoordinates: (body.pinCoordinates as string) ?? null,
            title: (body.title as string) ?? '(Untitled)',
            description: (body.description as string) ?? null,
            assigneeId: (body.assigneeId as string) ?? null,
            assigneeName: null,
            trade: (body.trade as string) ?? null,
            category: (body.category as string) ?? null,
            locationName: (body.locationName as string) ?? null,
            priority: ((body.priority as string) || 'P2') as TaskFE['priority'],
            status: ((body.status as string) || 'open') as TaskFE['status'],
            dueDate: (body.dueDate as string) ?? null,
            startDate: (body.startDate as string) ?? null,
            tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
            estimatedHours: (body.estimatedHours as number) ?? null,
            actualHours: (body.actualHours as number) ?? null,
            estimatedCost: (body.estimatedCost as number) ?? null,
            actualCost: (body.actualCost as number) ?? null,
            createdById: useAuthStore.getState().user?.id ?? 'me',
            createdByName: useAuthStore.getState().user?.fullName ?? 'You',
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
            commentCount: 0,
            attachmentCount: 0,
          }
          setTasks((prev) => [optimisticTask, ...prev])
          setTaskTotal((n) => n + 1)
          setNewTaskOpen(false)
          showToast({
            title: 'Saved offline',
            description: 'Will sync when you reconnect',
            variant: 'warning',
          })
        } else {
          const msg = e instanceof ApiError ? e.message : 'Failed to create task'
          showToast({ title: 'Could not create task', description: msg, variant: 'error' })
        }
      }
    },
    [projectId, loadSummary, showToast],
  )

  const clearFilters = useCallback(() => {
    setQ('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setAssigneeFilter('all')
    setCategoryFilter('')
    setTradeFilter('')
    setSortBy('createdAt')
    setOrder('desc')
    setTaskPage(1)
  }, [])

  const totalPages = Math.max(1, Math.ceil(taskTotal / pageSize))

  // ─────────────────────────── Loading skeleton for header ───────────────────────────
  if (loadingProject && !project) {
    return (
      <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1">
        <div className="flex items-center gap-3 mb-6">
          <Skeleton className="h-9 w-9 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-7 w-1/3" />
            <Skeleton className="h-4 w-1/4" />
          </div>
        </div>
        <Skeleton className="h-9 w-full max-w-md mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1">
        <Card className="p-6 text-center">
          <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
          <p className="font-medium text-zinc-900">Project not available</p>
          <Button variant="outline" className="mt-4" onClick={() => navigate('dashboard')}>
            Back to projects
          </Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1 flex flex-col">
      {/* Header */}
      <header className="mb-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                back()
                // Safety: if back stack empty, ensure we go to dashboard
                if (useRouterStore.getState().view !== 'dashboard') navigate('dashboard')
              }}
              aria-label="Back"
              className="shrink-0"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold text-zinc-900 tracking-tight truncate">
                {project.name}
              </h1>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap text-xs text-zinc-500">
                <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5">
                  {project.code}
                </Badge>
                {!project.isActive && (
                  <Badge variant="outline" className="text-[10px] py-0 px-1.5 border-red-200 bg-red-50 text-red-700">
                    Inactive
                  </Badge>
                )}
                <span className="hidden sm:inline">
                  Created {formatDistanceToNow(parseISO(project.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <MoreVertical className="h-4 w-4" />
                  <span className="hidden sm:inline">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setEditProjectOpen(true)}>
                  <Pencil className="h-4 w-4" />
                  Edit project
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setMembersSheetOpen(true)}>
                  <UsersIcon className="h-4 w-4" />
                  Manage members
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setDeleteProjectOpen(true)}
                >
                  <Trash2 className="h-4 w-4" />
                  Delete project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {project.description && (
          <p className="mt-2 text-sm text-zinc-600 max-w-3xl">{project.description}</p>
        )}
      </header>

      {/* Offline banner */}
      {!online && (
        <div
          className="mb-4 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          <WifiOff className="h-4 w-4" />
          <span>
            {usingCache
              ? 'Offline — showing cached data.'
              : 'Offline — changes will sync when you reconnect.'}
          </span>
        </div>
      )}

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)} className="flex-1 flex flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="overview" className="gap-1.5">
            <LayoutGrid className="h-3.5 w-3.5" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="plans" className="gap-1.5">
            <FileText className="h-3.5 w-3.5" />
            Plans
            {plans.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {plans.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="tasks" className="gap-1.5">
            <ListIcon className="h-3.5 w-3.5" />
            Tasks
            {taskTotal > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5 py-0">
                {taskTotal}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─────────────────────────── Overview ─────────────────────────── */}
        <TabsContent value="overview" className="flex-1">
          <OverviewTab
            summary={summary}
            loadingSummary={loadingSummary}
            members={members}
            loadingMembers={loadingMembers}
            project={project}
            onOpenMembers={() => setMembersSheetOpen(true)}
          />
        </TabsContent>

        {/* ─────────────────────────── Plans ─────────────────────────── */}
        <TabsContent value="plans" className="flex-1">
          <PlansTab
            plans={plans}
            loading={loadingPlans}
            canManage={canManage}
            onUpload={() => setUploadPlanOpen(true)}
            onOpenViewer={(planId) => navigate('plan-viewer', { projectId, planId })}
            onEditPlan={(p) => setEditPlanTarget(p)}
            onDeletePlan={handleDeletePlan}
          />
        </TabsContent>

        {/* ─────────────────────────── Tasks ─────────────────────────── */}
        <TabsContent value="tasks" className="flex-1">
          <TasksTab
            tasks={tasks}
            loading={loadingTasks}
            total={taskTotal}
            page={taskPage}
            pageSize={pageSize}
            totalPages={totalPages}
            members={members}
            q={q}
            statusFilter={statusFilter}
            priorityFilter={priorityFilter}
            assigneeFilter={assigneeFilter}
            categoryFilter={categoryFilter}
            tradeFilter={tradeFilter}
            sortBy={sortBy}
            order={order}
            canManage={canManage}
            onQ={setQ}
            onStatus={setStatusFilter}
            onPriority={setPriorityFilter}
            onAssignee={setAssigneeFilter}
            onCategory={setCategoryFilter}
            onTrade={setTradeFilter}
            onSort={setSortBy}
            onOrder={(o) => setOrder(o)}
            onPage={(p) => setTaskPage(p)}
            onClear={clearFilters}
            onNewTask={() => setNewTaskOpen(true)}
            onOpenTask={(taskId) => navigate('task-detail', { projectId, taskId })}
          />
        </TabsContent>
      </Tabs>

      {/* Dialogs & Sheets */}
      {editProjectOpen && (
        <EditProjectDialog
          project={project}
          open={editProjectOpen}
          onOpenChange={setEditProjectOpen}
          onSubmit={handleUpdateProject}
        />
      )}
      <ManageMembersSheet
        open={membersSheetOpen}
        onOpenChange={setMembersSheetOpen}
        members={members}
        canManage={canManage}
        onAdd={handleAddMember}
        onRemove={handleRemoveMember}
      />
      <AlertDialog open={deleteProjectOpen} onOpenChange={setDeleteProjectOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this project?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove <strong>{project.name}</strong> ({project.code}) and all of its plans, tasks, markups, and members. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleDeleteProject()}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {uploadPlanOpen && (
        <UploadPlanDialog
          open={uploadPlanOpen}
          onOpenChange={setUploadPlanOpen}
          onSubmit={handleUploadPlan}
        />
      )}
      {editPlanTarget && (
        <EditPlanDialog
          plan={editPlanTarget}
          onOpenChange={(o) => !o && setEditPlanTarget(null)}
          onSubmit={(patch) => handleUpdatePlan(editPlanTarget.id, patch)}
        />
      )}
      {newTaskOpen && (
        <NewTaskDialog
          open={newTaskOpen}
          onOpenChange={setNewTaskOpen}
          members={members}
          onSubmit={handleCreateTask}
        />
      )}
    </div>
  )
}

// ─────────────────────────── Overview Tab ───────────────────────────

interface OverviewTabProps {
  summary: TaskSummaryFE | null
  loadingSummary: boolean
  members: ProjectMemberFE[]
  loadingMembers: boolean
  project: ProjectDetailFE
  onOpenMembers: () => void
}

function OverviewTab({
  summary,
  loadingSummary,
  members,
  loadingMembers,
  project,
  onOpenMembers,
}: OverviewTabProps) {
  const owner = members.find((m) => m.userId === project.ownerId)
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4">
      {/* Summary cards */}
      <div className="lg:col-span-2 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          <SummaryCard
            label="Total"
            value={summary?.total ?? project.taskCounts?.total ?? 0}
            icon={<ListIcon className="h-4 w-4" />}
            tone="zinc"
            loading={loadingSummary}
          />
          <SummaryCard
            label="Open"
            value={summary?.byStatus.open ?? project.taskCounts?.byStatus?.open ?? 0}
            icon={<CircleDot className="h-4 w-4" />}
            tone="zinc"
            loading={loadingSummary}
          />
          <SummaryCard
            label="In progress"
            value={summary?.byStatus.in_progress ?? project.taskCounts?.byStatus?.in_progress ?? 0}
            icon={<PlayCircle className="h-4 w-4" />}
            tone="blue"
            loading={loadingSummary}
          />
          <SummaryCard
            label="Blocked"
            value={summary?.byStatus.blocked ?? project.taskCounts?.byStatus?.blocked ?? 0}
            icon={<Ban className="h-4 w-4" />}
            tone="red"
            loading={loadingSummary}
          />
          <SummaryCard
            label="Done"
            value={summary?.byStatus.done ?? project.taskCounts?.byStatus?.done ?? 0}
            icon={<CheckCircle2 className="h-4 w-4" />}
            tone="emerald"
            loading={loadingSummary}
          />
          <SummaryCard
            label="Overdue"
            value={summary?.overdue ?? 0}
            icon={<Clock className="h-4 w-4" />}
            tone="red"
            loading={loadingSummary}
          />
          <SummaryCard
            label="Due this week"
            value={summary?.dueThisWeek ?? 0}
            icon={<CalendarClock className="h-4 w-4" />}
            tone="amber"
            loading={loadingSummary}
          />
          <SummaryCard
            label="Members"
            value={project.memberCount ?? members.length}
            icon={<UsersIcon className="h-4 w-4" />}
            tone="zinc"
            loading={loadingMembers}
          />
        </div>

        {/* Priority breakdown */}
        {summary && (summary.byPriority.P1 > 0 || summary.byPriority.P2 > 0 || summary.byPriority.P3 > 0) && (
          <Card className="p-0">
            <CardHeader>
              <CardTitle className="text-base">By priority</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-3 flex-wrap">
              {(['P1', 'P2', 'P3'] as TaskPriority[]).map((pr) => (
                <div
                  key={pr}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 ${PRIORITY_META[pr].badge}`}
                >
                  <span className="font-semibold text-sm">{pr}</span>
                  <Separator orientation="vertical" className="bg-black/10 h-4" />
                  <span className="text-sm font-medium">{summary.byPriority[pr] ?? 0}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Members + project info */}
      <div className="space-y-4">
        <Card className="p-0">
          <CardHeader>
            <CardTitle className="text-base">Members</CardTitle>
            <CardDescription>
              {members.length} member{members.length === 1 ? '' : 's'} on this project
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loadingMembers ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full" />
                ))}
              </div>
            ) : members.length === 0 ? (
              <p className="text-sm text-zinc-500">No members yet.</p>
            ) : (
              <div className="max-h-72 overflow-y-auto pr-1 -mr-1 space-y-1.5">
                {members.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-zinc-50"
                  >
                    <Avatar className="size-7">
                      <AvatarFallback className="text-[10px] bg-zinc-100">
                        {initials(m.fullName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-zinc-900 truncate">{m.fullName}</p>
                      <p className="text-xs text-zinc-500 truncate">{m.email}</p>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-[10px] py-0 px-1.5 border ${ROLE_BADGE[m.role]}`}
                    >
                      {ROLE_LABEL[m.role]}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
          <CardFooter className="border-t pt-3">
            <Button variant="outline" size="sm" className="w-full" onClick={onOpenMembers}>
              <UsersIcon className="h-3.5 w-3.5" />
              Manage members
            </Button>
          </CardFooter>
        </Card>

        <Card className="p-0">
          <CardHeader>
            <CardTitle className="text-base">Project info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2.5 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Created</span>
              <span className="font-medium text-zinc-900 text-right">
                {fmtDateTime(project.createdAt)}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Updated</span>
              <span className="font-medium text-zinc-900 text-right">
                {fmtDateTime(project.updatedAt)}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Owner</span>
              <span className="font-medium text-zinc-900 text-right">
                {owner?.fullName ?? 'You'}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between gap-2">
              <span className="text-zinc-500">Status</span>
              <Badge
                variant="outline"
                className={
                  project.isActive
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700 text-[10px]'
                    : 'border-zinc-200 bg-zinc-100 text-zinc-600 text-[10px]'
                }
              >
                {project.isActive ? 'Active' : 'Inactive'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

const TONE_CLASS: Record<string, string> = {
  zinc: 'text-zinc-900',
  blue: 'text-blue-700',
  red: 'text-red-700',
  amber: 'text-amber-700',
  emerald: 'text-emerald-700',
}

function SummaryCard({
  label,
  value,
  icon,
  tone,
  loading,
}: {
  label: string
  value: number
  icon: React.ReactNode
  tone: string
  loading?: boolean
}) {
  return (
    <Card className="p-3 gap-2">
      <div className="flex items-center justify-between text-zinc-500">
        <span className="text-xs">{label}</span>
        {icon}
      </div>
      <div className={`text-2xl font-bold tabular-nums ${TONE_CLASS[tone]}`}>
        {loading ? <Skeleton className="h-7 w-10" /> : value}
      </div>
    </Card>
  )
}

// ─────────────────────────── Plans Tab ───────────────────────────

interface PlansTabProps {
  plans: PlanFE[]
  loading: boolean
  canManage: boolean
  onUpload: () => void
  onOpenViewer: (planId: string) => void
  onEditPlan: (plan: PlanFE) => void
  onDeletePlan: (planId: string) => void
}

function PlansTab({
  plans,
  loading,
  canManage,
  onUpload,
  onOpenViewer,
  onEditPlan,
  onDeletePlan,
}: PlansTabProps) {
  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2 mb-4">
        <p className="text-sm text-zinc-500">
          {plans.length} plan{plans.length === 1 ? '' : 's'} uploaded
        </p>
        {canManage && (
          <Button size="sm" onClick={onUpload} className="gap-1.5">
            <Upload className="h-4 w-4" />
            Upload plan
          </Button>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed">
          <div className="mx-auto w-14 h-14 rounded-full bg-zinc-100 grid place-items-center mb-4">
            <FileText className="h-7 w-7 text-zinc-500" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-900">No plans yet</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
            Upload a PDF or image to start annotating plans with markups and pinned tasks.
          </p>
          {canManage && (
            <Button onClick={onUpload} className="mt-5 gap-1.5">
              <Upload className="h-4 w-4" />
              Upload your first plan
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {plans.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              onOpen={() => onOpenViewer(p.id)}
              onEdit={() => onEditPlan(p)}
              onDelete={() => onDeletePlan(p.id)}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface PlanCardProps {
  plan: PlanFE
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
  canManage: boolean
}

function PlanCard({ plan, onOpen, onEdit, onDelete, canManage }: PlanCardProps) {
  const isImage = plan.mimeType.startsWith('image/')
  const Icon = isImage ? ImageIcon : FileText
  return (
    <Card className="p-0 hover:shadow-md transition-all">
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base truncate">{plan.title}</CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1.5 text-xs">
              <Icon className="h-3 w-3" />
              <span className="truncate">{plan.fileName}</span>
            </CardDescription>
          </div>
          {canManage && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-7">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={onEdit}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={onDelete}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {plan.description ? (
          <p className="text-sm text-zinc-600 line-clamp-2 mb-3">{plan.description}</p>
        ) : (
          <p className="text-sm text-zinc-400 italic mb-3">No description</p>
        )}
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>{formatBytes(plan.fileSize)}</span>
          <Separator orientation="vertical" className="bg-zinc-200 h-3" />
          <span title={plan.uploadedByName}>{plan.uploadedByName || '—'}</span>
        </div>
      </CardContent>
      <CardFooter className="border-t pt-3 gap-2 items-center justify-between">
        <span className="text-xs text-zinc-500" title={fmtDateTime(plan.createdAt)}>
          {formatDistanceToNow(parseISO(plan.createdAt), { addSuffix: true })}
        </span>
        <Button size="sm" variant="outline" onClick={onOpen} className="gap-1.5">
          <FileText className="h-3.5 w-3.5" />
          Open viewer
        </Button>
      </CardFooter>
    </Card>
  )
}

// ─────────────────────────── Tasks Tab ───────────────────────────

interface TasksTabProps {
  tasks: TaskFE[]
  loading: boolean
  total: number
  page: number
  pageSize: number
  totalPages: number
  members: ProjectMemberFE[]
  q: string
  statusFilter: string
  priorityFilter: string
  assigneeFilter: string
  categoryFilter: string
  tradeFilter: string
  sortBy: 'title' | 'dueDate' | 'priority' | 'status' | 'createdAt' | 'updatedAt'
  order: 'asc' | 'desc'
  canManage: boolean
  onQ: (v: string) => void
  onStatus: (v: string) => void
  onPriority: (v: string) => void
  onAssignee: (v: string) => void
  onCategory: (v: string) => void
  onTrade: (v: string) => void
  onSort: (v: TasksTabProps['sortBy']) => void
  onOrder: (v: 'asc' | 'desc') => void
  onPage: (p: number) => void
  onClear: () => void
  onNewTask: () => void
  onOpenTask: (taskId: string) => void
}

function TasksTab(props: TasksTabProps) {
  const {
    tasks,
    loading,
    total,
    page,
    pageSize: _pageSize,
    totalPages,
    members,
    q,
    statusFilter,
    priorityFilter,
    assigneeFilter,
    categoryFilter,
    tradeFilter,
    sortBy,
    order,
    canManage,
    onQ,
    onStatus,
    onPriority,
    onAssignee,
    onCategory,
    onTrade,
    onSort,
    onOrder,
    onPage,
    onClear,
    onNewTask,
    onOpenTask,
  } = props
  void _pageSize

  const hasFilters =
    !!q ||
    statusFilter !== 'all' ||
    priorityFilter !== 'all' ||
    assigneeFilter !== 'all' ||
    !!categoryFilter ||
    !!tradeFilter

  return (
    <div className="mt-4 space-y-4">
      {/* Filters bar */}
      <Card className="p-3 gap-3">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2 flex-wrap items-center">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-400" />
              <Input
                value={q}
                onChange={(e) => onQ(e.target.value)}
                placeholder="Search title…"
                className="pl-8"
              />
            </div>
            <FilterSelect
              value={statusFilter}
              onValue={onStatus}
              placeholder="Status"
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'open', label: 'Open' },
                { value: 'in_progress', label: 'In progress' },
                { value: 'blocked', label: 'Blocked' },
                { value: 'done', label: 'Done' },
              ]}
            />
            <FilterSelect
              value={priorityFilter}
              onValue={onPriority}
              placeholder="Priority"
              options={[
                { value: 'all', label: 'All priorities' },
                { value: 'P1', label: 'P1 — High' },
                { value: 'P2', label: 'P2 — Medium' },
                { value: 'P3', label: 'P3 — Low' },
              ]}
            />
            <FilterSelect
              value={assigneeFilter}
              onValue={onAssignee}
              placeholder="Assignee"
              options={[
                { value: 'all', label: 'All assignees' },
                { value: '__unassigned__', label: 'Unassigned' },
                ...members.map((m) => ({ value: m.userId, label: m.fullName })),
              ]}
            />
            {canManage && (
              <Button size="sm" onClick={onNewTask} className="gap-1.5 ml-auto">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">New task</span>
                <span className="sm:hidden">Task</span>
              </Button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            <Input
              value={categoryFilter}
              onChange={(e) => onCategory(e.target.value)}
              placeholder="Category"
              className="max-w-[160px] h-8"
            />
            <Input
              value={tradeFilter}
              onChange={(e) => onTrade(e.target.value)}
              placeholder="Trade"
              className="max-w-[160px] h-8"
            />
            <FilterSelect
              value={sortBy}
              onValue={(v) => onSort(v as TasksTabProps['sortBy'])}
              placeholder="Sort"
              options={[
                { value: 'createdAt', label: 'Created' },
                { value: 'updatedAt', label: 'Updated' },
                { value: 'title', label: 'Title' },
                { value: 'dueDate', label: 'Due date' },
                { value: 'priority', label: 'Priority' },
                { value: 'status', label: 'Status' },
              ]}
              size="sm"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOrder(order === 'asc' ? 'desc' : 'asc')}
              className="gap-1.5 h-8"
              title={`Sort ${order === 'asc' ? 'descending' : 'ascending'}`}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span className="text-xs uppercase">{order}</span>
            </Button>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5 h-8 ml-auto">
                <X className="h-3.5 w-3.5" />
                Clear
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* List */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : tasks.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed">
          <div className="mx-auto w-14 h-14 rounded-full bg-zinc-100 grid place-items-center mb-4">
            <Filter className="h-7 w-7 text-zinc-500" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-900">No tasks match</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
            {hasFilters
              ? 'Try adjusting your filters or clearing them to see all tasks.'
              : 'Create your first task to track work on this project.'}
          </p>
          <div className="flex items-center justify-center gap-2 mt-5 flex-wrap">
            {hasFilters && (
              <Button variant="outline" onClick={onClear} className="gap-1.5">
                <X className="h-4 w-4" />
                Clear filters
              </Button>
            )}
            {canManage && (
              <Button onClick={onNewTask} className="gap-1.5">
                <Plus className="h-4 w-4" />
                New task
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <>
          {/* Desktop table */}
          <Card className="p-0 hidden md:block overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-zinc-50">
                  <TableHead className="pl-4">Title</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Priority</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="pr-4">Tags</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((t) => (
                  <TaskTableRow key={t.id} task={t} onOpen={() => onOpenTask(t.id)} />
                ))}
              </TableBody>
            </Table>
          </Card>

          {/* Mobile cards */}
          <div className="md:hidden space-y-2">
            {tasks.map((t) => (
              <TaskCardMobile key={t.id} task={t} onOpen={() => onOpenTask(t.id)} />
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between gap-2 text-sm text-zinc-600">
            <span>
              Page <strong className="text-zinc-900">{page}</strong> of {totalPages}{' '}
              <span className="text-zinc-400">({total} task{total === 1 ? '' : 's'} total)</span>
            </span>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => onPage(page - 1)}
                className="gap-1"
              >
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => onPage(page + 1)}
                className="gap-1"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function TaskTableRow({ task, onOpen }: { task: TaskFE; onOpen: () => void }) {
  const sMeta = STATUS_META[task.status]
  const pMeta = PRIORITY_META[task.priority]
  const dueOverdue = task.dueDate && task.status !== 'done' && isPast(parseISO(task.dueDate))
  return (
    <TableRow
      onClick={onOpen}
      className="cursor-pointer"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <TableCell className="pl-4 font-medium text-zinc-900 max-w-xs">
        <div className="truncate" title={task.title}>{task.title}</div>
        {task.commentCount ? (
          <span className="text-[11px] text-zinc-400">{task.commentCount} comment{task.commentCount === 1 ? '' : 's'}</span>
        ) : null}
      </TableCell>
      <TableCell className="text-zinc-700">
        {task.assigneeName ?? <span className="text-zinc-400 italic text-xs">Unassigned</span>}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={`text-[10px] py-0 px-1.5 border ${sMeta.badge}`}>
          <sMeta.icon className="h-3 w-3" />
          {sMeta.label}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant="outline" className={`text-[10px] py-0 px-1.5 border ${pMeta.badge}`}>
          {pMeta.label}
        </Badge>
      </TableCell>
      <TableCell className={dueOverdue ? 'text-red-700 font-medium' : 'text-zinc-700'}>
        {task.dueDate ? fmtDate(task.dueDate) : '—'}
      </TableCell>
      <TableCell className="text-zinc-700 max-w-[160px]">
        <div className="truncate" title={task.locationName ?? ''}>
          {task.locationName ?? <span className="text-zinc-400 italic text-xs">—</span>}
        </div>
      </TableCell>
      <TableCell className="pr-4">
        <div className="flex gap-1 flex-wrap max-w-[220px]">
          {task.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] py-0 px-1.5">
              {tag}
            </Badge>
          ))}
          {task.tags.length > 3 && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
              +{task.tags.length - 3}
            </Badge>
          )}
        </div>
      </TableCell>
    </TableRow>
  )
}

function TaskCardMobile({ task, onOpen }: { task: TaskFE; onOpen: () => void }) {
  const sMeta = STATUS_META[task.status]
  const pMeta = PRIORITY_META[task.priority]
  const dueOverdue = task.dueDate && task.status !== 'done' && isPast(parseISO(task.dueDate))
  return (
    <Card
      onClick={onOpen}
      className="p-3 gap-2 cursor-pointer active:scale-[0.99] transition-transform"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <h4 className="font-medium text-zinc-900 text-sm leading-snug">{task.title}</h4>
        <div className="flex gap-1 shrink-0">
          <Badge variant="outline" className={`text-[9px] py-0 px-1.5 border ${pMeta.badge}`}>
            {pMeta.label}
          </Badge>
          <Badge variant="outline" className={`text-[9px] py-0 px-1.5 border ${sMeta.badge}`}>
            {sMeta.label}
          </Badge>
        </div>
      </div>
      <div className="flex items-center gap-3 text-xs text-zinc-500 flex-wrap">
        {task.assigneeName ? (
          <span className="flex items-center gap-1">
            <UserIcon className="h-3 w-3" />
            {task.assigneeName}
          </span>
        ) : (
          <span className="italic">Unassigned</span>
        )}
        {task.dueDate && (
          <span className={`flex items-center gap-1 ${dueOverdue ? 'text-red-700 font-medium' : ''}`}>
            <Calendar className="h-3 w-3" />
            {fmtDate(task.dueDate)}
          </span>
        )}
        {task.locationName && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />
            <span className="truncate max-w-[140px]">{task.locationName}</span>
          </span>
        )}
      </div>
      {task.tags.length > 0 && (
        <div className="flex gap-1 flex-wrap">
          {task.tags.slice(0, 4).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px] py-0 px-1.5">
              <Tag className="h-2.5 w-2.5" />
              {tag}
            </Badge>
          ))}
          {task.tags.length > 4 && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5">
              +{task.tags.length - 4}
            </Badge>
          )}
        </div>
      )}
    </Card>
  )
}

interface FilterSelectProps {
  value: string
  onValue: (v: string) => void
  placeholder: string
  options: { value: string; label: string }[]
  size?: 'sm' | 'default'
}

function FilterSelect({ value, onValue, placeholder, options, size = 'sm' }: FilterSelectProps) {
  return (
    <Select value={value} onValueChange={onValue}>
      <SelectTrigger size={size} className="min-w-[120px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value || 'unassigned'} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// ─────────────────────────── Edit Project Dialog ───────────────────────────

function EditProjectDialog({
  project,
  open,
  onOpenChange,
  onSubmit,
}: {
  project: ProjectDetailFE
  open: boolean
  onOpenChange: (o: boolean) => void
  onSubmit: (patch: { name?: string; code?: string; description?: string | null }) => Promise<void>
}) {
  // Form is initialized once from props; the parent conditionally mounts
  // this dialog so each open re-mounts with a fresh useState snapshot.
  const [name, setName] = useState(project.name)
  const [code, setCode] = useState(project.code)
  const [description, setDescription] = useState(project.description ?? '')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    await onSubmit({
      name: name.trim(),
      code: code.trim().toUpperCase(),
      description: description.trim() || null,
    })
    setSubmitting(false)
  }, [name, code, description, onSubmit])

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit project</DialogTitle>
          <DialogDescription>Update the project name, code, or description.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ep-name">Name</Label>
            <Input id="ep-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ep-code">Code</Label>
            <Input
              id="ep-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))}
              maxLength={32}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ep-desc">Description</Label>
            <Textarea
              id="ep-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={2000}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Manage Members Sheet ───────────────────────────

function ManageMembersSheet({
  open,
  onOpenChange,
  members,
  canManage,
  onAdd,
  onRemove,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  members: ProjectMemberFE[]
  canManage: boolean
  onAdd: (userId: string, role: Role) => Promise<void>
  onRemove: (userId: string) => Promise<void>
}) {
  const [userId, setUserId] = useState('')
  const [role, setRole] = useState<Role>('engineer')
  const [submitting, setSubmitting] = useState(false)

  const handleAdd = useCallback(async () => {
    if (!userId.trim()) return
    setSubmitting(true)
    await onAdd(userId.trim(), role)
    setSubmitting(false)
    setUserId('')
  }, [userId, role, onAdd])

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Manage members</SheetTitle>
          <SheetDescription>{members.length} member{members.length === 1 ? '' : 's'} on this project.</SheetDescription>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-4 pb-4">
          {canManage && (
            <div className="mb-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3 space-y-3">
              <p className="text-sm font-medium text-zinc-900">Add member</p>
              <Input
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
                placeholder="User ID"
              />
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engineer">Engineer</SelectItem>
                  <SelectItem value="foreman">Foreman</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={handleAdd} disabled={submitting || !userId.trim()} className="w-full gap-1.5">
                {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
                Add member
              </Button>
            </div>
          )}
          <div className="space-y-1.5">
            {members.map((m) => (
              <div
                key={m.id}
                className="flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-zinc-50 border border-transparent"
              >
                <Avatar className="size-8">
                  <AvatarFallback className="text-[11px] bg-zinc-100">
                    {initials(m.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-zinc-900 truncate">{m.fullName}</p>
                  <p className="text-xs text-zinc-500 truncate">{m.email}</p>
                </div>
                <Badge
                  variant="outline"
                  className={`text-[10px] py-0 px-1.5 border ${ROLE_BADGE[m.role]}`}
                >
                  {ROLE_LABEL[m.role]}
                </Badge>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-zinc-400 hover:text-red-600"
                    onClick={() => void onRemove(m.userId)}
                    aria-label={`Remove ${m.fullName}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─────────────────────────── Upload Plan Dialog ───────────────────────────

function UploadPlanDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  onSubmit: (file: File, title: string, description: string) => Promise<void>
}) {
  // Parent conditionally mounts this dialog; useState initializes fresh
  // form state on each open.
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!file) return
    setSubmitting(true)
    await onSubmit(file, title.trim() || file.name, description.trim())
    setSubmitting(false)
  }, [file, title, description, onSubmit])

  const accept = 'application/pdf,image/png,image/jpeg,image/webp,image/gif'

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload plan</DialogTitle>
          <DialogDescription>Upload a PDF or image to annotate.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="plan-file">File</Label>
            <Input
              id="plan-file"
              type="file"
              accept={accept}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setFile(f)
                  if (!title) setTitle(f.name.replace(/\.[^.]+$/, ''))
                }
              }}
            />
            {file && (
              <p className="text-xs text-zinc-500">
                {file.name} · {formatBytes(file.size)}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="plan-title">Title</Label>
            <Input
              id="plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Floor 3 — East wing"
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="plan-desc">Description (optional)</Label>
            <Textarea
              id="plan-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || !file} className="gap-1.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Uploading…' : 'Upload'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── Edit Plan Dialog ───────────────────────────

function EditPlanDialog({
  plan,
  onOpenChange,
  onSubmit,
}: {
  plan: PlanFE
  onOpenChange: (o: boolean) => void
  onSubmit: (patch: { title?: string; description?: string | null }) => Promise<void>
}) {
  // Parent conditionally renders this dialog only when editPlanTarget is
  // set; useState picks up the current plan on each mount.
  const [title, setTitle] = useState(plan.title)
  const [description, setDescription] = useState(plan.description ?? '')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    setSubmitting(true)
    await onSubmit({
      title: title.trim(),
      description: description.trim() || null,
    })
    setSubmitting(false)
  }, [title, description, onSubmit])

  return (
    <Dialog open onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit plan</DialogTitle>
          <DialogDescription>Update the plan title or description.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ep-plan-title">Title</Label>
            <Input
              id="ep-plan-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="ep-plan-desc">Description</Label>
            <Textarea
              id="ep-plan-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting} className="gap-1.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─────────────────────────── New Task Dialog ───────────────────────────

interface NewTaskForm {
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  assigneeId: string
  dueDate: string
  trade: string
  category: string
  locationName: string
  tags: string
}

const EMPTY_TASK_FORM: NewTaskForm = {
  title: '',
  description: '',
  priority: 'P2',
  status: 'open',
  assigneeId: '',
  dueDate: '',
  trade: '',
  category: '',
  locationName: '',
  tags: '',
}

function NewTaskDialog({
  open,
  onOpenChange,
  members,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  members: ProjectMemberFE[]
  onSubmit: (body: Record<string, unknown>) => Promise<void>
}) {
  // Parent conditionally mounts this dialog; useState initializes the
  // empty form on each open.
  const [form, setForm] = useState<NewTaskForm>(EMPTY_TASK_FORM)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(async () => {
    if (!form.title.trim()) return
    setSubmitting(true)
    const body: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      status: form.status,
      assigneeId: form.assigneeId || null,
      dueDate: form.dueDate ? `${form.dueDate}T23:59:59.000Z` : null,
      trade: form.trade.trim() || null,
      category: form.category.trim() || null,
      locationName: form.locationName.trim() || null,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }
    await onSubmit(body)
    setSubmitting(false)
  }, [form, onSubmit])

  const set = <K extends keyof NewTaskForm>(k: K, v: NewTaskForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }))

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New task</DialogTitle>
          <DialogDescription>Create a task for this project.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="nt-title">Title *</Label>
            <Input
              id="nt-title"
              value={form.title}
              onChange={(e) => set('title', e.target.value)}
              placeholder="Install HVAC diffusers on floor 3"
              maxLength={255}
              autoFocus
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="nt-desc">Description</Label>
            <Textarea
              id="nt-desc"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={3}
              maxLength={4000}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nt-priority">Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set('priority', v as TaskPriority)}>
                <SelectTrigger id="nt-priority" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="P1">P1 — High</SelectItem>
                  <SelectItem value="P2">P2 — Medium</SelectItem>
                  <SelectItem value="P3">P3 — Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="nt-status">Status</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v as TaskStatus)}>
                <SelectTrigger id="nt-status" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="blocked">Blocked</SelectItem>
                  <SelectItem value="done">Done</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nt-assignee">Assignee</Label>
              <Select value={form.assigneeId ?? '__none__'} onValueChange={(v) => set('assigneeId', v === '__none__' ? undefined : v)}>
                <SelectTrigger id="nt-assignee" className="w-full">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {members.map((m) => (
                    <SelectItem key={m.userId} value={m.userId}>
                      {m.fullName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="nt-due">Due date</Label>
              <Input
                id="nt-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => set('dueDate', e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="nt-trade">Trade</Label>
              <Input
                id="nt-trade"
                value={form.trade}
                onChange={(e) => set('trade', e.target.value)}
                placeholder="HVAC"
                maxLength={100}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="nt-category">Category</Label>
              <Input
                id="nt-category"
                value={form.category}
                onChange={(e) => set('category', e.target.value)}
                placeholder="Installation"
                maxLength={100}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="nt-location">Location</Label>
            <Input
              id="nt-location"
              value={form.locationName}
              onChange={(e) => set('locationName', e.target.value)}
              placeholder="Floor 3, East wing"
              maxLength={255}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="nt-tags">Tags (comma-separated)</Label>
            <Input
              id="nt-tags"
              value={form.tags}
              onChange={(e) => set('tags', e.target.value)}
              placeholder="inspection, weekend, follow-up"
            />
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={submitting}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={submitting || !form.title.trim()} className="gap-1.5">
            {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
            {submitting ? 'Creating…' : 'Create task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
