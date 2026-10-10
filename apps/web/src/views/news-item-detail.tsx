import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { useApi } from "@/lib/hooks"
import { api } from "@/lib/api"
import { navigate } from "@/lib/router"
import { PostDetailView } from "@/views/post-detail"

export function NewsItemDetailView({ slug, topicId, itemId }: { slug: string; topicId: string; itemId: string }) {
  const { data: item, error, loading } = useApi(() => api.newsItem(slug, topicId, itemId), [slug, topicId, itemId])
  if (loading && !item) return <p className="text-sm text-muted-foreground">loading…</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!item) return <p className="text-sm text-destructive">news item not found</p>
  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={() => navigate(`/app/${slug}/news/${topicId}`)}>Back to topic</Button>
      <Card>
        <CardHeader><CardTitle className="text-base">{item.title}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{item.domain} · {item.published_at ?? "no date"} · {item.status}{item.score === null ? "" : ` · ${item.score}`}</p>
          <a className="break-all text-primary underline" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
          {item.extra_sources.length > 0 && (
            <div className="space-y-1 rounded-md border p-2">
              <p className="text-xs font-medium text-muted-foreground">Additional sources ({item.extra_sources.length})</p>
              {item.extra_sources.map((s) => (
                <a key={s.url} className="block break-all text-xs text-primary underline" href={s.url} target="_blank" rel="noreferrer">{s.domain} — {s.title || s.url}</a>
              ))}
            </div>
          )}
          {item.reason && <p className="text-muted-foreground">{item.reason}</p>}
        </CardContent>
      </Card>
      {item.post_id ? <PostDetailView slug={slug} id={item.post_id} /> : <p className="text-sm text-muted-foreground">Nothing generated yet.</p>}
    </div>
  )
}
