import { useState } from "react"
import { Send } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@workspace/ui/components/dialog"
import { api } from "@/lib/api"
import { usePosts, usePost } from "@/lib/hooks"

const STATUS_BADGE: Record<string, string> = {
  queued: "bg-blue-500/15 text-blue-500 border-transparent",
  rendered: "bg-amber-500/15 text-amber-500 border-transparent",
  sent: "bg-emerald-500/15 text-emerald-500 border-transparent",
  failed: "bg-red-500/15 text-red-500 border-transparent",
}

export function PostsView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = usePosts(slug)
  const [selected, setSelected] = useState<string | null>(null)

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Posts</h1>
      <div className="divide-y rounded-lg border">
        {(data ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <span className="w-10 shrink-0 text-xs text-muted-foreground">#{p.id}</span>
            <Badge variant="secondary" className={STATUS_BADGE[p.status]}>{p.status}</Badge>
            <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setSelected(p.id)}>
              {p.topic}
            </button>
            <span className="hidden w-24 shrink-0 text-xs text-muted-foreground md:inline">{p.platform}/{p.format}</span>
            {p.status === "failed" && (
              <Button variant="ghost" size="icon" aria-label="resend" onClick={() => api.resend(slug, p.id).then(reload)}>
                <Send className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no posts yet</p>}
      </div>
      <PostDetailModal slug={slug} id={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function PostDetailModal({ slug, id, onClose }: { slug: string; id: string | null; onClose: () => void }) {
  const { data, error, loading } = usePost(slug, id)
  return (
    <Dialog open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        {loading && <p className="text-sm text-muted-foreground">loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data && (
          <>
            <DialogHeader>
              <DialogTitle>#{data.id} — {data.topic}</DialogTitle>
              <DialogDescription>
                {data.platform}/{data.format} · {data.status} · {data.source} · {new Date(data.created_at).toLocaleString("en-US")}
              </DialogDescription>
            </DialogHeader>
            {data.error && <pre className="rounded bg-red-500/10 p-3 text-xs whitespace-pre-wrap text-red-500">{data.error}</pre>}
            {data.caption && (
              <section className="space-y-1">
                <h3 className="text-xs font-medium text-muted-foreground">Caption</h3>
                <p className="text-sm whitespace-pre-wrap">{data.caption}</p>
              </section>
            )}
            <section className="space-y-1">
              <h3 className="text-xs font-medium text-muted-foreground">Body</h3>
              <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">{data.body_text}</pre>
            </section>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
