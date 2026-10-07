'use client'

import { useEffect } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister'
import { useRouterStore, useAuthStore } from '@/stores'
import { LoginView } from '@/components/views/LoginView'
import { RegisterView } from '@/components/views/RegisterView'
import { DashboardView } from '@/components/views/DashboardView'
import { ProjectView } from '@/components/views/ProjectView'
import { PlanViewerView } from '@/components/views/PlanViewerView'
import { TaskDetailView } from '@/components/views/TaskDetailView'
import { ProfileView } from '@/components/views/ProfileView'
import { NotificationsView } from '@/components/views/NotificationsView'

export default function Home() {
  const view = useRouterStore((s) => s.view)
  const user = useAuthStore((s) => s.user)
  const hydrate = useAuthStore((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Auto-route: if authenticated and stuck on login, go to dashboard
  useEffect(() => {
    if (user && (view === 'login' || view === 'register')) {
      useRouterStore.getState().navigate('dashboard')
    }
    if (!user && view !== 'login' && view !== 'register') {
      // Need to log in
      useRouterStore.getState().reset()
    }
  }, [user, view])

  return (
    <>
      <ServiceWorkerRegister />
      <AppShell>
        {view === 'login' && <LoginView />}
        {view === 'register' && <RegisterView />}
        {view === 'dashboard' && <DashboardView />}
        {view === 'project' && <ProjectView />}
        {view === 'plan-viewer' && <PlanViewerView />}
        {view === 'task-detail' && <TaskDetailView />}
        {view === 'profile' && <ProfileView />}
        {view === 'notifications' && <NotificationsView />}
      </AppShell>
    </>
  )
}
