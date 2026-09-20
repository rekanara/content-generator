import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { api, ApiError } from "@/lib/api"
import { usePillars, useCron } from "@/lib/hooks"

export function PillarsView() {
  const { data: pillars, error, loading, reload } = usePillars()
  const { data: cron } = useCron()
  const [form, setForm] = useState({ name: "", description: "", is_news: false, sort_order: 0 })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.addPillar(form)
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
      await api.saveCron(expr, enabled)
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

      <form onSubmit={submit} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_1fr_auto]">
        <input
          className="input" placeholder="nama pillar" required value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <input
          className="input" placeholder="deskripsi" required value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
        />
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox" checked={form.is_news}
            onChange={(e) => setForm({ ...form, is_news: e.target.checked })}
          /> news
        </label>
        <input
          className="input" type="number" placeholder="urutan" value={form.sort_order}
          onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })}
        />
        <Button type="submit" disabled={busy} className="justify-self-start">Tambah</Button>
      </form>

      <div className="divide-y rounded-lg border">
        {(pillars ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <button
              onClick={() => api.togglePillar(p.id).then(reload)}
              className={"rounded-full px-2 py-0.5 text-xs " + (p.active ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")}
            >
              {p.active ? "aktif" : "off"}
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name} {p.is_news && <span className="text-xs text-muted-foreground">(news)</span>}</p>
              <p className="truncate text-xs text-muted-foreground">{p.description}</p>
            </div>
            <span className="text-xs text-muted-foreground">#{p.sort_order}</span>
            <Button variant="ghost" size="icon" aria-label="hapus" onClick={() => api.delPillar(p.id).then(reload)}>
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
    <div className="flex flex-wrap items-end gap-3 rounded-lg border p-4">
      <label className="text-sm">
        <span className="mb-1 block text-xs text-muted-foreground">Cron (5 field, cth "0 7 * * *")</span>
        <input className="input font-mono" value={expr} onChange={(e) => setExpr(e.target.value)} />
      </label>
      <label className="flex items-center gap-2 pb-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> aktif
      </label>
      <Button size="sm" className="mb-1.5" onClick={() => onSave(expr, enabled)}>Simpan jadwal</Button>
      <span className="pb-2 text-xs text-muted-foreground">status: {cron.running ? "berjalan" : "berhenti"}</span>
    </div>
  )
}
