// API client with offline awareness:
//  - When offline (or fetch fails), mutations are enqueued to IndexedDB.
//  - Optimistic UI updates handled by callers via the offline store.
//  - On reconnect, the sync worker flushes the queue.

import { getAccessToken, getRefreshToken, setSession, clearSession } from '@/stores/auth'
import { enqueueMutation, isOnline, isIdbAvailable, type QueueItem } from './idb-offline'

const API_BASE = '/api'

export class ApiError extends Error {
  status: number
  code: string
  details?: Record<string, unknown>
  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  // If true, never enqueue offline; throw instead (e.g. login/register must be online)
  noQueue?: boolean
  // The mutation's local id, used to match the optimistic UI item to the server row
  localId?: string
  // For multipart uploads queued as Blob
  multipart?: { field: string; file: File | Blob; fileName?: string; mimeType?: string }
  raw?: boolean // return Response as-is (for file downloads)
}

async function refreshAccessToken(): Promise<string | null> {
  const rt = getRefreshToken()
  if (!rt) return null
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    })
    if (!res.ok) {
      await clearSession()
      return null
    }
    const data = await res.json()
    await setSession(data.user, data.accessToken, data.refreshToken, data.expiresAt)
    return data.accessToken
  } catch {
    await clearSession()
    return null
  }
}

export async function apiCall<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET'
  const isMutation = method !== 'GET'

  // Offline path: queue mutation, throw a queued sentinel so callers can
  // show optimistic UI and not block.
  if (isMutation && isIdbAvailable() && !isOnline()) {
    if (opts.noQueue) {
      throw new ApiError(0, 'offline', 'You are offline. Please reconnect to perform this action.')
    }
    const item = await enqueueMutation({
      method,
      url: `${API_BASE}${path}`,
      body: opts.body,
      headers: opts.headers,
      localId: opts.localId,
      isMultipart: !!opts.multipart,
      multipartFieldName: opts.multipart?.field,
      multipartFileName: opts.multipart?.fileName,
      multipartMimeType: opts.multipart?.mimeType,
      blob: opts.multipart?.file,
    })
    throw new QueuedError(item)
  }

  // Online path (or GET regardless)
  let token = getAccessToken()
  const headers: Record<string, string> = {
    ...(opts.headers || {}),
  }
  if (opts.multipart) {
    // Don't set Content-Type — browser will set multipart boundary
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (token) headers['Authorization'] = `Bearer ${token}`

  const buildReq = (): Request => {
    if (opts.multipart) {
      const fd = new FormData()
      // Append additional body fields (e.g. title/description for plan uploads)
      // to the FormData. This mirrors the offline-replay logic in sync.ts that
      // also iterates item.body when replaying queued multipart mutations.
      if (opts.body && typeof opts.body === 'object') {
        for (const [k, v] of Object.entries(opts.body as Record<string, unknown>)) {
          if (v === undefined || v === null) continue
          fd.append(k, typeof v === 'string' ? v : JSON.stringify(v))
        }
      }
      fd.append(opts.multipart.field, opts.multipart.file, opts.multipart.fileName ?? 'file')
      return new Request(`${API_BASE}${path}`, {
        method,
        headers,
        body: fd,
        signal: opts.signal,
      })
    }
    return new Request(`${API_BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  }

  let res: Response
  try {
    res = await fetch(buildReq())
  } catch (e) {
    // Network failure while "online" — fall back to queue if mutation
    if (isMutation && isIdbAvailable() && !opts.noQueue) {
      const item = await enqueueMutation({
        method,
        url: `${API_BASE}${path}`,
        body: opts.body,
        headers: opts.headers,
        localId: opts.localId,
        isMultipart: !!opts.multipart,
        multipartFieldName: opts.multipart?.field,
        multipartFileName: opts.multipart?.fileName,
        multipartMimeType: opts.multipart?.mimeType,
        blob: opts.multipart?.file,
      })
      throw new QueuedError(item)
    }
    throw new ApiError(0, 'network_error', (e as Error).message || 'Network error')
  }

  // Token expired → try refresh once
  if (res.status === 401 && !path.startsWith('/auth/')) {
    const newToken = await refreshAccessToken()
    if (newToken) {
      headers['Authorization'] = `Bearer ${newToken}`
      res = await fetch(buildReq())
    }
  }

  if (opts.raw) {
    return res as unknown as T
  }

  let payload: unknown = null
  const ct = res.headers.get('content-type') || ''
  if (ct.includes('application/json')) {
    payload = await res.json()
  } else {
    payload = await res.text()
  }

  if (!res.ok) {
    const err = (payload as { error?: { code?: string; message?: string; details?: Record<string, unknown> } })?.error
    throw new ApiError(res.status, err?.code ?? 'unknown', err?.message ?? 'Request failed', err?.details)
  }

  return payload as T
}

// Sentinel for queued mutations; callers catch & show toast "Saved offline".
export class QueuedError extends Error {
  item: QueueItem
  constructor(item: QueueItem) {
    super('Queued for sync')
    this.name = 'QueuedError'
    this.item = item
  }
}

export function isQueuedError(e: unknown): e is QueuedError {
  return e instanceof QueuedError
}

export async function apiGet<T = unknown>(path: string, opts?: Pick<ApiOptions, 'signal'>): Promise<T> {
  return apiCall<T>(path, { ...opts, method: 'GET' })
}

export async function apiPost<T = unknown>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method' | 'body'>): Promise<T> {
  return apiCall<T>(path, { ...opts, method: 'POST', body })
}

export async function apiPatch<T = unknown>(path: string, body?: unknown, opts?: Omit<ApiOptions, 'method' | 'body'>): Promise<T> {
  return apiCall<T>(path, { ...opts, method: 'PATCH', body })
}

export async function apiDelete<T = unknown>(path: string, opts?: Omit<ApiOptions, 'method' | 'body'>): Promise<T> {
  return apiCall<T>(path, { ...opts, method: 'DELETE' })
}

// Build a URL for a file download that includes the auth token via Authorization header.
// Since fetch() needs to add the header, callers should use apiCall(path, { raw: true }).
export async function apiFetchBlob(path: string): Promise<Blob> {
  const res = await apiCall<Response>(path, { raw: true })
  return await res.blob()
}
