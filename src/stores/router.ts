'use client'

import { create } from 'zustand'
import type { ViewName } from '@/lib/client/types'

interface RouterState {
  view: ViewName
  projectId?: string
  planId?: string
  taskId?: string
  // Stack for "back" navigation
  history: { view: ViewName; projectId?: string; planId?: string; taskId?: string }[]
  navigate: (view: ViewName, ctx?: { projectId?: string; planId?: string; taskId?: string }) => void
  back: () => void
  reset: () => void
}

function getInitialView(): ViewName {
  if (typeof window === 'undefined') return 'login'
  // Hash routing for back/forward + shareable URLs (limited to /#path)
  return 'login'
}

export const useRouterStore = create<RouterState>((set, get) => ({
  view: getInitialView(),
  history: [],
  navigate(view, ctx = {}) {
    const cur = { view: get().view, projectId: get().projectId, planId: get().planId, taskId: get().taskId }
    set((s) => ({
      view,
      projectId: ctx.projectId,
      planId: ctx.planId,
      taskId: ctx.taskId,
      history: [...s.history, cur],
    }))
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'auto' })
    }
  },
  back() {
    const h = get().history
    if (h.length === 0) {
      set({ view: 'dashboard' })
      return
    }
    const last = h[h.length - 1]
    set((s) => ({
      view: last.view,
      projectId: last.projectId,
      planId: last.planId,
      taskId: last.taskId,
      history: s.history.slice(0, -1),
    }))
  },
  reset() {
    set({ view: 'login', projectId: undefined, planId: undefined, taskId: undefined, history: [] })
  },
}))
