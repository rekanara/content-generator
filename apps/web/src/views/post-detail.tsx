import { useState } from "react"
import { ArrowLeft, Check, Download, ImageOff, RefreshCw, Send, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { api, ApiError } from "@/lib/api"
import { usePost, useApi } from "@/lib/hooks"
import { navigate } from "@/lib/router"

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-blue-500/15 text-blue-500 border-transparent",
  draft: "bg-muted text-muted-foreground border-transparent",
  awaiting_cover: "bg-cyan-500/15 text-cyan-500 border-transparent",
  rendered: "bg-amber-500/15 text-amber-500 border-transparent",
  awaiting_approval: "bg-violet-500/15 text-violet-500 border-transparent",
  sent: "bg-emerald-500/15 text-emerald-500 border-transparent",
  failed: "bg-red-500/15 text-red-500 border-transparent",
  rejected: "bg-zinc-500/15 text-zinc-500 border-transparent",
}

const EVENT_BADGE: Record<string, string> = {
  generated: "bg-blue-500/15 text-blue-500 border-transparent",
  rendered: "bg-amber-500/15 text-amber-500 border-transparent",
  awaiting_cover: "bg-cyan-500/15 text-cyan-500 border-transparent",
  cover_received: "bg-cyan-500/15 text-cyan-500 border-transparent",
  awaiting_approval: "bg-violet-500/15 text-violet-500 border-transparent",
  approved: "bg-violet-500/15 text-violet-500 border-transparent",
  sent: "bg-emerald-500/15 text-emerald-500 border-transparent",
  failed: "bg-red-500/15 text-red-500 border-transparent",
  rejected: "bg-zinc-500/15 text-zinc-500 border-transparent",
  rerendered: "bg-sky-500/15 text-sky-500 border-transparent",
  resent: "bg-emerald-500/15 text-emerald-500 border-transparent",
}

// artifacts exist only once rendered — draft/queued/failed before render have none
const HAS_ARTIFACTS = ["rendered", "awaiting_approval", "sent"]

export function PostDetailView({ slug, id }: { slug: string; id: string }) {
  const { data, error, loading, reload } = usePost(slug, id)
  const { data: events } = useApi(() => api.postEvents(slug, id), [slug, id])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true); setMsg(null)
    try {
      await fn()
      setMsg(`${label} — queued`)
      reload()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : `${label} failed`)
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="back" onClick={() => navigate(`/app/${slug}/posts`)}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{data.topic || "(no topic)"}</h1>
        <Badge variant="secondary" className={STATUS_BADGE[data.status]}>{data.status}</Badge>
        <Badge variant="outline">{data.platform}/{data.format}</Badge>
      </section>

      <p className="text-xs text-muted-foreground">
        {data.source} · {new Date(data.created_at).toLocaleString("en-US")}
        {msg && <span className="ml-2 text-amber-500">{msg}</span>}
      </p>

      <section className="flex flex-wrap gap-2">
        {data.status === "awaiting_cover" && (
          <p className="w-full rounded-md border border-dashed p-2 text-xs text-muted-foreground">
            Waiting for a cover image — upload a photo in the Telegram chat, or skip:
          </p>
        )}
        {data.status === "awaiting_cover" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.skipCover(slug, id), "skip cover")}>
            <ImageOff className="size-4" /> Skip cover — render now
          </Button>
        )}
        {data.status === "awaiting_approval" && (
          <>
            <Button size="sm" disabled={busy} onClick={() => act(() => api.approve(slug, id), "approve")}>
              <Check className="size-4 text-emerald-500" /> Approve — send now
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.reject(slug, id), "reject")}>
              <X className="size-4 text-red-500" /> Reject
            </Button>
          </>
        )}
        {data.status === "failed" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.resend(slug, id), "resend")}>
            <Send className="size-4" /> Resend
          </Button>
        )}
        {HAS_ARTIFACTS.includes(data.status) && data.format !== "text" && (
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => act(() => api.rerender(slug, id), "rerender with current template")}>
            <RefreshCw className="size-4" /> Re-render
          </Button>
        )}
      </section>

      {data.error && (
        <pre className="rounded bg-red-500/10 p-3 text-xs whitespace-pre-wrap break-words text-red-500">{data.error}</pre>
      )}

      {data.caption && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Caption</h3>
            <p className="text-sm whitespace-pre-wrap break-words">{data.caption}</p>
          </CardContent>
        </Card>
      )}

      <PostContent slug={slug} id={id} format={data.format} status={data.status}
        artifacts={data.artifacts} bodyText={data.body_text} />

      {events && events.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <h3 className="mb-2 text-xs font-medium text-muted-foreground">History</h3>
            <div className="space-y-1.5">
              {events.map((e) => (
                <div key={e.id} className="flex items-center gap-2 text-xs">
                  <Badge variant="secondary" className={EVENT_BADGE[e.event] ?? ""}>{e.event}</Badge>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleString("en-US")}</span>
                  {e.error && <span className="min-w-0 flex-1 truncate text-red-500">{e.error}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PostContent({ slug, id, format, status, artifacts, bodyText }: {
  slug: string; id: string; format: string; status: string; artifacts: string[]; bodyText: string
}) {
  if (format === "text") {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Post body</h3>
          <pre className="text-sm whitespace-pre-wrap break-words">{bodyText}</pre>
        </CardContent>
      </Card>
    )
  }
  if (!HAS_ARTIFACTS.includes(status)) {
    return (
      <Card>
        <CardContent className="p-4">
          <h3 className="mb-1 text-xs font-medium text-muted-foreground">Content</h3>
          <pre className="text-sm whitespace-pre-wrap break-words">{bodyText}</pre>
          <p className="mt-2 text-xs text-muted-foreground">artifacts appear once the post is rendered</p>
        </CardContent>
      </Card>
    )
  }

  const url = (f: string) => api.artifactUrl(slug, id, f)

  if (format === "carousel") {
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Slides ({artifacts.length})</h3>
        <div className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))]">
          {artifacts.map((f, i) => (
            <figure key={f} className="space-y-1 overflow-hidden rounded-lg border">
              <img src={url(f)} alt={`slide ${i + 1}`} loading="lazy" className="w-full bg-muted" />
              <figcaption className="px-2 pb-1 text-center text-xs text-muted-foreground">{i + 1}/{artifacts.length}</figcaption>
            </figure>
          ))}
        </div>
      </section>
    )
  }

  if (format === "reels") {
    const f = artifacts[0]
    return (
      <section className="space-y-2">
        <h3 className="text-xs font-medium text-muted-foreground">Reel</h3>
        <div className="mx-auto w-fit overflow-hidden rounded-lg border">
          <video controls playsInline preload="metadata" src={f ? url(f) : undefined} className="max-h-[70vh] bg-black" />
        </div>
      </section>
    )
  }

  if (format === "pdf") {
    const f = artifacts[0]
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-medium text-muted-foreground">Document</h3>
          {f && (
            <a href={url(f)} download={`post-${id}.pdf`}>
              <Button size="sm" variant="outline"><Download className="size-4" /> Download PDF</Button>
            </a>
          )}
        </div>
        {f && <iframe title="pdf preview" src={url(f)} className="h-[70vh] w-full rounded-lg border bg-muted" />}
      </section>
    )
  }
  return null
}
