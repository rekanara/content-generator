import { Check, RefreshCw, Send, X } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { api } from "@/lib/api"
import { usePosts } from "@/lib/hooks"
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

export function PostsView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = usePosts(slug)

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Posts</h1>
      <div className="divide-y rounded-lg border">
        {(data ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <Badge variant="secondary" className={STATUS_BADGE[p.status]}>{p.status}</Badge>
            <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => navigate(`/app/${slug}/posts/${p.id}`)}>
              {p.topic}
            </button>
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
