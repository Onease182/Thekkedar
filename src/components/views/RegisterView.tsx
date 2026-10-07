'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { Role } from '@/types'

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'project_manager', label: 'Project Manager' },
  { value: 'engineer', label: 'Engineer' },
  { value: 'foreman', label: 'Foreman' },
  { value: 'viewer', label: 'Viewer' },
]

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function RegisterView() {
  const register = useAuthStore((s) => s.register)
  const loading = useAuthStore((s) => s.loading)
  const error = useAuthStore((s) => s.error)
  const navigate = useRouterStore((s) => s.navigate)
  const showToast = useUiStore((s) => s.showToast)

  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('engineer')

  // Clear any stale auth error when the view mounts
  useEffect(() => {
    useAuthStore.setState({ error: null })
  }, [])

  const trimmedName = fullName.trim()
  const trimmedEmail = email.trim()
  const nameValid = trimmedName.length > 0
  const emailValid = EMAIL_RE.test(trimmedEmail)
  const passwordValid = password.length >= 8
  const formValid = nameValid && emailValid && passwordValid

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!formValid) return
    try {
      await register(trimmedEmail, password, trimmedName, role)
      showToast({ title: 'Account created', variant: 'success' })
      navigate('dashboard')
    } catch {
      // error already surfaced via the store
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
            <CardTitle className="text-2xl text-zinc-900">Create your account</CardTitle>
            <CardDescription>Join PlanForge to manage plans &amp; tasks</CardDescription>
          </CardHeader>

          <form onSubmit={handleSubmit} noValidate>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="fullName">Full name</Label>
                <Input
                  id="fullName"
                  type="text"
                  autoComplete="name"
                  placeholder="Jane Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  aria-required="true"
                  aria-invalid={!nameValid && fullName.length > 0}
                />
                {fullName.length > 0 && !nameValid && (
                  <p className="text-xs text-red-600">Name is required.</p>
                )}
              </div>

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
                  aria-invalid={!emailValid && email.length > 0}
                />
                {email.length > 0 && !emailValid && (
                  <p className="text-xs text-red-600">Enter a valid email address.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  aria-required="true"
                  aria-invalid={!passwordValid && password.length > 0}
                />
                {password.length > 0 && !passwordValid && (
                  <p className="text-xs text-red-600">Password must be at least 8 characters.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue placeholder="Select a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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
                disabled={loading || !formValid}
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <UserPlus className="h-4 w-4" />
                )}
                {loading ? 'Creating…' : 'Create account'}
              </Button>
            </CardContent>
          </form>

          <CardFooter className="justify-center">
            <p className="text-sm text-zinc-600 text-center">
              Already have an account?{' '}
              <button
                type="button"
                onClick={() => navigate('login')}
                className="font-medium text-zinc-900 hover:underline"
              >
                Sign in
              </button>
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
