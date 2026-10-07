'use client'

import { useEffect } from 'react'
import { useRouterStore, useAuthStore, useUiStore } from '@/stores'
import { ConnectivityBar } from '@/components/pwa/ConnectivityBar'
import { ToastHost } from '@/components/pwa/ConnectivityBar'
import { Bell, Building2, LogOut, User as UserIcon, Wifi, WifiOff } from 'lucide-react'

export function AppShell({ children }: { children: React.ReactNode }) {
  const view = useRouterStore((s) => s.view)
  const navigate = useRouterStore((s) => s.navigate)
  const user = useAuthStore((s) => s.user)
  const logout = useAuthStore((s) => s.logout)
  const hydrate = useAuthStore((s) => s.hydrate)
  const online = useUiStore((s) => s.online)
  const pending = useUiStore((s) => s.pendingCount)
  const reset = useRouterStore((s) => s.reset)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Unauthenticated views render without shell
  if (view === 'login' || view === 'register' || !user) {
    return (
      <div className="min-h-screen flex flex-col bg-zinc-50">
        <ConnectivityBar />
        <main className="flex-1 flex flex-col">{children}</main>
        <footer className="mt-auto border-t border-zinc-200 bg-white py-4 text-center text-xs text-zinc-500">
          PlanForge · Offline-first construction plan &amp; task management · v1.0
        </footer>
        <ToastHost />
      </div>
    )
  }

  const isPlanViewer = view === 'plan-viewer' // full-screen

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50">
      <ConnectivityBar />
      {!isPlanViewer && (
        <header className="sticky top-0 z-40 bg-white border-b border-zinc-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center justify-between">
            <button onClick={() => navigate('dashboard')} className="flex items-center gap-2 font-semibold text-zinc-900 hover:opacity-80">
              <div className="h-7 w-7 rounded-md bg-zinc-900 text-white grid place-items-center text-xs font-bold">PF</div>
              <span className="hidden sm:block">PlanForge</span>
            </button>
            <nav className="flex items-center gap-1 sm:gap-2">
              <button
                onClick={() => navigate('dashboard')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  view === 'dashboard' ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <Building2 className="h-4 w-4" />
                <span className="hidden sm:inline">Projects</span>
              </button>
              <button
                onClick={() => navigate('notifications')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 relative ${
                  view === 'notifications' ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <Bell className="h-4 w-4" />
                <span className="hidden sm:inline">Alerts</span>
              </button>
              <button
                onClick={() => navigate('profile')}
                className={`px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
                  view === 'profile' ? 'bg-zinc-900 text-white' : 'text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <UserIcon className="h-4 w-4" />
                <span className="hidden sm:inline max-w-[8rem] truncate">{user.fullName}</span>
              </button>
              <button
                onClick={async () => {
                  await logout()
                  reset()
                }}
                className="px-2.5 sm:px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 text-zinc-700 hover:bg-zinc-100"
                aria-label="Sign out"
              >
                <LogOut className="h-4 w-4" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </nav>
          </div>
          {/* Inline connectivity chip for narrow viewports */}
          <div className="sm:hidden px-4 py-1 text-xs text-zinc-500 flex items-center justify-between bg-zinc-50 border-t border-zinc-100">
            <span className="flex items-center gap-1">
              {online ? <Wifi className="h-3 w-3 text-emerald-500" /> : <WifiOff className="h-3 w-3 text-amber-500" />}
              {online ? 'Online' : 'Offline'}
            </span>
            {pending > 0 && <span>{pending} queued</span>}
          </div>
        </header>
      )}

      <main className={`flex-1 flex flex-col ${isPlanViewer ? 'min-h-0' : ''}`}>{children}</main>

      {!isPlanViewer && (
        <footer className="mt-auto border-t border-zinc-200 bg-white py-4">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-zinc-500">
            <span>PlanForge · Offline-first construction plan &amp; task management · v1.0</span>
            <span>Built with Next.js, Prisma, PDF.js, IndexedDB</span>
          </div>
        </footer>
      )}
      <ToastHost />
    </div>
  )
}
