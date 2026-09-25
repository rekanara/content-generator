import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@workspace/ui/components/dialog"
import { api, ApiError } from "@/lib/api"
import { usePillars, useCron } from "@/lib/hooks"
import type { Pillar } from "@workspace/shared"

export function PillarsView({ slug }: { slug: string }) {
  const { data: pillars, error, loading, reload } = usePillars(slug)
  const { data: cron } = useCron(slug)
  const [form, setForm] = useState({ name: "", description: "", is_news: false, sort_order: 0 })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Pillar | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.addPillar(slug, form)
      setForm({ name: "", description: "", is_news: false, sort_order: 0 })
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to add pillar")
    } finally {
      setBusy(false)
    }
  }

  const saveCron = async (expr: string, enabled: boolean) => {
    try {
      await api.saveCron(slug, expr, enabled)
      setMsg(null)
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to save cron")
    }
  }

  if (loading && !pillars) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Pillars &amp; Schedule</h1>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      {cron && <CronEditor cron={cron} onSave={saveCron} />}

      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="pillar-name">Pillar name</Label>
          <Input id="pillar-name" placeholder="pillar name" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-desc">Description</Label>
          <Input id="pillar-desc" placeholder="description" required value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-news">News</Label>
          <div className="flex h-7 items-center">
            <Checkbox id="pillar-news" checked={form.is_news}
              onCheckedChange={(c) => setForm({ ...form, is_news: c === true })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-order">Order</Label>
          <Input id="pillar-order" type="number" placeholder="order" value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </div>
        <Button type="submit" disabled={busy} className="justify-self-start self-end">Add</Button>
      </form>

      <div className="divide-y rounded-lg border">
        {(pillars ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <button onClick={() => api.togglePillar(slug, p.id).then(reload)}>
              <Badge variant="secondary" className={p.active ? "bg-emerald-500/15 text-emerald-500 border-transparent" : ""}>
                {p.active ? "active" : "off"}
              </Badge>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name} {p.is_news && <span className="text-xs text-muted-foreground">(news)</span>}</p>
              <p className="truncate text-xs text-muted-foreground">{p.description}</p>
            </div>
            <span className="text-xs text-muted-foreground">#{p.sort_order}</span>
            <Button variant="ghost" size="icon" aria-label="edit" onClick={() => setEditing(p)}>
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="delete" onClick={() => api.delPillar(slug, p.id).then(reload)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {pillars?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no pillars yet</p>}
      </div>

      {editing && (
        <EditPillarDialog
          slug={slug}
          pillar={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}

function EditPillarDialog({ slug, pillar, onClose, onSaved }: {
  slug: string; pillar: Pillar; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: pillar.name, description: pillar.description,
    is_news: pillar.is_news, sort_order: pillar.sort_order,
  })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.patchPillar(slug, pillar.id, form)
      onSaved()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "failed to save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit pillar</DialogTitle>
          <DialogDescription>{pillar.active ? "active" : "inactive"} · rotation order follows creation time, not the order field</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Pillar name</Label>
            <Input id="edit-name" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Description</Label>
            <Input id="edit-desc" required value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-news">News pillar (needs RSS)</Label>
            <Checkbox id="edit-news" checked={form.is_news}
              onCheckedChange={(c) => setForm({ ...form, is_news: c === true })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-order">Order (display only)</Label>
            <Input id="edit-order" type="number" value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CronEditor({ cron, onSave }: { cron: { expr: string; enabled: boolean; running: boolean }; onSave: (expr: string, enabled: boolean) => void }) {
  const [expr, setExpr] = useState(cron.expr)
  const [enabled, setEnabled] = useState(cron.enabled)
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="cron-expr">Cron (5 fields, e.g. "0 7 * * *")</Label>
          <Input id="cron-expr" className="font-mono" value={expr} onChange={(e) => setExpr(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cron-enabled">Enabled</Label>
          <div className="flex h-7 items-center">
            <Checkbox id="cron-enabled" checked={enabled} onCheckedChange={(c) => setEnabled(c === true)} />
          </div>
        </div>
        <Button size="sm" onClick={() => onSave(expr, enabled)}>Save schedule</Button>
        <span className="pb-2 text-xs text-muted-foreground">status: {cron.running ? "running" : "stopped"}</span>
      </CardContent>
    </Card>
  )
}
