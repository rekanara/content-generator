import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { api, ApiError } from "@/lib/api"

import type { AuthMe } from "@workspace/shared"

export function LoginView({ onLogin }: { onLogin: (u: AuthMe) => void }) {
  const [form, setForm] = useState({ username: "", password: "" })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      const r = await api.login(form.username, form.password)
      onLogin(r.user)
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "login failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>content-generator</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="login-user">Username</Label>
              <Input id="login-user" required autoComplete="username"
                value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="login-pass">Password</Label>
              <Input id="login-pass" type="password" required autoComplete="current-password"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "checking…" : "Sign in"}</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
