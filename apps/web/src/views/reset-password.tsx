import { useState } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { api, ApiError } from "@/lib/api"
import { useApi } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import type { UserRow } from "@workspace/shared"

export function ResetPasswordView({ id }: { id: string }) {
  const { data: users } = useApi<UserRow[]>(api.users)
  const user = users?.find((u) => u.id === id)
  const [pass, setPass] = useState("")
  const [pass2, setPass2] = useState("")
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pass !== pass2) { setMsg("passwords do not match"); return }
    setBusy(true); setMsg(null)
    try {
      await api.resetUserPass(id, pass)
      setMsg("password changed — all that user's sessions are revoked")
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to change password")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="back" onClick={() => navigate("/app/users")}>
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-lg font-semibold">Reset password — {user?.username ?? `id ${id}`}</h1>
          <p className="text-xs text-muted-foreground">password min 8 chars; the user's sessions are revoked immediately</p>
        </div>
      </section>

      <Card>
        <CardContent className="p-4">
          <form className="max-w-sm space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="np1">New password</Label>
              <Input id="np1" type="password" required minLength={8} value={pass}
                onChange={(e) => setPass(e.target.value)} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="np2">Repeat</Label>
              <Input id="np2" type="password" required minLength={8} value={pass2}
                onChange={(e) => setPass2(e.target.value)} autoComplete="new-password" />
            </div>
            {msg && <p className="text-sm text-muted-foreground">{msg}</p>}
            <Button type="submit" disabled={busy || pass.length < 8 || pass !== pass2}>
              {busy ? "saving…" : "Change password"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
