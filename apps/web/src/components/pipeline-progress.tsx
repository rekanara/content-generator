// Live pipeline stepper — polls /api/queue/live while a run is active (and for
// 30s after it ends, so the outcome lands). Generate runs show the full chain;
// other job kinds show a compact line. Auto-reloads the dashboard when a run
// finishes (new post / status change).
import { useEffect, useRef, useState } from "react"
import { Check, Loader2, X } from "lucide-react"
import { api } from "@/lib/api"

type Run = {
  active: boolean; kind: string; slug: string; postId: string | null
  stage: string; detail: string | null; startedAt: number; updatedAt: number; error: string | null
}

const GEN_STEPS = ["slot", "ideation", "writer", "critic", "render", "deliver"] as const
const STEP_LABEL: Record<string, string> = {
  slot: "slot", ideation: "ideation", writer: "writer", critic: "critic",
  render: "render", deliver: "deliver",
}

export function PipelineProgress({ onFinished }: { onFinished?: () => void }) {
  const [run, setRun] = useState<Run | null>(null)
  const [, force] = useState(0)
  const notified = useRef(false)

  useEffect(() => {
    let on = true
    let id: ReturnType<typeof setInterval> | null = null
    const poll = () =>
      api.queueLive()
        .then((x) => {
          if (!on) return
          setRun(x.run ?? null)
          const fast = x.run?.active || (Date.now() - (x.run?.updatedAt ?? 0) < 30_000)
          if (!id && fast) id = setInterval(poll, 1_500)
          if (id && !fast) { clearInterval(id); id = null }
        })
        .catch(() => {})
    poll()
    id = setInterval(poll, 10_000)
    return () => { on = false; if (id) clearInterval(id) }
  }, [])

  useEffect(() => {
    if (run?.active) {
      notified.current = false
      const id = setInterval(() => force((n) => n + 1), 1000)
      return () => clearInterval(id)
    }
    if (run && !run.active && !notified.current) {
      notified.current = true
      onFinished?.()
    }
  }, [run?.active, run, onFinished])

  if (!run || (!run.active && Date.now() - run.updatedAt > 30_000)) return null

  const elapsed = Math.max(0, Math.round((Date.now() - run.startedAt) / 1000))
  const terminal = !run.active
  const failed = run.stage === "failed"

  if (run.kind !== "generate") {
    return (
      <section className="ticks rounded-lg border border-border/70 bg-card p-3">
        <div className="flex items-center gap-2 text-sm">
          {terminal
            ? failed ? <X className="size-4 text-destructive" /> : <Check className="size-4 text-live" />
            : <Loader2 className="size-4 animate-spin text-warn" />}
          <span className="readout text-xs uppercase tracking-widest text-muted-foreground">
            {run.kind} · {run.slug}
          </span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {terminal ? (failed ? run.error : run.detail ?? "done") : `${run.stage}${run.detail ? ` · ${run.detail}` : ""}`}
          </span>
          {!terminal && <span className="readout text-xs text-muted-foreground">{elapsed}s</span>}
        </div>
      </section>
    )
  }

  const stepIdx = GEN_STEPS.indexOf(run.stage as (typeof GEN_STEPS)[number])
  const doneIdx = terminal
    ? failed ? Math.max(0, stepIdx) : GEN_STEPS.length
    : -1

  return (
    <section className="ticks rounded-lg border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2">
        {terminal
          ? failed ? <X className="size-4 text-destructive" /> : <Check className="size-4 text-live" />
          : <Loader2 className="size-4 animate-spin text-warn" />}
        <span className="readout text-xs uppercase tracking-widest text-muted-foreground">
          pipeline · {run.slug}
        </span>
        <span className="readout ml-auto text-xs text-muted-foreground">
          {terminal ? "done" : `${elapsed}s`}
        </span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {GEN_STEPS.map((s, i) => {
          const done = terminal ? i < doneIdx : i < stepIdx
          const current = !terminal && i === stepIdx
          const broke = terminal && failed && i === stepIdx
          return (
            <span key={s} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground/40">→</span>}
              <span
                className={
                  "readout rounded-md border px-2 py-0.5 text-[0.65rem] uppercase tracking-wider " +
                  (broke
                    ? "border-destructive/40 bg-destructive/10 text-destructive"
                    : current
                      ? "border-warn/40 bg-warn/10 text-warn animate-pulse"
                      : done
                        ? "border-live/30 bg-live/10 text-live"
                        : "border-border/60 text-muted-foreground/50")
                }
              >
                {STEP_LABEL[s]}
              </span>
            </span>
          )
        })}
      </div>
      {run.detail && (
        <p className="readout mt-2 truncate text-xs text-muted-foreground">
          {terminal && failed ? run.error : run.detail}
        </p>
      )}
    </section>
  )
}
