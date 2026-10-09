import { useState } from "react"
import { BookOpen, ExternalLink, Play, RefreshCw, Trash2 } from "lucide-react"
import { Badge } from "@workspace/ui/components/badge"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { api, ApiError } from "@/lib/api"
import { useTemplates, useTutorials } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import type { Tutorial } from "@workspace/shared"

const STATUS: Record<Tutorial["status"], string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  queued: "bg-blue-500/15 text-blue-500 border-transparent",
  generated: "bg-emerald-500/15 text-emerald-500 border-transparent",
  failed: "bg-red-500/15 text-red-500 border-transparent",
}

const EMPTY = { topic: "", level: "beginner" as const, language: "id", urls: "", template_id: "", template_reel_id: "" }

export function TutorialsView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useTutorials(slug)
  const { data: templates } = useTemplates(slug)
  const [form, setForm] = useState<{ topic: string; level: "beginner" | "intermediate"; language: string; urls: string; template_id: string; template_reel_id: string }>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [pick, setPick] = useState<Tutorial | null>(null)

  const carouselTemplates = (templates ?? []).filter((t) => t.type === "regular" && ["ig-carousel", "ig-news-card"].includes(t.format))
  const reelTemplates = (templates ?? []).filter((t) => t.type === "regular" && t.format === "reel")

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const source_urls = form.urls.split(/\s+/).map((u) => u.trim()).filter(Boolean)
    setBusy(true); setMsg(null)
    try {
      await api.addTutorial(slug, {
        topic: form.topic, level: form.level, language: form.language, source_urls,
        template_id: form.template_id || null, template_reel_id: form.template_reel_id || null,
      })
      setForm(EMPTY)
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to create tutorial")
    } finally {
      setBusy(false)
    }
  }

  const generate = async (t: Tutorial, format: "carousel" | "reels") => {
    setBusy(true); setMsg(null)
    try {
      await api.generateTutorial(slug, t.id, format)
      setPick(null)
      setMsg(`queued ${format} — check Posts / Telegram for approval`)
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "generate failed")
    } finally {
      setBusy(false)
    }
  }

  const del = async (t: Tutorial) => {
    if (!window.confirm(`Delete tutorial "${t.topic}"? Generated posts stay.`)) return
    try {
      await api.delTutorial(slug, t.id)
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "delete failed")
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><BookOpen className="size-5" /> Tutorials</h1>
        <p className="text-sm text-muted-foreground">Step-by-step tutorials grounded in official docs. Every command is checked against the sources; posts always wait for approval and never change the rotation.</p>
      </section>

      <form onSubmit={submit} className="grid gap-3 rounded-lg border p-4 md:grid-cols-2">
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="tut-topic">Topic</Label>
          <Input id="tut-topic" required minLength={3} maxLength={200} placeholder="Setup OpenClaw di Mac" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="tut-urls">Official source URLs (1-5, one per line)</Label>
          <Textarea id="tut-urls" required rows={3} placeholder={"https://docs.openclaw.ai/install\nhttps://github.com/openclaw/openclaw#readme"} value={form.urls} onChange={(e) => setForm({ ...form, urls: e.target.value })} />
          <p className="text-xs text-muted-foreground">Docs pages or raw README links. Commands not found here are rejected.</p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tut-level">Level</Label>
          <select id="tut-level" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value as "beginner" | "intermediate" })}>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tut-lang">Language</Label>
          <select id="tut-lang" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })}>
            <option value="id">Indonesian</option>
            <option value="en">English</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tut-tpl">Carousel template</Label>
          <select id="tut-tpl" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
            <option value="">Auto template</option>
            {carouselTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.format}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="tut-reel">Reel template</Label>
          <select id="tut-reel" className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={form.template_reel_id} onChange={(e) => setForm({ ...form, template_reel_id: e.target.value })}>
            <option value="">No reel template</option>
            {reelTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <p className="text-xs text-muted-foreground">Tip: create a reel template from the "Terminal Tutorial" preset.</p>
        </div>
        <div className="flex items-end justify-end md:col-span-2">
          <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Add tutorial"}</Button>
        </div>
      </form>

      {msg && <p className="text-sm text-amber-500">{msg}</p>}
      {loading && !data && <p className="text-sm text-muted-foreground">loading…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <section className="divide-y rounded-lg border">
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no tutorials yet</p>}
        {data?.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <Badge variant="secondary" className={STATUS[t.status]}>{t.status}</Badge>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{t.topic}</p>
              <p className="truncate text-xs text-muted-foreground">{t.level} · {t.language} · {t.source_urls.map((u) => new URL(u).hostname).join(", ")}</p>
              {t.error && <p className="mt-1 text-xs break-words text-red-500">{t.error}</p>}
            </div>
            {t.post_id && <Button variant="ghost" size="sm" onClick={() => navigate(`/app/${slug}/posts/${t.post_id}`)}><ExternalLink className="size-4" /> Post</Button>}
            <Button size="sm" disabled={busy || t.status === "queued"} onClick={() => setPick(t)}>
              {t.status === "generated" || t.status === "failed" ? <RefreshCw className="size-4" /> : <Play className="size-4" />}
              {t.status === "queued" ? "Queued…" : t.status === "draft" ? "Generate" : "Generate again"}
            </Button>
            <Button variant="ghost" size="icon" aria-label="delete" disabled={t.status === "queued"} onClick={() => del(t)}><Trash2 className="size-4" /></Button>
          </div>
        ))}
      </section>

      {pick && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-background/80 p-4" role="dialog" aria-modal="true" aria-labelledby="tut-pick-title">
          <Card className="w-full max-w-md">
            <CardHeader><CardTitle id="tut-pick-title" className="text-base">Generate "{pick.topic}"</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">Keep the default carousel, or make a reel?</p>
              <div className="grid gap-2">
                <Button disabled={busy} onClick={() => generate(pick, "carousel")}>Carousel (default)</Button>
                <Button variant="outline" disabled={busy || !pick.template_reel_id} onClick={() => generate(pick, "reels")}>Reels</Button>
                {!pick.template_reel_id && <p className="text-xs text-muted-foreground">Reels needs a reel template on this tutorial.</p>}
              </div>
              <div className="flex justify-end"><Button variant="ghost" disabled={busy} onClick={() => setPick(null)}>Cancel</Button></div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
