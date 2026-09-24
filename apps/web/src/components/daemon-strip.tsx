// Daemon status strip — the console's heartbeat. LED + mono readout polled from
// /health every 30s + live run telemetry from /api/queue/live (2s while a run is
// active, 12s otherwise). Green pulse = idle & healthy, amber fast-pulse = run
// in flight (with the live pipeline stage), red static = daemon unreachable.
import { useEffect, useState } from "react"
import { api } from "@/lib/api"

type Health = { ok: boolean; db: boolean; stuck: boolean; queue: { running: boolean; pending: number } }
type Live = {
  run: { active: boolean; kind: string; slug: string; stage: string; detail: string | null; startedAt: number; updatedAt: number; error: string | null } | null
  queue: { running: boolean; pending: number }
}

const STAGE_LABEL: Record<string, string> = {
  slot: "SLOT", ideation: "IDEATION", writer: "WRITER", critic: "CRITIC",
  render: "RENDER", deliver: "DELIVER", awaiting: "AWAITING", done: "DONE", failed: "FAILED",
}

export function DaemonStrip() {
  const [h, setH] = useState<Health | null>(null)
  const [live, setLive] = useState<Live | null>(null)
  const [, force] = useState(0) // re-render tick for the elapsed counter

  useEffect(() => {
    let on = true
    const health = () => api.health().then((x) => on && setH(x)).catch(() => on && setH(null))
    health()
    const id = setInterval(health, 30_000)
    return () => { on = false; clearInterval(id) }
  }, [])

  useEffect(() => {
    let on = true
    let id: ReturnType<typeof setInterval> | null = setInterval(poll, 12_000)
    function poll() {
      api.queueLive()
        .then((x) => {
          if (!on) return
          setLive(x)
          const fast = x.run?.active || (Date.now() - (x.run?.updatedAt ?? 0) < 15_000)
          const want = fast ? 2_000 : 12_000
          if (id && !fast) { clearInterval(id); id = setInterval(poll, want) }
          else if (!id && fast) { id = setInterval(poll, want) }
        })
        .catch(() => {})
    }
    return () => { on = false; if (id) clearInterval(id) }
  }, [])

  useEffect(() => {
    if (!live?.run?.active) return
    const id = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [live?.run?.active])

  const run = live?.run ?? null
  const elapsed = run ? Math.max(0, Math.round((Date.now() - run.startedAt) / 1000)) : 0

  let state: "down" | "busy" | "live" = !h ? "down" : h.queue.running ? "busy" : "live"
  let label: string
  if (run?.active) {
    const detail = run.detail ? ` · ${run.detail}` : ""
    label = `▶ ${STAGE_LABEL[run.stage] ?? run.stage}${detail} · ${elapsed}s`
    state = "busy"
  } else if (run && !run.active && Date.now() - run.updatedAt < 120_000) {
    label = run.stage === "failed"
      ? `✗ failed · ${(run.error ?? "").slice(0, 40)}`
      : run.stage === "awaiting"
        ? `⏸ awaiting · ${run.detail ?? ""}`
        : "✓ done"
  } else if (!h) {
    label = "daemon offline"
  } else {
    const q = live?.queue
    label = h.queue.running ? "queue running" : "daemon online · queue idle"
    if (q && q.pending > 0) label += ` · ${q.pending} pending`
  }

  return (
    <div
      className="flex items-center gap-2"
      title={h ? `db ${h.db ? "ok" : "down"}${h.stuck ? " · stuck run detected" : ""}` : "cannot reach /health"}
    >
      <span className={`led ${state === "down" ? "led-down" : state === "busy" ? "led-busy" : "led-live"}`} />
      <span className="readout hidden max-w-64 truncate text-[0.7rem] text-muted-foreground sm:inline">{label}</span>
    </div>
  )
}
