import { useState } from "react"
import { ArrowLeft, Plus, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { api, ApiError, type NewsFetchUrlsResult } from "@/lib/api"
import { useNewsTopic } from "@/lib/hooks"
import { navigate } from "@/lib/router"

const MAX_URLS = 5

// Full page (was a modal): fetch 1-5 links about the SAME story so the AI can cross-check
// facts across sources instead of trusting a single article.
export function NewsFetchView({ slug, id }: { slug: string; id: string }) {
  const { data: topic } = useNewsTopic(slug, id)
  const [urls, setUrls] = useState<string[]>([""])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [res, setRes] = useState<NewsFetchUrlsResult | null>(null)

  const setUrl = (i: number, v: string) => setUrls((xs) => xs.map((x, j) => (j === i ? v : x)))
  const addUrl = () => setUrls((xs) => (xs.length < MAX_URLS ? [...xs, ""] : xs))
  const delUrl = (i: number) => setUrls((xs) => xs.filter((_, j) => j !== i))

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    const clean = urls.map((u) => u.trim()).filter(Boolean)
    if (clean.length === 0) return
    setBusy(true); setErr(null); setRes(null)
    try {
      setRes(await api.fetchNewsUrls(slug, id, clean))
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "fetch failed")
    } finally {
      setBusy(false)
    }
  }

  const reset = () => { setUrls([""]); setRes(null); setErr(null) }
  const item = res?.item

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="back" onClick={() => navigate(`/app/${slug}/news/${id}`)}><ArrowLeft className="size-4" /></Button>
        <h1 className="text-lg font-semibold">Fetch article{topic ? ` — ${topic.name}` : ""}</h1>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Article URL{urls.length > 1 ? "s" : ""}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Add 1 to {MAX_URLS} links about the <strong>same story</strong> from different outlets. Each is read and matched against this
            topic's RSS sources; the AI then analyzes them TOGETHER — numbers and facts confirmed by more than one source are preferred,
            and disagreements are flagged instead of guessed. Link 1 is kept as the post's source line; the others ride along as
            corroborating sources used when the content is generated.
          </p>
          <form onSubmit={run} className="space-y-3">
            {urls.map((u, i) => (
              <div key={i} className="flex gap-2">
                <Input required={i === 0} type="url" autoFocus={i === 0} placeholder={i === 0 ? "https://…" : "https://… (optional additional source)"}
                  value={u} disabled={busy} onChange={(e) => setUrl(i, e.target.value)} />
                {urls.length > 1 && (
                  <Button type="button" variant="ghost" size="icon" aria-label="remove URL" disabled={busy} onClick={() => delUrl(i)}>
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </div>
            ))}
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy || urls.length >= MAX_URLS} onClick={addUrl}>
                <Plus className="size-4" /> Add another source
              </Button>
              <div className="flex gap-2">
                {res && <Button type="button" variant="outline" onClick={reset}>Fetch another</Button>}
                <Button type="submit" disabled={busy || urls.every((u) => !u.trim())}>
                  {busy ? "Reading & analyzing…" : `Fetch & analyze ${urls.filter((u) => u.trim()).length || ""}`}
                </Button>
              </div>
            </div>
          </form>
          {busy && <p className="text-sm text-muted-foreground" aria-live="polite">Reading the article{urls.filter((u) => u.trim()).length > 1 ? "s" : ""} and analyzing — up to a minute.</p>}
          {err && <p className="text-sm text-destructive">{err}</p>}
        </CardContent>
      </Card>

      {item && (
        <Card>
          <CardHeader><CardTitle className="text-base">Result</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="font-medium">{item.title}</p>
            <p className="break-all text-xs text-muted-foreground">
              <a className="underline" href={item.url} target="_blank" rel="noreferrer">{item.domain}</a> · {item.published_at ?? "no date"}
              {res.matchedSource ? ` · found in RSS: ${res.matchedSource}` : " · not in your RSS sources"}
            </p>
            <p className="text-xs"><span className={item.status === "valid" ? "text-emerald-500" : "text-amber-500"}>{item.status}</span> · score {item.score ?? "—"}</p>
            {item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}
            {res.known && <p className="text-xs text-amber-500">Already in this topic ({item.status}) — kept as is{res.extra.length > 0 ? ", added sources merged in" : ""}.</p>}
            {res.extra.length > 0 && (
              <div className="space-y-1 rounded-md border p-2">
                <p className="text-xs font-medium text-muted-foreground">Additional sources used ({res.extra.length})</p>
                {res.extra.map((s) => (
                  <a key={s.url} className="block break-all text-xs text-primary underline" href={s.url} target="_blank" rel="noreferrer">{s.domain} — {s.title || s.url}</a>
                ))}
              </div>
            )}
            {res.skipped.length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-2">
                <p className="text-xs font-medium text-amber-500">Skipped ({res.skipped.length})</p>
                {res.skipped.map((s, i) => <p key={i} className="break-all text-xs text-muted-foreground">{s.url} — {s.reason}</p>)}
              </div>
            )}
            {res.analysis && res.analysis.key_points.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {res.analysis.key_points.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate(`/app/${slug}/news/${id}/items/${item.id}`)}>Open item</Button>
              <Button variant="outline" size="sm" onClick={() => navigate(`/app/${slug}/news/${id}`)}>Back to topic</Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
