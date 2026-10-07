'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { format, formatDistanceToNow } from 'date-fns'
import {
  Plus,
  FolderOpen,
  Building2,
  Users,
  Loader2,
  AlertCircle,
  ArrowRight,
  WifiOff,
  ListChecks,
  CircleDot,
  PlayCircle,
  Ban,
  CheckCircle2,
} from 'lucide-react'
import { useRouterStore, useUiStore, useAuthStore } from '@/stores'
import { apiGet, apiPost, isQueuedError, ApiError } from '@/lib/client/api'
import { getCachedProjects, cacheProjects } from '@/lib/client/idb-offline'
import type { ProjectFE } from '@/lib/client/types'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from '@/components/ui/dialog'

interface NewProjectForm {
  name: string
  code: string
  description: string
}

const EMPTY_FORM: NewProjectForm = { name: '', code: '', description: '' }

const STATUS_META: Record<
  string,
  { label: string; dot: string; text: string; icon: typeof CircleDot }
> = {
  open: { label: 'Open', dot: 'bg-zinc-400', text: 'text-zinc-600', icon: CircleDot },
  in_progress: { label: 'In progress', dot: 'bg-blue-400', text: 'text-blue-600', icon: PlayCircle },
  blocked: { label: 'Blocked', dot: 'bg-red-400', text: 'text-red-600', icon: Ban },
  done: { label: 'Done', dot: 'bg-emerald-500', text: 'text-emerald-700', icon: CheckCircle2 },
}

function roleBadgeClass(role: string): string {
  switch (role) {
    case 'admin':
      return 'bg-zinc-900 text-white border-zinc-900'
    case 'project_manager':
      return 'bg-emerald-100 text-emerald-800 border-emerald-200'
    case 'engineer':
      return 'bg-sky-100 text-sky-800 border-sky-200'
    case 'foreman':
      return 'bg-amber-100 text-amber-800 border-amber-200'
    default:
      return 'bg-zinc-100 text-zinc-700 border-zinc-200'
  }
}

