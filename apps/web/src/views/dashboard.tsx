import { useState } from "react"
import { Play, RefreshCw, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@workspace/ui/components/select"
import { api, ApiError } from "@/lib/api"
import { useDashboard, useCalendar, usePlans, usePillars, useTemplates } from "@/lib/hooks"
import { PipelineProgress } from "@/components/pipeline-progress.tsx"

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-blue-500/15 text-blue-500 border-transparent",
  draft: "bg-muted text-muted-foreground border-transparent",
  rendered: "bg-amber-500/15 text-amber-500 border-transparent",
  awaiting_approval: "bg-violet-500/15 text-violet-500 border-transparent",
  sent: "bg-emerald-500/15 text-emerald-500 border-transparent",
  failed: "bg-red-500/15 text-red-500 border-transparent",
  rejected: "bg-zinc-500/15 text-zinc-500 border-transparent",
}

export function DashboardView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useDashboard(slug)
  const { data: calendar } = useCalendar(slug)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const gen = async (opts?: { platform?: string; format?: string }) => {
    setBusy(true); setMsg(null)
    try {
      await api.gen(slug, opts)
      setMsg("queued — pipeline progress below")
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "failed")
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
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
            <Play className="size-4" /> {busy ? "sending…" : "Generate now"}
          </Button>
        </div>
      </section>

      {msg && <p className="text-muted-foreground text-sm">{msg}</p>}

      <PipelineProgress onFinished={reload} />

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Cron" value={cron.enabled ? cron.expr : "off"} sub={cron.running ? "running" : "stopped"} mono />
        <Stat label="Queue" value={queue.running ? "active" : "idle"} sub={`${queue.pending} pending`} />
        <Stat label="Last rotation" value={rotation.last_platform} sub={rotation.updated_at ? new Date(rotation.updated_at).toLocaleString("en-US") : "—"} />
        <Stat label="Next slot" value={`${next_slot.platform}/${next_slot.format}`} sub={`pillar #${next_slot.pillar_id}`} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Next runs</h2>
        <div className="divide-y rounded-lg border">
          {(calendar ?? []).length === 0 && <p className="p-4 text-sm text-muted-foreground">no active pillars</p>}
          {(calendar ?? []).map((r, i) => (
            <div key={i} className="flex items-center gap-3 p-3 text-sm">
              <span className="w-36 shrink-0 text-xs text-muted-foreground">
                {r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
              </span>
              <span className="w-28 shrink-0">{r.platform}/{r.format}</span>
              <span className="min-w-0 flex-1 truncate">{r.pillar_name}</span>
              {r.planned && (
                <span className={"shrink-0 rounded-md px-1.5 py-0.5 text-xs " +
                  (r.planned.type === "override_content"
                    ? "bg-violet-500/15 text-violet-500"
                    : "bg-sky-500/15 text-sky-500")}>
                  {r.planned.type === "override_content" ? "override" : "plan"}
                  {r.planned.note ? ` · ${r.planned.note.slice(0, 24)}` : ""}
                </span>
              )}
            </div>
          ))}
        </div>
      </section>

      <PlansSection slug={slug} />

      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">Last 10 posts</h2>
        <div className="divide-y rounded-lg border">
          {last_posts.length === 0 && <p className="p-4 text-sm text-muted-foreground">no posts yet</p>}
          {last_posts.map((p) => (
            <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
              <Badge variant="secondary" className={STATUS_BADGE[p.status]}>{p.status}</Badge>
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

function Stat({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={"truncate text-sm font-medium" + (mono ? " font-mono" : "")}>{value}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ——— plans: pin a date's pipeline spec (platform/format/pillar/template) ———
function PlansSection({ slug }: { slug: string }) {
  const { data: plans, reload } = usePlans(slug)
  const { data: pillars } = usePillars(slug)
  const { data: templates } = useTemplates(slug)
  const [form, setForm] = useState({ for_date: "", platform: "natural", format: "natural", pillar_id: "natural", template_id: "natural", note: "" })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.addPlan(slug, {
        for_date: form.for_date,
        platform: form.platform === "natural" ? null : form.platform as "instagram" | "linkedin",
        format: form.format === "natural" ? null : form.format as "carousel" | "reels" | "pdf" | "text",
        pillar_id: form.pillar_id === "natural" ? null : form.pillar_id,
        template_id: form.template_id === "natural" ? null : form.template_id,
        note: form.note,
      })
      setForm({ for_date: "", platform: "natural", format: "natural", pillar_id: "natural", template_id: "natural", note: "" })
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to create plan")
    } finally {
      setBusy(false)
    }
  }

  const active = (plans ?? []).filter((p) => p.status === "active").slice(0, 8)

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">Plans — pin a date's run</h2>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}
      <div className="divide-y rounded-lg border">
        {active.map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{p.for_date}</span>
            <Badge variant="outline">{p.type === "override_content" ? "override" : "slot"}</Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {p.type === "slot_override"
                ? [p.platform, p.format].filter(Boolean).join("/") || "natural"
                : "manual content"}
              {p.note ? ` · ${p.note}` : ""}
            </span>
            {p.type === "slot_override" && (
              <Button variant="ghost" size="icon" aria-label="cancel plan" title="Cancel — date returns to natural rotation"
                onClick={() => api.cancelPlan(slug, p.id).then(reload)}>
                <X className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {active.length === 0 && <p className="p-4 text-sm text-muted-foreground">no active plans — runs follow natural rotation</p>}
      </div>

      <form onSubmit={submit} className="grid gap-3 rounded-lg border p-3 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="plan-date">Date</Label>
          <Input id="plan-date" type="date" required value={form.for_date}
            onChange={(e) => setForm({ ...form, for_date: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>Platform</Label>
          <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v, format: "natural" })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">natural (rotation)</SelectItem>
              <SelectItem value="instagram">instagram</SelectItem>
              <SelectItem value="linkedin">linkedin</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Format</Label>
          <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">natural (rotation)</SelectItem>
              {["carousel", "reels", "pdf", "text"].map((f) => (
                <SelectItem key={f} value={f}>{f}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Pillar</Label>
          <Select value={form.pillar_id} onValueChange={(v) => setForm({ ...form, pillar_id: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">natural (rotation)</SelectItem>
              {(pillars ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Template</Label>
          <Select value={form.template_id} onValueChange={(v) => setForm({ ...form, template_id: v })}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="natural">active per format</SelectItem>
              {(templates ?? []).map((t) => (
                <SelectItem key={t.id} value={t.id}>{t.name} · {t.type}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="plan-note">Note (optional)</Label>
          <div className="flex gap-2">
            <Input id="plan-note" placeholder="e.g. github repo recommendations" value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <Button type="submit" disabled={busy || !form.for_date}>{busy ? "…" : "Pin"}</Button>
          </div>
        </div>
      </form>
    </section>
  )
}
