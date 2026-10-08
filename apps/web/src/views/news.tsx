import { useState } from "react"
import { LinkIcon } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { api, ApiError } from "@/lib/api"
import { useNewsTopics } from "@/lib/hooks"
import { navigate } from "@/lib/router"

export function NewsView({ slug }: { slug: string }) {
  const { data: topics, error, loading, reload } = useNewsTopics(slug)
  const [form, setForm] = useState({ name: "", description: "" })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.addNewsTopic(slug, form)
      setForm({ name: "", description: "" })
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to add topic")
    } finally {
      setBusy(false)
    }
  }

  if (loading && !topics) return <p className="text-sm text-muted-foreground">loading…</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">News topics</h1>
        <p className="text-sm text-muted-foreground">Each topic has its own feeds, filter rules, template and caption. Independent from Pillars (those are for regular posts).</p>
      </div>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="news-topic-name">Topic group</Label>
          <Input id="news-topic-name" required placeholder="AI tools" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="news-topic-desc">Description</Label>
          <Input id="news-topic-desc" placeholder="What counts as relevant news" value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <Button type="submit" disabled={busy} className="justify-self-start self-end">Add</Button>
      </form>

      <div className="grid gap-3">
        {(topics ?? []).map((t) => (
          <Card key={t.id} className="cursor-pointer transition hover:bg-muted/40" onClick={() => navigate(`/app/${slug}/news/${t.id}`)}>
            <CardContent className="flex items-center gap-3 p-4">
              <LinkIcon className="size-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{t.name}</p>
                <p className="truncate text-xs text-muted-foreground">{t.description || "no description"}</p>
              </div>
              <span className="text-xs text-muted-foreground">{t.source_count} sources</span>
            </CardContent>
          </Card>
        ))}
        {topics?.length === 0 && <p className="rounded-lg border p-4 text-sm text-muted-foreground">no news topics yet</p>}
      </div>
    </div>
  )
}