export function DashboardView() {
  const navigate = useRouterStore((s) => s.navigate)
  const showToast = useUiStore((s) => s.showToast)
  const online = useUiStore((s) => s.online)
  const user = useAuthStore((s) => s.user)

  const [projects, setProjects] = useState<ProjectFE[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingCache, setUsingCache] = useState(false)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [form, setForm] = useState<NewProjectForm>(EMPTY_FORM)
  const [submitting, setSubmitting] = useState(false)

  const loadProjects = useCallback(async () => {
    setLoading(true)
    setError(null)
    setUsingCache(false)
    try {
      const data = await apiGet<{ projects: ProjectFE[] }>('/projects')
      setProjects(data.projects)
      void cacheProjects(data.projects).catch(() => undefined)
    } catch (e) {
      // Fall back to IndexedDB cache (offline or network failure)
      try {
        const cached = await getCachedProjects()
        setProjects(cached)
        setUsingCache(true)
        if (cached.length === 0) {
          setError(e instanceof Error ? e.message : 'Failed to load projects')
        }
      } catch {
        setError('Failed to load projects')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadProjects()
  }, [loadProjects])

  const handleOpenCreate = useCallback(() => {
    setForm(EMPTY_FORM)
    setDialogOpen(true)
  }, [])

  const handleCreate = useCallback(async () => {
    const name = form.name.trim()
    const code = form.code.trim().toUpperCase()
    if (!name) {
      showToast({ title: 'Name is required', variant: 'error' })
      return
    }
    if (!code) {
      showToast({ title: 'Code is required', variant: 'error' })
      return
    }
    setSubmitting(true)
    const localId = `local_${Date.now().toString(36)}`
    const optimistic: ProjectFE = {
      id: localId,
      name,
      code,
      description: form.description.trim() || null,
      ownerId: user?.id ?? '',
      isActive: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      role: 'project_manager',
      memberCount: 1,
      taskCounts: { total: 0, byStatus: {} },
    }
    setProjects((prev) => [optimistic, ...prev])

    try {
      const created = await apiPost<ProjectFE>(
        '/projects',
        { name, code, description: form.description.trim() || null },
        { localId },
      )
      showToast({ title: 'Project created', description: created.name, variant: 'success' })
      setDialogOpen(false)
      setForm(EMPTY_FORM)
      navigate('project', { projectId: created.id })
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({
          title: 'Saved offline',
          description: 'Will sync when you reconnect',
          variant: 'warning',
        })
        setDialogOpen(false)
        setForm(EMPTY_FORM)
      } else {
        // Roll back the optimistic card
        setProjects((prev) => prev.filter((p) => p.id !== localId))
        const msg = e instanceof ApiError ? e.message : 'Failed to create project'
        showToast({ title: 'Could not create project', description: msg, variant: 'error' })
      }
    } finally {
      setSubmitting(false)
    }
  }, [form, navigate, showToast, user?.id])

  const handleCardClick = useCallback(
    (p: ProjectFE) => {
      // Don't navigate on the optimistic placeholder if it's still pending
      navigate('project', { projectId: p.id })
    },
    [navigate],
  )

  const totalTasks = useMemo(
    () =>
      projects.reduce(
        (sum, p) => sum + (p.taskCounts?.total ?? 0),
        0,
      ),
    [projects],
  )

  return (
    <div className="max-w-7xl mx-auto w-full p-4 sm:p-6 flex-1 flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between gap-3 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-900 tracking-tight">Projects</h1>
          <p className="text-sm text-zinc-500 mt-1">
            {projects.length} project{projects.length === 1 ? '' : 's'}
            {totalTasks > 0 && <> · {totalTasks} total task{totalTasks === 1 ? '' : 's'}</>}
          </p>
        </div>
        <Button onClick={handleOpenCreate} className="gap-1.5" disabled={submitting}>
          <Plus className="h-4 w-4" />
          New project
        </Button>
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
      {usingCache && online && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-600" role="status">
          <AlertCircle className="h-3.5 w-3.5" />
          Showing cached data from a previous session.
        </div>
      )}

      {/* Body */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="p-0">
              <CardHeader>
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-3 w-1/3 mt-1" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-3 w-full mb-2" />
                <Skeleton className="h-3 w-2/3" />
              </CardContent>
              <CardFooter>
                <Skeleton className="h-8 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
      ) : error && projects.length === 0 ? (
        <Card className="p-6 text-center">
          <AlertCircle className="h-10 w-10 text-red-500 mx-auto mb-3" />
          <p className="text-zinc-900 font-medium">Couldn&apos;t load projects</p>
          <p className="text-sm text-zinc-500 mt-1">{error}</p>
          <Button variant="outline" className="mt-4" onClick={() => void loadProjects()}>
            Try again
          </Button>
        </Card>
      ) : projects.length === 0 ? (
        <Card className="p-8 sm:p-12 text-center border-dashed">
          <div className="mx-auto w-14 h-14 rounded-full bg-zinc-100 grid place-items-center mb-4">
            <FolderOpen className="h-7 w-7 text-zinc-500" />
          </div>
          <h3 className="text-lg font-semibold text-zinc-900">No projects yet</h3>
          <p className="text-sm text-zinc-500 mt-1 max-w-md mx-auto">
            Create your first project, or seed demo data from your profile to explore PlanForge with sample plans, tasks, and markups.
          </p>
          <div className="flex items-center justify-center gap-2 mt-5 flex-wrap">
            <Button onClick={handleOpenCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              Create project
            </Button>
            <Button variant="outline" onClick={() => navigate('profile')}>
              Seed demo data
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-2">
          {projects.map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={() => handleCardClick(p)} />
          ))}
        </div>
      )}

      {/* New project dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => !submitting && setDialogOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Create a workspace for plans, tasks, and markups.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 py-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="proj-name">Name</Label>
              <Input
                id="proj-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Skyline Tower"
                maxLength={255}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proj-code">Code</Label>
              <Input
                id="proj-code"
                value={form.code}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''),
                  }))
                }
                placeholder="SKY-001"
                maxLength={32}
              />
              <p className="text-xs text-zinc-500">
                Uppercase letters, digits, dashes, underscores.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="proj-desc">Description (optional)</Label>
              <Textarea
                id="proj-desc"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="A short summary of the project scope…"
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
            <Button onClick={handleCreate} disabled={submitting} className="gap-1.5">
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Creating…' : 'Create project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

interface ProjectCardProps {
  project: ProjectFE
  onOpen: () => void
}

function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const byStatus = project.taskCounts?.byStatus ?? {}
  const total = project.taskCounts?.total ?? 0
  const isPending = project.id.startsWith('local_')

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className={`group relative p-0 hover:shadow-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 ${
        isPending ? 'opacity-70 ring-1 ring-amber-300' : ''
      }`}
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="truncate text-base sm:text-lg">{project.name}</CardTitle>
            <CardDescription className="mt-1 flex items-center gap-1.5 text-xs">
              <Building2 className="h-3 w-3" />
              <Badge variant="outline" className="font-mono tracking-tight text-[10px] py-0 px-1.5">
                {project.code}
              </Badge>
              <Badge variant="outline" className={`text-[10px] py-0 px-1.5 border ${roleBadgeClass(project.role)}`}>
                {project.role.replace('_', ' ')}
              </Badge>
            </CardDescription>
          </div>
          <ArrowRight className="h-4 w-4 text-zinc-400 group-hover:translate-x-0.5 transition-transform shrink-0" />
        </div>
      </CardHeader>
      <CardContent>
        {project.description ? (
          <p className="text-sm text-zinc-600 line-clamp-2">{project.description}</p>
        ) : (
          <p className="text-sm text-zinc-400 italic">No description</p>
        )}
      </CardContent>
      <CardFooter className="border-t pt-3 flex flex-col gap-2 items-stretch">
        <div className="flex items-center justify-between text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            <Users className="h-3.5 w-3.5" />
            {project.memberCount ?? '—'} member{(project.memberCount ?? 1) === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-1">
            <ListChecks className="h-3.5 w-3.5" />
            {total} task{total === 1 ? '' : 's'}
          </span>
          <span title={format(new Date(project.createdAt), "MMM d, yyyy 'at' h:mm a")}>
            {formatDistanceToNow(new Date(project.createdAt), { addSuffix: true })}
          </span>
        </div>
        {total > 0 && (
          <div className="flex items-center gap-2 text-[11px] flex-wrap">
            {Object.entries(STATUS_META).map(([key, meta]) => {
              const n = byStatus[key] ?? 0
              if (!n) return null
              const Icon = meta.icon
              return (
                <span key={key} className={`flex items-center gap-1 ${meta.text}`} title={meta.label}>
                  <Icon className="h-3 w-3" />
                  <span className="font-medium">{n}</span>
                  <span className="hidden sm:inline">{meta.label}</span>
                </span>
              )
            })}
          </div>
        )}
        {isPending && (
          <div className="text-[11px] text-amber-700 flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" />
            Queued for sync
          </div>
        )}
      </CardFooter>
    </Card>
  )
}
