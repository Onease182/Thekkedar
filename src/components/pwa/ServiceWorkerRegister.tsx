'use client'

import { useEffect } from 'react'
import { bootstrapSync } from '@/lib/client/sync'
import { useUiStore } from '@/stores/ui'
import { onConnectivityChange } from '@/lib/client/idb-offline'

/** Mounts once at app startup; registers SW + boots the sync loop. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    bootstrapSync()
    const off = onConnectivityChange((online) => {
      useUiStore.getState().setOnline(online)
      if (online) {
        useUiStore.getState().showToast({ title: 'Back online', description: 'Syncing queued changes…', variant: 'success' })
      } else {
        useUiStore.getState().showToast({ title: 'Offline', description: 'Changes will sync when you reconnect.', variant: 'warning' })
      }
    })
    // Register the service worker for PWA + offline shell caching.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // SW registration failure is non-fatal; offline-first IndexedDB still works.
      })
    }
    return () => { off() }
  }, [])
  return null
}
