'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, LogIn } from 'lucide-react'
import { useAuthStore } from '@/stores/auth'
import { useRouterStore } from '@/stores/router'
import { useUiStore } from '@/stores/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const DEMO_EMAIL = 'demo@planforge.app'
const DEMO_PASSWORD = 'password123'

export function LoginView() {
  const login = useAuthStore((s) => s.login)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const navigate = useRouterStore((s) => s.navigate)
  const showToast = useUiStore((s) => s.showToast)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  // Clear any stale auth error when the view mounts
  useEffect(() => {
    useAuthStore.setState({ error: null })
  }, [])

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await login(email.trim(), password)
      showToast({ title: 'Welcome back', variant: 'success' })
      navigate('dashboard')
    } catch {
      // error already surfaced via the store
    }
  }

  const tryDemo = async () => {
    setEmail(DEMO_EMAIL)
    setPassword(DEMO_PASSWORD)
    try {
      await login(DEMO_EMAIL, DEMO_PASSWORD)
      showToast({ title: 'Signed in as demo engineer', variant: 'success' })
      navigate('dashboard')
    } catch {
      // error surfaced via the store
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 px-4 py-8">
      <div className="w-full max-w-md">
        <Card className="shadow-md">
          <CardHeader className="text-center space-y-2">
            <div className="mx-auto h-11 w-11 rounded-lg bg-zinc-900 text-white grid place-items-center text-sm font-bold">
              PF
            </div>
            <CardTitle className="text-2xl text-zinc-900">PlanForge</CardTitle>
            <CardDescription>Construction plans &amp; tasks, offline-first</CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  aria-required="true"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-required="true"
                />
              </div>

              {error && (
                <div
                  role="alert"
                  className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
                >
                  {error}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={loading || !email.trim() || !password}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogIn className="h-4 w-4" />
                )}
                {loading ? 'Signing in…' : 'Sign in'}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={tryDemo}
                disabled={loading}
              >
                Try demo account
              </Button>
            </CardContent>
          </form>

          <CardFooter className="justify-center">
            <p className="text-sm text-zinc-600 text-center">
              Don&apos;t have an account?{' '}
              <button
                type="button"
                onClick={() => navigate('register')}
                className="font-medium text-zinc-900 hover:underline"
              >
                Sign up
              </button>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
