// Daemon status strip — the console's heartbeat. LED + mono readout polled from
// /health every 30s. Green pulse = idle & healthy, amber fast-pulse = queue
// running, red static = daemon unreachable.
import { useEffect, useState } from "react"
import { api } from "@/lib/api"

type Health = { ok: boolean; db: boolean; stuck: boolean; queue: { running: boolean; pending: number } }

export function DaemonStrip() {
  const [h, setH] = useState<Health | null>(null)

  useEffect(() => {
    let live = true
    const tick = () =>
      api.health()
        .then((x) => live && setH(x))
        .catch(() => live && setH(null))
    tick()
    const id = setInterval(tick, 30_000)
    return () => { live = false; clearInterval(id) }
  }, [])

  const state = !h ? "down" : h.queue.running ? "busy" : "live"
  const label = !h
    ? "daemon offline"
    : h.queue.running
      ? `queue running${h.queue.pending > 0 ? ` · ${h.queue.pending} pending` : ""}`
      : "daemon online · queue idle"

  return (
    <div
      className="flex items-center gap-2"
      title={h ? `db ${h.db ? "ok" : "down"}${h.stuck ? " · stuck run detected" : ""}` : "cannot reach /health"}
    >
      <span className={`led ${state === "down" ? "led-down" : state === "busy" ? "led-busy" : "led-live"}`} />
      <span className="readout hidden text-[0.7rem] text-muted-foreground sm:inline">{label}</span>
    </div>
  )
}
