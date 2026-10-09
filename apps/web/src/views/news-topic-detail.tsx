import { useEffect, useState } from "react"
import { ExternalLink, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { api, ApiError, type IngestProgress } from "@/lib/api"
import { useNewsTopic, useTemplates } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import { CaptionOverrideCard } from "@/components/caption-override-fields"

const LANGUAGES = [
  ["original", "Bahasa asli item"],
  ["id", "Bahasa Indonesia"],
  ["en", "English"],
  ["ms", "Bahasa Melayu"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["es", "Spanish"],
]

export function NewsTopicDetailView({ slug, id }: { slug: string; id: string }) {
  const { data: topic, error, loading, reload } = useNewsTopic(slug, id)
  const { data: templates } = useTemplates(slug)
  const [msg, setMsg] = useState<string | null>(null)
  const [ingesting, setIngesting] = useState(false)
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [autofilling, setAutofilling] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [generateItemId, setGenerateItemId] = useState<string | null | undefined>(undefined)
  const [language, setLanguage] = useState("id")
  const [format, setFormat] = useState<"carousel" | "reels">("carousel")
  const [urlOpen, setUrlOpen] = useState(false)

  const autofill = async () => {
    setAutofilling(true); setMsg(null)
    try {
      await api.autofillNews(slug, id)
      setMsg("autofill applied")
      reload()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "autofill failed")
    } finally {
      setAutofilling(false)
    }
  }

  // server runs the fetch in the background; we poll until it reports done/failed.
  // On mount we also pick up a fetch that was already running (page refresh mid-fetch).
  useEffect(() => {
    let live = true
    api.ingestStatus(slug, id).then((r) => live && r.progress?.state === "running" && (setProgress(r.progress), setIngesting(true))).catch(() => {})
    return () => { live = false }
  }, [slug, id])

  useEffect(() => {
    if (!ingesting) return
    const t = window.setInterval(async () => {
      try {
        const { progress: p } = await api.ingestStatus(slug, id)
        setProgress(p)
        if (p && p.state !== "running") {
          setIngesting(false)
          if (p.state === "failed") setMsg(`fetch failed: ${p.error}`)
          else if (p.result) {
            const r = p.result
            setMsg(`done — ${r.fetched} fetched, ${r.skipped} already known, ${r.valid} valid, ${r.rejected} rejected${r.feedsFailed ? `, ${r.feedsFailed} feed(s) failed` : ""}`)
          }
          reload()
        }
      } catch { /* transient — next tick retries */ }
    }, 1500)
    return () => window.clearInterval(t)
  }, [ingesting, slug, id, reload])

  const ingest = async () => {
    setMsg(null)
    try {
      const r = await api.ingestNews(slug, id)
      setProgress(r.progress)
      setIngesting(true)
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "news ingest failed")
    }
  }

  const openGenerate = (itemId?: string) => {
    setGenerateItemId(itemId ?? null)
    setLanguage("id")
    setFormat("carousel")
  }
  const confirmGenerate = async () => {
    setGenerating(true); setMsg(null)
    try {
      await api.generateNews(slug, id, { item_id: generateItemId ?? undefined, language, format })
      setMsg("generation queued")
      setGenerateItemId(undefined)
      reload()
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "generate failed")
    } finally {
      setGenerating(false)
    }
  }

  if (loading && !topic) return <p className="text-sm text-muted-foreground">loading…</p>
  if (error) return <p className="text-sm text-destructive">{error}</p>
  if (!topic) return null
  const newsTemplates = (templates ?? []).filter((t) => t.type === "regular" && ["ig-news-card", "ig-carousel"].includes(t.format))
  const reelTemplates = (templates ?? []).filter((t) => t.type === "regular" && t.format === "reel")
  const saveTemplates = (t: { template_id: string | null; template_reel_id: string | null; use_source_images?: boolean }) =>
    api.saveNewsTemplate(slug, id, { use_source_images: topic.use_source_images, ...t }).then(() => { setMsg("template saved"); reload() }).catch((err) => setMsg(err instanceof ApiError ? err.message : "template save failed"))
  const validCount = topic.items.filter((i) => i.status === "valid").length

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">{topic.name}</h1>
          <p className="text-sm text-muted-foreground">{topic.description || "no description"}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <select className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Carousel template" value={topic.template_id ?? ""} onChange={(e) => saveTemplates({ template_id: e.target.value || null, template_reel_id: topic.template_reel_id })}>
            <option value="">Auto template</option>
            {newsTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.format}{t.is_active ? "" : " · inactive"}</option>)}
          </select>
          <select className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Reel template" value={topic.template_reel_id ?? ""} onChange={(e) => saveTemplates({ template_id: topic.template_id, template_reel_id: e.target.value || null })}>
            <option value="">No reel template</option>
            {reelTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · reel{t.is_active ? "" : " · inactive"}</option>)}
          </select>
          <label className="flex h-8 items-center gap-2 rounded-md border px-2 text-sm" title="Use the article's photos as cover/body images (credit added, post waits for approval)">
            <input type="checkbox" checked={topic.use_source_images} onChange={(e) => saveTemplates({ template_id: topic.template_id, template_reel_id: topic.template_reel_id, use_source_images: e.target.checked })} />
            Source photos
          </label>
          <Button variant="outline" size="sm" disabled={autofilling} onClick={autofill}>{autofilling ? "Autofilling…" : "AI autofill"}</Button>
          <Button variant="outline" size="sm" disabled={ingesting} onClick={ingest}>{ingesting ? "Fetching…" : "Fetch latest"}</Button>
          <Button variant="outline" size="sm" onClick={() => setUrlOpen(true)}>Fetch one URL</Button>
          <Button variant="default" size="sm" disabled={generating || validCount === 0} onClick={() => openGenerate()}>{generating ? "Generating…" : "Generate latest valid"}</Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/app/${slug}/news`)}>Back</Button>
        </div>
      </div>
      {ingesting && progress && <IngestPanel p={progress} />}
      {msg && <p className="text-sm text-amber-500">{msg}</p>}
      {urlOpen && (
        <FetchUrlDialog slug={slug} topicId={id} onClose={() => setUrlOpen(false)}
          onFetched={reload} onGenerate={(itemId) => { setUrlOpen(false); openGenerate(itemId) }} />
      )}
      {generateItemId !== undefined && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4">
          <Card className="w-full max-w-md">
            <CardHeader><CardTitle className="text-base">Generate content</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <Field label="Bahasa output">
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={language} onChange={(e) => setLanguage(e.target.value)}>
                  {LANGUAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              {topic.template_reel_id && (
                <Field label="Format">
                  <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={format} onChange={(e) => setFormat(e.target.value as "carousel" | "reels")}>
                    <option value="carousel">Carousel (default)</option>
                    <option value="reels">Reels</option>
                  </select>
                </Field>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" disabled={generating} onClick={() => setGenerateItemId(undefined)}>Cancel</Button>
                <Button disabled={generating} onClick={confirmGenerate}>{generating ? "Generating…" : "Generate"}</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <CaptionOverrideCard initial={topic} note="Applies to content generated from this topic. Blank = use the CTA/footer from Settings."
        save={(v) => api.saveNewsCaption(slug, id, v).then(reload)} />
      <RulesCard slug={slug} topicId={id} rules={topic.rules} onSaved={() => { setMsg("rules saved"); reload() }} />
      <SourcesCard slug={slug} topicId={id} sources={topic.sources} reload={reload} setMsg={setMsg} />
      <ItemsCard slug={slug} topicId={id} items={topic.items} reload={reload} setMsg={setMsg} onGenerate={openGenerate} />
    </div>
  )
}

type FetchUrlResult = Awaited<ReturnType<typeof api.fetchNewsUrl>>

function FetchUrlDialog({ slug, topicId, onClose, onFetched, onGenerate }: {
  slug: string; topicId: string; onClose: () => void; onFetched: () => void; onGenerate: (itemId: string) => void
}) {
  const [url, setUrl] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [res, setRes] = useState<FetchUrlResult | null>(null)

  const run = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null); setRes(null)
    try {
      setRes(await api.fetchNewsUrl(slug, topicId, url.trim()))
      onFetched()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "fetch failed")
    } finally {
      setBusy(false)
    }
  }

  const item = res?.item
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4">
      <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <CardHeader><CardTitle className="text-base">Fetch one article</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={run} className="space-y-3">
            <Field label="Article URL">
              <Input required type="url" autoFocus placeholder="https://…" value={url} disabled={busy} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <p className="text-xs text-muted-foreground">The article is read, matched against this topic's RSS sources, and analyzed by AI. The URL is kept as the post's source line.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>{res ? "Close" : "Cancel"}</Button>
              <Button type="submit" disabled={busy || !url.trim()}>{busy ? "Analyzing…" : "Fetch & analyze"}</Button>
            </div>
          </form>
          {busy && <p className="text-sm text-muted-foreground" aria-live="polite">Reading the article and analyzing it — up to a minute.</p>}
          {err && <p className="text-sm text-destructive">{err}</p>}
          {item && (
            <div className="space-y-2 rounded-lg border p-3 text-sm">
              <p className="font-medium">{item.title}</p>
              <p className="break-all text-xs text-muted-foreground">
                <a className="underline" href={item.url} target="_blank" rel="noreferrer">{item.domain}</a> · {item.published_at ?? "no date"}
                {res.matchedSource ? ` · found in RSS: ${res.matchedSource}` : " · not in your RSS sources"}
              </p>
              <p className="text-xs"><span className={item.status === "valid" ? "text-emerald-500" : "text-amber-500"}>{item.status}</span> · score {item.score ?? "—"}</p>
              {item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}
              {res.known && <p className="text-xs text-amber-500">Already in this topic ({item.status}) — kept as is.</p>}
              {res.analysis && res.analysis.key_points.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {res.analysis.key_points.map((k, i) => <li key={i}>{k}</li>)}
                </ul>
              )}
              {item.status === "valid" && !item.post_id && (
                <div className="flex justify-end"><Button size="sm" onClick={() => onGenerate(item.id)}>Generate</Button></div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RulesCard({ slug, topicId, rules, onSaved }: { slug: string; topicId: string; rules: { freshness_hours: number; min_sources: number; allowed_domains: string[]; blocked_domains: string[]; keywords: string[] }; onSaved: () => void }) {
  const [form, setForm] = useState({
    freshness_hours: rules.freshness_hours,
    min_sources: rules.min_sources,
    allowed_domains: rules.allowed_domains.join(", "),
    blocked_domains: rules.blocked_domains.join(", "),
    keywords: rules.keywords.join(", "),
  })
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    setForm({
      freshness_hours: rules.freshness_hours,
      min_sources: rules.min_sources,
      allowed_domains: rules.allowed_domains.join(", "),
      blocked_domains: rules.blocked_domains.join(", "),
      keywords: rules.keywords.join(", "),
    })
  }, [rules])

  const list = (s: string) => s.split(",").map((x) => x.trim()).filter(Boolean)
  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.saveNewsRules(slug, topicId, {
        freshness_hours: form.freshness_hours,
        min_sources: form.min_sources,
        allowed_domains: list(form.allowed_domains),
        blocked_domains: list(form.blocked_domains),
        keywords: list(form.keywords),
      })
      onSaved()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "failed to save rules")
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Rules</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={save} className="grid gap-3 md:grid-cols-2">
          <Field label="Freshness hours"><Input type="number" min={1} value={form.freshness_hours} onChange={(e) => setForm({ ...form, freshness_hours: Number(e.target.value) })} /></Field>
          <Field label="Minimum sources"><Input type="number" min={1} value={form.min_sources} onChange={(e) => setForm({ ...form, min_sources: Number(e.target.value) })} /></Field>
          <Field label="Allowed domains"><Input value={form.allowed_domains} placeholder="example.com, news.site" onChange={(e) => setForm({ ...form, allowed_domains: e.target.value })} /></Field>
          <Field label="Blocked domains"><Input value={form.blocked_domains} placeholder="spam.site" onChange={(e) => setForm({ ...form, blocked_domains: e.target.value })} /></Field>
          <Field label="Keywords"><Input value={form.keywords} placeholder="ai, open source" onChange={(e) => setForm({ ...form, keywords: e.target.value })} /></Field>
          <div className="self-end"><Button type="submit">Save rules</Button></div>
          {err && <p className="text-sm text-destructive md:col-span-2">{err}</p>}
        </form>
      </CardContent>
    </Card>
  )
}

function SourcesCard({ slug, topicId, sources, reload, setMsg }: { slug: string; topicId: string; sources: { id: string; name: string; url: string }[]; reload: () => void; setMsg: (s: string | null) => void }) {
  const [form, setForm] = useState({ name: "", url: "" })
  const [err, setErr] = useState<string | null>(null)
  const add = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    try {
      await api.addNewsSource(slug, topicId, form)
      setForm({ name: "", url: "" })
      reload()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "failed to add source")
    }
  }

  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Sources</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={add} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Field label="Name"><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="URL"><Input required type="url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} /></Field>
          <Button type="submit" className="self-end">Add</Button>
        </form>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <div className="divide-y rounded-lg border">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-3 text-sm">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{s.name}</p>
                <p className="break-all text-xs text-muted-foreground">{s.url}</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="delete" onClick={() => api.delNewsSource(slug, topicId, s.id).then(() => { setMsg(null); reload() })}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          ))}
          {sources.length === 0 && <p className="p-4 text-sm text-muted-foreground">no sources yet</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function ItemsCard({ slug, topicId, items, reload, setMsg, onGenerate }: { slug: string; topicId: string; items: { id: string; title: string; url: string; domain: string; status: string; score: number | null; published_at: string | null; reason: string | null; post_id: string | null }[]; reload: () => void; setMsg: (s: string | null) => void; onGenerate: (itemId?: string) => void }) {
  const [status, setStatus] = useState("all")
  const [selected, setSelected] = useState<string[]>([])
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1
    return acc
  }, { all: items.length })
  const filtered = status === "all" ? items : items.filter((i) => i.status === status)
  const toggle = (id: string) => setSelected((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id])
  const del = async (p: { ids?: string[]; status?: 'pending' | 'valid' | 'rejected' | 'used' }) => {
    const r = await api.deleteNewsItems(slug, topicId, p)
    setSelected([])
    setMsg(`deleted ${r.deleted} items`)
    reload()
  }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Latest items</CardTitle>
        <div className="flex flex-wrap gap-2">
          {["all", "pending", "valid", "rejected", "used"].map((s) => (
            <Button key={s} type="button" variant={status === s ? "default" : "outline"} size="sm" onClick={() => setStatus(s)}>
              {s} {counts[s] ?? 0}
            </Button>
          ))}
          <Button type="button" variant="outline" size="sm" disabled={selected.length === 0} onClick={() => del({ ids: selected })}>Delete selected {selected.length}</Button>
          <Button type="button" variant="destructive" size="sm" disabled={(counts.rejected ?? 0) === 0} onClick={() => del({ status: "rejected" })}>Delete rejected</Button>
        </div>
      </CardHeader>
      <CardContent className="divide-y p-0">
        {filtered.map((i) => (
          <div key={i.id} className="flex gap-3 p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} aria-label="select item" />
            <div className="min-w-0 flex-1">
              <div className="flex gap-2">
                <p className="min-w-0 flex-1 font-medium">{i.title}</p>
                {i.status === "valid" && <Button type="button" variant="outline" size="sm" onClick={() => onGenerate(i.id)}>Generate</Button>}
                {i.post_id && <Button type="button" variant="ghost" size="sm" onClick={() => navigate(`/app/${slug}/news/${topicId}/items/${i.id}`)}><ExternalLink className="size-3" /> Detail</Button>}
                <span className="text-xs text-muted-foreground">{i.status}{i.score === null ? "" : ` · ${i.score}`}</span>
              </div>
              <p className="break-all text-xs text-muted-foreground">{i.domain} · {i.published_at ?? "no date"}</p>
              {i.reason && <p className="mt-1 text-xs text-muted-foreground">{i.reason}</p>}
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">no items for this filter</p>}
      </CardContent>
    </Card>
  )
}

// Two-stage progress: feeds (network) then items (rule check + AI scoring — the slow part).
function IngestPanel({ p }: { p: IngestProgress }) {
  const elapsed = Math.round((p.updatedAt - p.startedAt) / 1000)
  const bar = (done: number, total: number) => (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
    </div>
  )
  return (
    <Card>
      <CardContent className="space-y-3 p-4 text-sm" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <p className="font-medium">
            <span className="mr-2 inline-block size-2 animate-pulse rounded-full bg-emerald-500" />
            {p.phase}
          </p>
          <span className="text-xs text-muted-foreground">{elapsed}s</span>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">Feeds {p.feeds.done}/{p.feeds.total}{p.feeds.failed ? ` · ${p.feeds.failed} failed` : ""}</p>
          {bar(p.feeds.done, p.feeds.total)}
        </div>
        {p.items.total > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Items checked {p.items.done}/{p.items.total}</p>
            {bar(p.items.done, p.items.total)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>
}
