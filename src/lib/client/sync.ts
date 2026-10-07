// Sync worker: flushes the IndexedDB mutation queue to the server when online.
// Runs in the main thread (no separate worker) — simple, works without extra setup.
// Triggered by: window 'planforge:try-sync' events, manual calls, and periodic timer.

import { listPendingQueue, updateQueueItem, deleteQueueItem, type QueueItem } from './idb-offline'
import { getAccessToken, getRefreshToken, setSession, clearSession } from '@/stores/auth'
import { useUiStore } from '@/stores/ui'

const API_BASE = '/api'

let syncing = false
let timer: ReturnType<typeof setInterval> | null = null

export async function flushQueue(): Promise<void> {
  if (syncing) return
  if (typeof navigator !== 'undefined' && !navigator.onLine) return
  syncing = true
  useUiStore.getState().setSyncing(true)
  try {
    const items = await listPendingQueue()
    for (const item of items) {
      if (item.status === 'synced' || item.status === 'in-flight') continue
      await updateQueueItem(item.id, { status: 'in-flight' })
      try {
        const headers: Record<string, string> = { ...(item.headers || {}) }
        let token = getAccessToken()
        // Refresh if close to expiry
        if (token) headers['Authorization'] = `Bearer ${token}`

        let body: BodyInit | undefined
        if (item.isMultipart && item.blob) {
          const fd = new FormData()
          fd.append(item.multipartFieldName || 'file', item.blob, item.multipartFileName ?? 'file.bin')
          if (item.body && typeof item.body === 'object') {
            for (const [k, v] of Object.entries(item.body as Record<string, unknown>)) {
              fd.append(k, typeof v === 'string' ? v : JSON.stringify(v))
            }
          }
          body = fd
        } else if (item.body !== undefined) {
          headers['Content-Type'] = 'application/json'
          body = JSON.stringify(item.body)
        }

        let res: Response
        try {
          res = await fetch(`${API_BASE}${item.url.replace(API_BASE, '')}`, {
            method: item.method,
            headers,
            body,
          })
        } catch (netErr) {
          // Network failed → requeue with backoff
          await updateQueueItem(item.id, {
            status: 'pending',
            retryCount: item.retryCount + 1,
            lastError: (netErr as Error).message,
          })
          continue
        }

        // Refresh token if 401
        if (res.status === 401 && !item.url.includes('/auth/')) {
          const rt = getRefreshToken()
          if (rt) {
            try {
              const r = await fetch(`${API_BASE}/auth/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: rt }),
              })
              if (r.ok) {
                const data = await r.json()
                await setSession(data.user, data.accessToken, data.refreshToken, data.expiresAt)
                // retry the original request
                headers['Authorization'] = `Bearer ${data.accessToken}`
                res = await fetch(`${API_BASE}${item.url.replace(API_BASE, '')}`, { method: item.method, headers, body })
              } else {
                await clearSession()
              }
            } catch {
              await clearSession()
            }
          }
        }

        if (res.status >= 200 && res.status < 300) {
          await deleteQueueItem(item.id)
        } else if (res.status === 404 || res.status === 409) {
          // Permanent failures (e.g. already deleted, already synced) — drop
          await deleteQueueItem(item.id)
        } else if (res.status >= 400 && res.status < 500) {
          // Other 4xx — permanent; drop but log
          await updateQueueItem(item.id, {
            status: 'failed-permanent',
            lastError: `HTTP ${res.status}`,
          })
        } else {
          // 5xx → retry later
          await updateQueueItem(item.id, {
            status: 'pending',
            retryCount: item.retryCount + 1,
            lastError: `HTTP ${res.status}`,
          })
        }
      } catch (e) {
        await updateQueueItem(item.id, {
          status: 'pending',
          retryCount: item.retryCount + 1,
          lastError: (e as Error).message,
        })
      }
    }
    // Broadcast queue change so UI updates
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('planforge:queue-changed'))
      window.dispatchEvent(new CustomEvent('planforge:synced'))
    }
    useUiStore.getState().markSynced()
  } finally {
    syncing = false
    useUiStore.getState().setSyncing(false)
  }
}

let bootstrapped = false
export function bootstrapSync(): void {
  if (bootstrapped) return
  bootstrapped = true
  if (typeof window === 'undefined') return
  window.addEventListener('planforge:try-sync', () => { void flushQueue() })
  window.addEventListener('online', () => { void flushQueue() })
  // Periodic background sync (every 30s when online)
  timer = setInterval(() => {
    if (navigator.onLine) void flushQueue()
  }, 30_000)
  // Initial flush
  setTimeout(() => { void flushQueue() }, 1500)
}

export function stopSync(): void {
  if (timer) clearInterval(timer)
  timer = null
  bootstrapped = false
}
