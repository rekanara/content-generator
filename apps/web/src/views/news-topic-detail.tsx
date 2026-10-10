import { useEffect, useState } from "react"
import { ExternalLink, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { api, ApiError, type IngestProgress } from "@/lib/api"
import { useApi, useNewsTopic, useTemplates } from "@/lib/hooks"
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
  const [validCount, setValidCount] = useState(0)

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
          <Button variant="outline" size="sm" onClick={() => navigate(`/app/${slug}/news/${id}/fetch`)}>Fetch article(s)</Button>
          <Button variant="default" size="sm" disabled={generating || validCount === 0} onClick={() => openGenerate()}>{generating ? "Generating…" : "Generate latest valid"}</Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/app/${slug}/news`)}>Back</Button>
        </div>
      </div>
      {ingesting && progress && <IngestPanel p={progress} />}
      {msg && <p className="text-sm text-amber-500">{msg}</p>}
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
      <ItemsCard slug={slug} topicId={id} version={topic} reload={reload} setMsg={setMsg} onGenerate={openGenerate} onValidCount={setValidCount} />
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

const STATUSES = ["all", "pending", "valid", "rejected", "used"] as const
const SORTS = [["created", "Discovered"], ["published", "Published"], ["score", "Score"]] as const

// Server-side filter/sort/search/pagination. `version` = parent's reloaded topic object → refetch after ingest/fetch-url/etc.
function ItemsCard({ slug, topicId, version, reload, setMsg, onGenerate, onValidCount }: { slug: string; topicId: string; version: unknown; reload: () => void; setMsg: (s: string | null) => void; onGenerate: (itemId?: string) => void; onValidCount: (n: number) => void }) {
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("all")
  const [sort, setSort] = useState<(typeof SORTS)[number][0]>("created")
  const [dir, setDir] = useState<"asc" | "desc">("desc")
  const [q, setQ] = useState("")
  const [qDebounced, setQDebounced] = useState("")
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(20)
  const [selected, setSelected] = useState<string[]>([])
  const [confirm, setConfirm] = useState<"valid" | "used" | "rejected" | null>(null)

  useEffect(() => { const t = window.setTimeout(() => { setQDebounced(q.trim()); setPage(1) }, 300); return () => window.clearTimeout(t) }, [q])

  const { data, error, loading, reload: reloadItems } = useApi(
    () => api.newsItems(slug, topicId, { status, sort, dir, q: qDebounced, page, size }),
    [slug, topicId, status, sort, dir, qDebounced, page, size, version],
  )
  useEffect(() => { if (data) onValidCount(data.counts.valid ?? 0) }, [data, onValidCount])

  const items = data?.items ?? []
  const counts = data?.counts ?? {}
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / size))
  const toggle = (id: string) => setSelected((xs) => xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id])
  const allOnPage = items.length > 0 && items.every((i) => selected.includes(i.id))
  const del = async (p: { ids?: string[]; status?: "pending" | "valid" | "rejected" | "used" }) => {
    const r = await api.deleteNewsItems(slug, topicId, p)
    setSelected([]); setConfirm(null)
    setMsg(`deleted ${r.deleted} items`)
    if (page > 1 && items.length <= r.deleted) setPage(page - 1)
    reload(); reloadItems()
  }
  const pick = (fn: () => void) => { fn(); setPage(1); setSelected([]) }

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle className="text-base">Items</CardTitle>
        <div className="flex flex-wrap gap-2">
          {STATUSES.map((s) => (
            <Button key={s} type="button" variant={status === s ? "default" : "outline"} size="sm" onClick={() => pick(() => setStatus(s))}>
              {s} {counts[s] ?? 0}
            </Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input className="h-8 w-56" placeholder="Search title or domain" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search items" />
          <select className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Sort by" value={sort} onChange={(e) => pick(() => setSort(e.target.value as typeof sort))}>
            {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <Button type="button" variant="outline" size="sm" aria-label="Toggle sort direction" onClick={() => pick(() => setDir(dir === "desc" ? "asc" : "desc"))}>{dir === "desc" ? "Newest / highest first" : "Oldest / lowest first"}</Button>
          <select className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Page size" value={size} onChange={(e) => pick(() => setSize(Number(e.target.value)))}>
            {[10, 20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
          </select>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={selected.length === 0} onClick={() => del({ ids: selected })}>Delete selected {selected.length}</Button>
          {(["rejected", "valid", "used"] as const).map((s) => (
            <Button key={s} type="button" variant="destructive" size="sm" disabled={(counts[s] ?? 0) === 0} onClick={() => setConfirm(s)}>Delete {s} {counts[s] ?? 0}</Button>
          ))}
        </div>
        {confirm && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <span>Delete all {counts[confirm] ?? 0} {confirm} items in this topic{qDebounced ? " (ignores the search filter)" : ""}?{confirm === "used" ? " Their generated posts stay." : ""}{confirm === "valid" ? " They can be re-fetched, but you lose their scores." : ""}</span>
            <Button type="button" variant="destructive" size="sm" onClick={() => del({ status: confirm })}>Yes, delete</Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirm(null)}>Cancel</Button>
          </div>
        )}
      </CardHeader>
      <CardContent className="divide-y p-0">
        {error && <p className="p-4 text-sm text-destructive">{error}</p>}
        {items.length > 0 && (
          <label className="flex items-center gap-3 px-4 py-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={allOnPage} onChange={() => setSelected(allOnPage ? selected.filter((id) => !items.some((i) => i.id === id)) : [...new Set([...selected, ...items.map((i) => i.id)])])} aria-label="select all on page" />
            Select page
          </label>
        )}
        {items.map((i) => (
          <div key={i.id} className="flex gap-3 p-4 text-sm">
            <input type="checkbox" className="mt-1" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} aria-label="select item" />
            <div className="min-w-0 flex-1">
              <div className="flex gap-2">
                <p className="min-w-0 flex-1 font-medium">{i.title}</p>
                {i.status === "valid" && <Button type="button" variant="outline" size="sm" onClick={() => onGenerate(i.id)}>Generate</Button>}
                {i.post_id && <Button type="button" variant="ghost" size="sm" onClick={() => navigate(`/app/${slug}/news/${topicId}/items/${i.id}`)}><ExternalLink className="size-3" /> Detail</Button>}
                <span className="text-xs text-muted-foreground">{i.status}{i.score === null ? "" : ` · ${i.score}`}</span>
              </div>
              <p className="break-all text-xs text-muted-foreground">{i.domain} · published {i.published_at ? new Date(i.published_at).toLocaleString("en-US") : "no date"} · found {new Date(i.created_at).toLocaleString("en-US")}</p>
              {i.reason && <p className="mt-1 text-xs text-muted-foreground">{i.reason}</p>}
            </div>
          </div>
        ))}
        {!loading && items.length === 0 && <p className="p-4 text-sm text-muted-foreground">no items for this filter</p>}
        {loading && !data && <p className="p-4 text-sm text-muted-foreground">loading…</p>}
        <div className="flex items-center justify-between gap-2 p-3 text-xs text-muted-foreground">
          <span>{total === 0 ? "0 items" : `${(page - 1) * size + 1}–${Math.min(page * size, total)} of ${total}`}</span>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => { setPage(page - 1); setSelected([]) }}>Prev</Button>
            <span>{page} / {pages}</span>
            <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => { setPage(page + 1); setSelected([]) }}>Next</Button>
          </div>
        </div>
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
