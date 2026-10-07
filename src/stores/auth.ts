'use client'

import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { apiPost, apiGet } from '@/lib/client/api'
import type { AuthUserFE } from '@/lib/client/types'

interface AuthState {
  user: AuthUserFE | null
  accessToken: string | null
  refreshToken: string | null
  expiresAt: number | null
  loading: boolean
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string, fullName: string, role?: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
  hydrate: () => Promise<void>
  clear: () => Promise<void>
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      expiresAt: null,
      loading: false,
      error: null,

      async login(email, password) {
        set({ loading: true, error: null })
        try {
          const data = await apiPost<{ user: AuthUserFE; accessToken: string; refreshToken: string; expiresAt: number }>('/auth/login', { email, password }, { noQueue: true })
          await setSession(data.user, data.accessToken, data.refreshToken, data.expiresAt)
          set({ loading: false })
        } catch (e) {
          set({ loading: false, error: (e as Error).message })
          throw e
        }
      },

      async register(email, password, fullName, role = 'engineer') {
        set({ loading: true, error: null })
        try {
          const data = await apiPost<{ user: AuthUserFE; accessToken: string; refreshToken: string; expiresAt: number }>('/auth/register', { email, password, fullName, role }, { noQueue: true })
          await setSession(data.user, data.accessToken, data.refreshToken, data.expiresAt)
          set({ loading: false })
        } catch (e) {
          set({ loading: false, error: (e as Error).message })
          throw e
        }
      },

      async logout() {
        // Best-effort: just clear local session. The refresh token remains in DB until it expires.
        await clearSession()
        set({ user: null, accessToken: null, refreshToken: null, expiresAt: null })
      },

      async refresh() {
        const rt = get().refreshToken
        if (!rt) return
        try {
          const data = await apiPost<{ user: AuthUserFE; accessToken: string; refreshToken: string; expiresAt: number }>('/auth/refresh', { refreshToken: rt }, { noQueue: true })
          await setSession(data.user, data.accessToken, data.refreshToken, data.expiresAt)
        } catch {
          await clearSession()
          set({ user: null, accessToken: null, refreshToken: null, expiresAt: null })
        }
      },

      async hydrate() {
        if (!get().accessToken) return
        try {
          const data = await apiGet<{ user: AuthUserFE }>('/auth/me')
          set({ user: data.user })
        } catch {
          await clearSession()
          set({ user: null, accessToken: null, refreshToken: null, expiresAt: null })
        }
      },

      async clear() {
        await clearSession()
        set({ user: null, accessToken: null, refreshToken: null, expiresAt: null, error: null })
      },
    }),
    {
      name: 'planforge-auth',
      storage: createJSONStorage(() => (typeof localStorage !== 'undefined' ? localStorage : (undefined as unknown as Storage))),
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken, expiresAt: s.expiresAt }),
    },
  ),
)

// Convenience accessors (callable outside React components)
export function getAccessToken(): string | null {
  return useAuthStore.getState().accessToken
}

export function getRefreshToken(): string | null {
  return useAuthStore.getState().refreshToken
}

export async function setSession(user: AuthUserFE, accessToken: string, refreshToken: string, expiresAt: number): Promise<void> {
  useAuthStore.setState({ user, accessToken, refreshToken, expiresAt })
}

export async function clearSession(): Promise<void> {
  useAuthStore.setState({ accessToken: null, refreshToken: null, expiresAt: null })
}
