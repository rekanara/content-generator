import { useState } from "react"
import { Play, RefreshCw } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { api, ApiError } from "@/lib/api"
import { useDashboard } from "@/lib/hooks"

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  queued: "bg-blue-500/15 text-blue-500",
  rendered: "bg-amber-500/15 text-amber-500",
  sent: "bg-emerald-500/15 text-emerald-500",
  failed: "bg-red-500/15 text-red-500",
}

export function DashboardView() {
  const { data, error, loading, reload } = useDashboard()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const gen = async (opts?: { platform?: string; format?: string }) => {
    setBusy(true); setMsg(null)
    try {
      await api.gen(opts)
      setMsg("generate diantrikan — cek tab Posts")
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "gagal")
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">memuat…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!data) return null

  const { cron, queue, rotation, next_slot, last_posts } = data
  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={reload}><RefreshCw className="size-4" /></Button>
          <Button size="sm" disabled={busy} onClick={() => gen()}>
            <Play className="size-4" /> {busy ? "mengirim…" : "Generate sekarang"}
          </Button>
        </div>
      </section>

      {msg && <p className="text-muted-foreground text-sm">{msg}</p>}

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Cron" value={cron.enabled ? cron.expr : "off"} sub={cron.running ? "berjalan" : "berhenti"} />
        <Card label="Queue" value={queue.running ? "aktif" : "idle"} sub={`${queue.pending} pending`} />
        <Card label="Rotasi terakhir" value={rotation.last_platform} sub={rotation.updated_at ? new Date(rotation.updated_at).toLocaleString("id-ID") : "—"} />
        <Card label="Slot berikut" value={`${next_slot.platform}/${next_slot.format}`} sub={`pillar #${next_slot.pillar_id}`} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">10 post terakhir</h2>
        <div className="divide-y rounded-lg border">
          {last_posts.length === 0 && <p className="p-4 text-sm text-muted-foreground">belum ada post</p>}
          {last_posts.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <span className={"rounded-full px-2 py-0.5 text-xs " + (STATUS_COLORS[p.status] ?? "")}>{p.status}</span>
              <span className="w-24 shrink-0 text-muted-foreground">{p.platform}/{p.format}</span>
              <span className="min-w-0 flex-1 truncate">{p.topic}</span>
              <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{p.source}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function Card({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value}</p>
      {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
    </div>
  )
}
