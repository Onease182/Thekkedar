'use client'

import { create } from 'zustand'
import { isOnline, onConnectivityChange, countPendingQueue } from '@/lib/client/idb-offline'

interface UiState {
  online: boolean
  pendingCount: number
  syncing: boolean
  lastSyncAt: number | null
  setOnline: (b: boolean) => void
  setPending: (n: number) => void
  setSyncing: (b: boolean) => void
  markSynced: () => void
  refreshPending: () => Promise<void>
  toast: { id: string; title: string; description?: string; variant: 'default' | 'success' | 'error' | 'warning' } | null
  showToast: (t: { title: string; description?: string; variant?: 'default' | 'success' | 'error' | 'warning' }) => void
  clearToast: () => void
}

export const useUiStore = create<UiState>((set) => ({
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  pendingCount: 0,
  syncing: false,
  lastSyncAt: null,
  setOnline: (b) => set({ online: b }),
  setPending: (n) => set({ pendingCount: n }),
  setSyncing: (b) => set({ syncing: b }),
  markSynced: () => set({ syncing: false, lastSyncAt: Date.now() }),
  async refreshPending() {
    try {
      const n = await countPendingQueue()
      set({ pendingCount: n })
    } catch {
      // ignore
    }
  },
  toast: null,
  showToast(t) {
    const id = Math.random().toString(36).slice(2)
    set({ toast: { id, variant: 'default', ...t } })
    setTimeout(() => {
      if (useUiStore.getState().toast?.id === id) set({ toast: null })
    }, 3500)
  },
  clearToast: () => set({ toast: null }),
}))

if (typeof window !== 'undefined') {
  onConnectivityChange((online) => {
    useUiStore.getState().setOnline(online)
    if (online) {
      // Trigger a sync attempt via a window event the SW registration listens to
      window.dispatchEvent(new CustomEvent('planforge:try-sync'))
    }
  })
  // Refresh pending count on storage events
  window.addEventListener('planforge:queue-changed', () => {
    useUiStore.getState().refreshPending()
  })
  // Initial count
  useUiStore.getState().refreshPending()
}
