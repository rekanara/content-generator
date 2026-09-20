import { useState } from "react"
import { Plus } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@workspace/ui/components/dialog"
import { api, ApiError } from "@/lib/api"
import { useGroups } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import type { Group } from "@workspace/shared"

export function GroupsView() {
  const { data: groups, error, loading, reload } = useGroups()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ slug: "", name: "", cron: "0 7 * * *" })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.createGroup({ slug: form.slug, name: form.name, cron_expr: form.cron, cron_enabled: true })
      setOpen(false); setForm({ slug: "", name: "", cron: "0 7 * * *" })
      reload()
      navigate(`/app/${form.slug}/dashboard`)
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "gagal buat group")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Groups</h1>
          <p className="text-xs text-muted-foreground">satu group = satu akun/brand</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Group baru
        </Button>
      </section>

      {loading && !groups && <p className="text-sm text-muted-foreground">memuat…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
      {groups && groups.length === 0 && (
        <p className="text-sm text-muted-foreground">belum ada group — buat dulu.</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups?.map((g: Group) => (
          <button key={g.slug} className="text-left" onClick={() => navigate(`/app/${g.slug}/dashboard`)}>
            <Card className="transition-colors hover:border-primary/50">
              <CardContent className="space-y-1 p-4">
                <p className="font-medium">{g.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{g.slug}</p>
                <p className="text-xs text-muted-foreground">
                  {g.cron_enabled ? "cron aktif" : "cron off"} · {g.cron_expr}
                </p>
              </CardContent>
            </Card>
          </button>
        ))}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Group baru</DialogTitle>
            <DialogDescription>Satu group = satu brand. Konfigurasi lanjutan bisa di-patch setelah dibuat.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={submit}>
            <div className="space-y-1.5">
              <Label htmlFor="g-slug">Slug</Label>
              <Input id="g-slug" required value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="mis: akun-b" pattern="[a-z0-9][a-z0-9-]*" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-name">Nama</Label>
              <Input id="g-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="g-cron">Cron</Label>
              <Input id="g-cron" required value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} className="font-mono" />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? "membuat…" : "Buat"}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
