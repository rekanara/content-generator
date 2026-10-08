import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { useNewsTopic } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import { PostDetailView } from "@/views/post-detail"

export function NewsItemDetailView({ slug, topicId, itemId }: { slug: string; topicId: string; itemId: string }) {
  const { data: topic, error, loading } = useNewsTopic(slug, topicId)
  if (loading && !topic) return <p className="text-sm text-muted-foreground">loading…</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>
  const item = topic?.items.find((i) => i.id === itemId)
  if (!item) return <p className="text-sm text-destructive">news item not found</p>
  return (
    <div className="space-y-4">
      <Button variant="outline" size="sm" onClick={() => navigate(`/app/${slug}/news/${topicId}`)}>Back to topic</Button>
      <Card>
        <CardHeader><CardTitle className="text-base">{item.title}</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">{item.domain} · {item.published_at ?? "no date"} · {item.status}{item.score === null ? "" : ` · ${item.score}`}</p>
          <a className="break-all text-primary underline" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
          {item.reason && <p className="text-muted-foreground">{item.reason}</p>}
        </CardContent>
      </Card>
      {item.post_id ? <PostDetailView slug={slug} id={item.post_id} /> : <p className="text-sm text-muted-foreground">Belum ada hasil generate.</p>}
    </div>
  )
}
