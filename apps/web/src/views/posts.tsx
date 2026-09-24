import { Check, Lightbulb, RefreshCw, Send, Star, Trash2, X } from "lucide-react"
import { useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Input } from "@workspace/ui/components/input"
import { api } from "@/lib/api"
import { usePosts, useIdeas } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import type { Idea } from "@workspace/shared"

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

function IdeasCard({ slug, ideas, reload }: { slug: string; ideas: Idea[] | undefined; reload: () => void }) {
  const [text, setText] = useState("")
  const [busy, setBusy] = useState(false)
  const unused = (ideas ?? []).filter((i) => !i.used_at)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (text.trim().length < 3) return
    setBusy(true)
    try {
      await api.addIdea(slug, text.trim())
      setText("")
      reload()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="rounded-lg border p-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="size-4 text-amber-500" />
        <h2 className="text-sm font-semibold">Idea backlog</h2>
        {unused.length > 0 && <Badge variant="secondary" className="bg-amber-500/15 text-amber-500 border-transparent">{unused.length} queued</Badge>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Topik yang kamu simpan — pipeline memakainya FIFO di run berikutnya (sebelum ideation AI). Telegram: <code>/ide [group] &lt;ide&gt;</code>
      </p>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Kenapa sprint estimation selalu meleset 2x" maxLength={400} />
        <Button type="submit" size="sm" disabled={busy || text.trim().length < 3}>Add</Button>
      </form>
      {(ideas ?? []).length > 0 && (
        <ul className="mt-3 divide-y">
          {ideas!.slice(0, 8).map((i) => (
            <li key={i.id} className="flex items-center gap-2 py-2 text-sm">
              <span className={`size-1.5 shrink-0 rounded-full ${i.used_at ? "bg-muted-foreground/40" : "bg-amber-500"}`} />
              <span className={`min-w-0 flex-1 truncate ${i.used_at ? "text-muted-foreground line-through" : ""}`}>{i.text}</span>
              <Button variant="ghost" size="icon" aria-label="delete idea" onClick={() => api.delIdea(slug, i.id).then(reload)}>
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export function PostsView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = usePosts(slug)
  const ideas = useIdeas(slug)

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Posts</h1>
      <IdeasCard slug={slug} ideas={ideas.data ?? undefined} reload={ideas.reload} />
      <div className="divide-y rounded-lg border">
        {(data ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <Badge variant="secondary" className={STATUS_BADGE[p.status]}>{p.status}</Badge>
            <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => navigate(`/app/${slug}/posts/${p.id}`)}>
              {p.topic}
            </button>
            {p.status === "sent" && (
              <Button variant="ghost" size="icon" aria-label="star" title="Star — quality signal (feeds the AI planner)"
                onClick={() => api.starPost(slug, p.id).then(reload)}>
                <Star className={`size-4 ${p.starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
              </Button>
            )}
            <span className="hidden w-24 shrink-0 text-xs text-muted-foreground md:inline">{p.platform}/{p.format}</span>
            {p.status === "failed" && (
              <Button variant="ghost" size="icon" aria-label="resend" onClick={() => api.resend(slug, p.id).then(reload)}>
                <Send className="size-4" />
              </Button>
            )}
            {["sent", "awaiting_approval", "rendered"].includes(p.status) && p.format !== "text" && (
              <Button variant="ghost" size="icon" aria-label="rerender with current template"
                title="Re-render with current template (content unchanged)"
                onClick={() => api.rerender(slug, p.id).then(reload)}>
                <RefreshCw className="size-4" />
              </Button>
            )}
            {p.status === "awaiting_approval" && (
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon" aria-label="approve" title="Approve — send now"
                  onClick={() => api.approve(slug, p.id).then(reload)}>
                  <Check className="size-4 text-emerald-500" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="reject" title="Reject — rotation not consumed"
                  onClick={() => api.reject(slug, p.id).then(reload)}>
                  <X className="size-4 text-red-500" />
                </Button>
              </div>
            )}
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no posts yet</p>}
      </div>
    </div>
  )
}
