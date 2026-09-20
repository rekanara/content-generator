import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import { api, ApiError } from "@/lib/api"
import { usePillars, useCron } from "@/lib/hooks"

export function PillarsView({ slug }: { slug: string }) {
  const { data: pillars, error, loading, reload } = usePillars(slug)
  const { data: cron } = useCron(slug)
  const [form, setForm] = useState({ name: "", description: "", is_news: false, sort_order: 0 })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.addPillar(slug, form)
      setForm({ name: "", description: "", is_news: false, sort_order: 0 })
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "gagal menambah pillar")
    } finally {
      setBusy(false)
    }
  }

  const saveCron = async (expr: string, enabled: boolean) => {
    try {
      await api.saveCron(slug, expr, enabled)
      setMsg(null)
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "gagal simpan cron")
    }
  }

  if (loading && !pillars) return <p className="text-muted-foreground text-sm">memuat…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Pillars &amp; Jadwal</h1>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      {cron && <CronEditor cron={cron} onSave={saveCron} />}

      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="pillar-name">Nama pillar</Label>
          <Input id="pillar-name" placeholder="nama pillar" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-desc">Deskripsi</Label>
          <Input id="pillar-desc" placeholder="deskripsi" required value={form.description}
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
          <Label htmlFor="pillar-order">Urutan</Label>
          <Input id="pillar-order" type="number" placeholder="urutan" value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </div>
        <Button type="submit" disabled={busy} className="justify-self-start self-end">Tambah</Button>
      </form>

      <div className="divide-y rounded-lg border">
        {(pillars ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <button onClick={() => api.togglePillar(slug, p.id).then(reload)}>
              <Badge variant="secondary" className={p.active ? "bg-emerald-500/15 text-emerald-500 border-transparent" : ""}>
                {p.active ? "aktif" : "off"}
              </Badge>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name} {p.is_news && <span className="text-xs text-muted-foreground">(news)</span>}</p>
              <p className="truncate text-xs text-muted-foreground">{p.description}</p>
            </div>
            <span className="text-xs text-muted-foreground">#{p.sort_order}</span>
            <Button variant="ghost" size="icon" aria-label="hapus" onClick={() => api.delPillar(slug, p.id).then(reload)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {pillars?.length === 0 && <p className="p-4 text-sm text-muted-foreground">belum ada pillar</p>}
      </div>
    </div>
  )
}

function CronEditor({ cron, onSave }: { cron: { expr: string; enabled: boolean; running: boolean }; onSave: (expr: string, enabled: boolean) => void }) {
  const [expr, setExpr] = useState(cron.expr)
  const [enabled, setEnabled] = useState(cron.enabled)
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="cron-expr">Cron (5 field, cth "0 7 * * *")</Label>
          <Input id="cron-expr" className="font-mono" value={expr} onChange={(e) => setExpr(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cron-enabled">Aktif</Label>
          <div className="flex h-7 items-center">
            <Checkbox id="cron-enabled" checked={enabled} onCheckedChange={(c) => setEnabled(c === true)} />
          </div>
        </div>
        <Button size="sm" onClick={() => onSave(expr, enabled)}>Simpan jadwal</Button>
        <span className="pb-2 text-xs text-muted-foreground">status: {cron.running ? "berjalan" : "berhenti"}</span>
      </CardContent>
    </Card>
  )
}
