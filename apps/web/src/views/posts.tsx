import { useState } from "react"
import { Send } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { api } from "@/lib/api"
import { usePosts, usePost } from "@/lib/hooks"

export function PostsView() {
  const { data, error, loading, reload } = usePosts()
  const [selected, setSelected] = useState<number | null>(null)

  if (loading && !data) return <p className="text-muted-foreground text-sm">memuat…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">Posts</h1>
      <div className="divide-y rounded-lg border">
        {(data ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <span className="w-10 shrink-0 text-xs text-muted-foreground">#{p.id}</span>
            <span className={"w-16 shrink-0 text-xs " + statusColor(p.status)}>{p.status}</span>
            <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setSelected(p.id)}>
              {p.topic}
            </button>
            <span className="hidden w-24 shrink-0 text-xs text-muted-foreground md:inline">{p.platform}/{p.format}</span>
            {p.status === "failed" && (
              <Button variant="ghost" size="icon" aria-label="resend" onClick={() => api.resend(p.id).then(reload)}>
                <Send className="size-4" />
              </Button>
            )}
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">belum ada post</p>}
      </div>
      {selected !== null && <PostDetailModal id={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

const statusColor = (s: string) =>
  s === "sent" ? "text-emerald-500"
  : s === "failed" ? "text-red-500"
  : s === "rendered" ? "text-amber-500"
  : s === "queued" ? "text-blue-500"
  : "text-muted-foreground"

function PostDetailModal({ id, onClose }: { id: number; onClose: () => void }) {
  const { data, error, loading } = usePost(id)
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="max-h-[80vh] w-full max-w-2xl overflow-y-auto rounded-lg border bg-background p-5"
        onClick={(e) => e.stopPropagation()}
      >
        {loading && <p className="text-sm text-muted-foreground">memuat…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data && (
          <>
            <div className="mb-3 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-medium">#{data.id} — {data.topic}</h2>
                <p className="text-xs text-muted-foreground">
                  {data.platform}/{data.format} · {data.status} · {data.source} · {new Date(data.created_at).toLocaleString("id-ID")}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={onClose}>tutup</Button>
            </div>
            {data.error && <pre className="mb-3 rounded bg-red-500/10 p-3 text-xs text-red-500 whitespace-pre-wrap">{data.error}</pre>}
            {data.caption && (
              <section className="mb-3">
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">Caption</h3>
                <p className="text-sm whitespace-pre-wrap">{data.caption}</p>
              </section>
            )}
            <section>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Body</h3>
              <pre className="rounded bg-muted p-3 text-xs whitespace-pre-wrap">{data.body_text}</pre>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
