import { useEffect, type ReactNode } from "react"
import { CalendarDaysIcon, CheckCircle2Icon, Clock3Icon, NewspaperIcon, RadioIcon, RouteIcon, SparklesIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Badge } from "@workspace/ui/components/badge"
import { api } from "@/lib/api"
import { useApi, useCalendar, useNewsTopics, usePlans, usePosts } from "@/lib/hooks"
import { navigate } from "@/lib/router"

const STAGES = ["slot", "ideation", "writer", "critic", "render", "telegram", "sent"]

export function StudioView({ slug }: { slug: string }) {
  const live = useApi(() => api.queueLive(), [])
  const calendar = useCalendar(slug)
  const plans = usePlans(slug)
  const news = useNewsTopics(slug)
  const posts = usePosts(slug)

  useEffect(() => {
    const id = window.setInterval(() => live.reload(), 2500)
    return () => window.clearInterval(id)
  }, [live.reload])

  const run = live.data?.run
  const activeStage = run?.stage ?? "idle"
  const activeIndex = Math.max(0, STAGES.indexOf(activeStage))
  const activePlans = (plans.data ?? []).filter((p) => p.status === "active").slice(0, 5)
  const awaiting = (posts.data ?? []).filter((p) => p.status === "awaiting_approval" || p.status === "awaiting_cover").slice(0, 5)
  const newsReady = (news.data ?? []).filter((n) => n.source_count > 0).slice(0, 6)
  const flowing = !!run?.active
  const graphNodes = [
    { id: "plans", label: "Plans", sub: `${activePlans.length} active`, x: 18, y: 22, tone: "sky" as const },
    { id: "news", label: "News", sub: `${newsReady.length} topics`, x: 82, y: 24, tone: "amber" as const },
    { id: "queue", label: "Queue", sub: `${live.data?.queue.pending ?? 0} pending`, x: 18, y: 76, tone: "emerald" as const },
    { id: "telegram", label: "Telegram", sub: awaiting.length ? `${awaiting.length} waiting` : "approval", x: 82, y: 76, tone: "rose" as const },
  ]

  return (
    <div className="space-y-6">
      <section className="relative overflow-hidden rounded-3xl border bg-zinc-950 p-6 text-white shadow-2xl">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(34,197,94,.25),transparent_30%),radial-gradient(circle_at_80%_0%,rgba(56,189,248,.22),transparent_28%),linear-gradient(135deg,rgba(255,255,255,.08),transparent_35%)]" />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="readout text-xs uppercase tracking-[0.35em] text-emerald-300">AI content studio</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{run?.active ? run.kind : "standby"}</h1>
            <p className="mt-2 max-w-2xl text-sm text-zinc-300">Visual source of truth for the queue, plans, news, and the generate run in progress.</p>
          </div>
          <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
            <p className="text-xs uppercase tracking-widest text-zinc-400">queue</p>
            <p className="text-2xl font-semibold">{live.data?.queue.running ? "running" : "idle"}</p>
            <p className="text-xs text-zinc-400">{live.data?.queue.pending ?? 0} pending</p>
          </div>
        </div>
        <div className="relative mt-8 overflow-hidden rounded-[2rem] border border-white/10 bg-black/30 p-4 shadow-inner">
          <style>{`@keyframes studio-dash{to{stroke-dashoffset:-28}}@keyframes studio-orbit{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}`}</style>
          <div className="relative h-[360px] md:h-[430px]">
            <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <defs>
                <radialGradient id="studioHub" cx="50%" cy="50%" r="50%"><stop offset="0%" stopColor="#6ee7b7" stopOpacity="0.8"/><stop offset="100%" stopColor="#38bdf8" stopOpacity="0"/></radialGradient>
              </defs>
              <circle cx="50" cy="50" r="28" fill="url(#studioHub)" opacity="0.25" />
              {graphNodes.map((n) => (
                <line key={n.id} x1="50" y1="50" x2={n.x} y2={n.y} stroke={flowing ? "#6ee7b7" : "rgba(255,255,255,.18)"} strokeWidth="0.55" strokeLinecap="round" strokeDasharray="4 4" style={flowing ? { animation: "studio-dash 1.1s linear infinite" } : undefined} />
              ))}
            </svg>
            <div className="absolute left-1/2 top-1/2 grid size-36 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-emerald-300/50 bg-zinc-950/80 text-center shadow-[0_0_80px_rgba(52,211,153,.35)] backdrop-blur" style={flowing ? { animation: "studio-orbit 2.4s ease-in-out infinite" } : undefined}>
              <div>
                <p className="readout text-[0.65rem] uppercase tracking-[0.28em] text-emerald-300">hub</p>
                <p className="mt-1 text-lg font-semibold">{activeStage}</p>
                <p className="mt-1 text-[0.68rem] text-zinc-400">{run?.kind ?? "idle"}</p>
              </div>
            </div>
            {graphNodes.map((n) => <GraphNode key={n.id} node={n} flowing={flowing} />)}
          </div>
          <div className="grid gap-2 border-t border-white/10 pt-4 md:grid-cols-7">
            {STAGES.map((s, i) => (
              <div key={s} className={`rounded-xl border px-3 py-2 ${run?.active && i <= activeIndex ? "border-emerald-300/60 bg-emerald-300/15" : "border-white/10 bg-white/5"}`}>
                <p className="text-xs font-medium capitalize">{s}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
          <p className="text-sm text-zinc-300"><span className="text-white">{activeStage}</span>{run?.detail ? ` · ${run.detail}` : " · waiting for new work"}</p>
          {run?.postId && <p className="mt-1 text-xs text-zinc-500">post #{run.postId}</p>}
          {run?.error && <p className="mt-2 text-sm text-red-300">{run.error}</p>}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Metric icon={<RouteIcon className="size-4" />} label="Upcoming" value={calendar.data?.length ?? 0} tone="emerald" />
        <Metric icon={<SparklesIcon className="size-4" />} label="Active plans" value={activePlans.length} tone="sky" />
        <Metric icon={<NewspaperIcon className="size-4" />} label="News topics" value={newsReady.length} tone="amber" />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.2fr_.8fr]">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CalendarDaysIcon className="size-4" /> Next content rail</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {(calendar.data ?? []).slice(0, 7).map((r, i) => (
              <div key={`${r.scheduled_at}-${i}`} className="grid gap-2 rounded-2xl border bg-muted/20 p-3 md:grid-cols-[auto_1fr_auto] md:items-center">
                <div className="grid size-10 place-items-center rounded-full bg-foreground text-background">{i + 1}</div>
                <div>
                  <p className="font-medium">{r.pillar_name}</p>
                  <p className="text-xs text-muted-foreground">{r.scheduled_at ? new Date(r.scheduled_at).toLocaleString("id-ID") : "cron off"}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{r.platform}/{r.format}</Badge>
                  {r.planned && <Badge>{r.planned.type}</Badge>}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Panel title="Plans" icon={<SparklesIcon className="size-4" />} empty="No active plans yet.">
            {activePlans.map((p) => <Row key={p.id} title={`${p.for_date} · ${p.type}`} meta={p.note || `${p.platform ?? "natural"}/${p.format ?? "natural"}`} />)}
          </Panel>
          <Panel title="Need action" icon={<Clock3Icon className="size-4" />} empty="No pending approvals/covers.">
            {awaiting.map((p) => <Row key={p.id} title={p.topic || "(no topic)"} meta={p.status} action={() => navigate(`/app/${slug}/posts/${p.id}`)} />)}
          </Panel>
          <Panel title="News radar" icon={<RadioIcon className="size-4" />} empty="No news topics/sources yet.">
            {newsReady.map((n) => <Row key={n.id} title={n.name} meta={`${n.source_count} sources`} action={() => navigate(`/app/${slug}/news/${n.id}`)} />)}
          </Panel>
        </div>
      </section>
    </div>
  )
}

function GraphNode({ node, flowing }: { node: { label: string; sub: string; x: number; y: number; tone: "emerald" | "sky" | "amber" | "rose" }; flowing: boolean }) {
  const color = node.tone === "emerald" ? "border-emerald-300/50 bg-emerald-300/15 text-emerald-100" : node.tone === "sky" ? "border-sky-300/50 bg-sky-300/15 text-sky-100" : node.tone === "amber" ? "border-amber-300/50 bg-amber-300/15 text-amber-100" : "border-rose-300/50 bg-rose-300/15 text-rose-100"
  return (
    <div className={`absolute w-32 -translate-x-1/2 -translate-y-1/2 rounded-2xl border p-3 text-center shadow-2xl backdrop-blur ${color}`} style={{ left: `${node.x}%`, top: `${node.y}%`, animation: flowing ? "studio-orbit 3s ease-in-out infinite" : undefined }}>
      <p className="text-sm font-semibold">{node.label}</p>
      <p className="mt-1 text-[0.68rem] text-white/60">{node.sub}</p>
    </div>
  )
}

function Metric({ icon, label, value, tone }: { icon: ReactNode; label: string; value: number; tone: "emerald" | "sky" | "amber" }) {
  const cls = tone === "emerald" ? "from-emerald-500/20" : tone === "sky" ? "from-sky-500/20" : "from-amber-500/20"
  return <Card className={`bg-gradient-to-br ${cls} to-transparent`}><CardContent className="flex items-center justify-between p-4"><div><p className="text-xs uppercase tracking-widest text-muted-foreground">{label}</p><p className="text-2xl font-semibold">{value}</p></div><div className="rounded-full border p-3 text-muted-foreground">{icon}</div></CardContent></Card>
}

function Panel({ title, icon, empty, children }: { title: string; icon: ReactNode; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : !!children
  return <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base">{icon} {title}</CardTitle></CardHeader><CardContent className="space-y-2">{hasChildren ? children : <p className="text-sm text-muted-foreground">{empty}</p>}</CardContent></Card>
}

function Row({ title, meta, action }: { title: string; meta: string; action?: () => void }) {
  return <button type="button" onClick={action} className="flex w-full items-center justify-between gap-3 rounded-xl border bg-muted/20 p-3 text-left text-sm transition hover:bg-muted disabled:pointer-events-none" disabled={!action}><span className="min-w-0 truncate font-medium">{title}</span><span className="shrink-0 text-xs text-muted-foreground">{meta}</span>{action && <CheckCircle2Icon className="size-4 text-emerald-500" />}</button>
}
