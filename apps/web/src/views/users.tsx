import { useState } from "react"
import { KeyRound, Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/components/select"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@workspace/ui/components/dialog"
import { api, ApiError } from "@/lib/api"
import { useApi } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import type { UserRow } from "@workspace/shared"

export function UsersView() {
  const { data: users, error, loading, reload } = useApi<UserRow[]>(api.users)
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ username: "", password: "", role: "user" })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<number | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.addUser({ username: form.username, password: form.password, role: form.role as 'admin' | 'user' })
      setOpen(false); setForm({ username: "", password: "", role: "user" })
      reload()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "gagal buat user")
    } finally {
      setBusy(false)
    }
  }

  const del = async (id: string) => {
    try {
      await api.delUser(id)
      setConfirmDel(null)
      reload()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "gagal hapus user")
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Users</h1>
          <p className="text-xs text-muted-foreground">kelola akun login (admin)</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> User baru
        </Button>
      </section>

      {err && <p className="text-sm text-destructive">{err}</p>}
      {loading && !users && <p className="text-sm text-muted-foreground">memuat…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        {users?.map((u) => (
          <Card key={u.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div>
                <p className="text-sm font-medium">
                  {u.username}
                  <span className="ml-2 text-xs text-muted-foreground">{u.role}</span>
                </p>
                <p className="text-xs text-muted-foreground">id: {u.id}</p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => navigate(`/app/users/${u.id}/reset-password`)}>
                  <KeyRound className="size-4" /> Password
                </Button>
                {confirmDel === u.id ? (
                  <div className="flex gap-2">
                    <Button variant="destructive" size="sm" disabled={busy} onClick={() => del(u.id)}>Yakin</Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDel(null)}>Batal</Button>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setConfirmDel(u.id)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>User baru</DialogTitle>
            <DialogDescription>Username 2-32 char [a-z0-9_-], password minimal 8.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Username</Label>
              <Input id="u-name" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                pattern="[a-z0-9_-]{2,32}" autoComplete="off" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-pass">Password</Label>
              <Input id="u-pass" type="password" required minLength={8} value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" />
            </div>
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="admin">admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? "membuat…" : "Buat"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
