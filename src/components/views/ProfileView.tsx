'use client'

import { useEffect, useState } from 'react'
import {
  Calendar,
  CloudOff,
  Database,
  Loader2,
  LogOut,
  Mail,
  RefreshCw,
  Sprout,
  User as UserIcon,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useRouterStore } from '@/stores/router'
import { useUiStore } from '@/stores/ui'
import { apiPost, isQueuedError } from '@/lib/client/api'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

const ROLE_LABELS: Record<string, string> = {
  admin: 'Admin',
  project_manager: 'Project Manager',
  engineer: 'Engineer',
  foreman: 'Foreman',
  viewer: 'Viewer',
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

export function ProfileView() {
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const reset = useRouterStore((s) => s.reset)
  const navigate = useRouterStore((s) => s.navigate)
  const online = useUiStore((s) => s.online)
  const pendingCount = useUiStore((s) => s.pendingCount)
  const showToast = useUiStore((s) => s.showToast)

  const [seeding, setSeeding] = useState(false)
  const [syncing, setSyncing] = useState(false)

  useEffect(() => {
    useAuthStore.setState({ error: null })
  }, [])

  if (!user) {
    return (
      <div className="max-w-3xl mx-auto p-4 sm:p-6">
        <p className="text-sm text-zinc-500">You are not signed in.</p>
        <Button className="mt-3" onClick={() => navigate('login')}>
          Sign in
        </Button>
      </div>
    )
  }

  const handleSeed = async () => {
    setSeeding(true)
    try {
      const data = await apiPost<{ ok: boolean; seeded: boolean; projectId: string }>('/seed')
      const wasFresh = data.seeded
      showToast({
        title: wasFresh ? 'Demo data ready' : 'Demo data already loaded',
        description: wasFresh ? 'Skyline Tower project seeded.' : undefined,
        variant: 'success',
      })
      navigate('dashboard')
    } catch (e) {
      if (isQueuedError(e)) {
        showToast({ title: 'Saved offline — will sync when online' })
      } else {
        showToast({ title: 'Failed to seed demo data', variant: 'error' })
      }
    } finally {
      setSeeding(false)
    }
  }

  const handleSyncNow = () => {
    setSyncing(true)
    window.dispatchEvent(new CustomEvent('planforge:try-sync'))
    showToast({ title: 'Sync started', description: 'Flushing queued changes…' })
    // Give the sync worker a beat; UI will re-render on queue change event.
    setTimeout(() => setSyncing(false), 1200)
  }

  const handleSignOut = async () => {
    await logout()
    reset()
    showToast({ title: 'Signed out' })
  }

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6">
      <header className="flex items-center gap-4 mb-6">
        <Avatar className="h-14 w-14">
          <AvatarFallback className="bg-zinc-900 text-white text-base font-semibold">
            {initialsOf(user.fullName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-zinc-900 truncate">{user.fullName}</h1>
          <p className="text-sm text-zinc-500 truncate">{user.email}</p>
        </div>
      </header>

      <div className="space-y-4">
        {/* Account info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-900">
              <UserIcon className="h-4 w-4" /> Account
            </CardTitle>
            <CardDescription>Your PlanForge profile details</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Full name</div>
              <div className="text-sm text-zinc-900">{user.fullName}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1">
                <Mail className="h-3 w-3" /> Email
              </div>
              <div className="text-sm text-zinc-900 truncate">{user.email}</div>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-zinc-500">Role</div>
              <div>
                <Badge variant="secondary" className="bg-zinc-100 text-zinc-800">
                  {ROLE_LABELS[user.role] ?? user.role}
                </Badge>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs uppercase tracking-wide text-zinc-500 flex items-center gap-1">
                <Calendar className="h-3 w-3" /> Joined
              </div>
              <div className="text-sm text-zinc-900">{formatDate(user.createdAt)}</div>
            </div>
          </CardContent>
        </Card>

        {/* Demo data */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-900">
              <Sprout className="h-4 w-4" /> Demo data
            </CardTitle>
            <CardDescription>
              Seed a sample construction project with plans, markups, tasks &amp; comments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={handleSeed} disabled={seeding || !online}>
              {seeding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sprout className="h-4 w-4" />
              )}
              {seeding ? 'Seeding…' : 'Seed demo project'}
            </Button>
            {!online && (
              <p className="text-xs text-amber-600 mt-2">
                You are offline. Reconnect to seed demo data.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Offline cache */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-900">
              <Database className="h-4 w-4" /> Offline cache
            </CardTitle>
            <CardDescription>
              Mutations made while offline are queued locally and flushed automatically.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold text-zinc-900">{pendingCount}</div>
              <div className="text-xs text-zinc-500">queued changes</div>
            </div>
            <Button
              variant="outline"
              onClick={handleSyncNow}
              disabled={syncing || !online || pendingCount === 0}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync now
            </Button>
          </CardContent>
        </Card>

        {/* Connectivity */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-900">
              {online ? <Wifi className="h-4 w-4" /> : <CloudOff className="h-4 w-4" />}
              Connectivity
            </CardTitle>
            <CardDescription>Current network status</CardDescription>
          </CardHeader>
          <CardContent>
            {online ? (
              <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">
                <Wifi className="h-3 w-3" /> Online
              </Badge>
            ) : (
              <Badge variant="secondary" className="bg-amber-100 text-amber-800">
                <WifiOff className="h-3 w-3" /> Offline
              </Badge>
            )}
          </CardContent>
        </Card>

        {/* Sign out */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-zinc-900">
              <LogOut className="h-4 w-4" /> Sign out
            </CardTitle>
            <CardDescription>End your session on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="destructive" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
