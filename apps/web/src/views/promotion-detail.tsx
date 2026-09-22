import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowLeft, CalendarClock, Check, Send, Sparkles, Trash2, Upload } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { api, ApiError } from "@/lib/api"
import { usePromotion } from "@/lib/hooks"
import { navigate } from "@/lib/router"

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  content_ready: "bg-blue-500/15 text-blue-500 border-transparent",
  awaiting_images: "bg-cyan-500/15 text-cyan-500 border-transparent",
  ready: "bg-emerald-500/15 text-emerald-500 border-transparent",
  sent: "bg-zinc-500/15 text-zinc-500 border-transparent",
}

type SlotStatus = { slide: number; prompt: string; present: boolean }

export function PromotionDetailView({ slug, id }: { slug: string; id: string }) {
  const { data, error, loading, reload } = usePromotion(slug, id)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [scheduleDate, setScheduleDate] = useState("")
  const fileInputs = useRef<Record<number, HTMLInputElement | null>>({})
  const [slots, setSlots] = useState<SlotStatus[] | null>(null)
  const [uploadingSlide, setUploadingSlide] = useState<number | null>(null)

  const refreshSlots = useCallback(() => {
    if (!data?.content) { setSlots(null); return }
    api.promoImageSlots(slug, id)
      .then(setSlots)
      .catch(() => setSlots(null))
  }, [slug, id, data?.content])

  useEffect(() => { refreshSlots() }, [refreshSlots])

  const act = async (fn: () => Promise<unknown>, label: string) => {
    setBusy(true); setMsg(null)
    try { await fn(); reload() } catch (e) { setMsg(e instanceof ApiError ? e.message : `${label} failed`) } finally { setBusy(false) }
  }

  const uploadImage = async (slide: number, file: File) => {
    setUploadingSlide(slide); setMsg(null)
    try {
      const r = await api.uploadPromoImage(slug, id, slide, file)
      refreshSlots()
      setMsg(r.allImagesPresent
        ? `Slide ${slide} uploaded ✓ — semua gambar lengkap, promo siap dikirim.`
        : `Slide ${slide} uploaded ✓.`)
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : `upload slide ${slide} failed`)
    } finally {
      setUploadingSlide(null)
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-4">
      <section className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="back" onClick={() => navigate(`/app/${slug}/promotions`)}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{data.name}</h1>
        <Badge variant="secondary" className={STATUS_BADGE[data.status]}>{data.status.replace("_", " ")}</Badge>
        <Button variant="ghost" size="icon" aria-label="delete" onClick={() => api.delPromotion(slug, id).then(() => navigate(`/app/${slug}/promotions`)).catch(() => {})}>
          <Trash2 className="size-4" />
        </Button>
      </section>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      <Card><CardContent className="space-y-2 p-4">
        <p className="text-sm">{data.topic || <span className="text-muted-foreground">(no topic)</span>}</p>
        {(data.features.length > 0 || data.stacks.length > 0 || data.stats.length > 0) && (
          <div className="grid gap-2 text-xs text-muted-foreground md:grid-cols-3">
            <div>{data.features.length > 0 && <>features: {data.features.join(" · ")}</>}</div>
            <div>{data.stacks.length > 0 && <>stacks: {data.stacks.join(" · ")}</>}</div>
            <div>{data.stats.length > 0 && <>stats: {data.stats.join(" · ")}</>}</div>
          </div>
        )}
        <p className="text-sm">
          {data.price_sale ? <><span className="font-semibold text-emerald-600">{data.price_sale}</span> <span className="text-muted-foreground line-through">{data.price}</span></> : data.price || null}
        </p>
      </CardContent></Card>

      <section className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !!data.content} onClick={() => act(() => api.generatePromoContent(slug, id), "generate content")}>
          <Sparkles className="size-4" /> {data.content ? "content ready" : busy ? "generating…" : "Generate content (AI)"}
        </Button>
        {data.content && data.status !== "sent" && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => api.sendPromotion(slug, id), "send")}>
            <Send className="size-4" /> Send now
          </Button>
        )}
        {data.content && data.status !== "sent" && (
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} />
            <Button size="sm" variant="outline" disabled={busy || !scheduleDate} onClick={() => act(() => api.schedulePromotion(slug, id, scheduleDate), "schedule")}>
              <CalendarClock className="size-4" /> Schedule
            </Button>
          </div>
        )}
      </section>

      {data.content && (
        <Card><CardContent className="space-y-2 p-4">
          <h3 className="text-xs font-medium text-muted-foreground">Content preview — {data.content.length} slides</h3>
          <div className="space-y-3">
            {data.content.map((s, i) => (
              <details key={i} className="rounded-md border p-2">
                <summary className="cursor-pointer text-xs">
                  Slide {i + 1} {s.html.includes("{{image}}") && <span className="ml-1 text-cyan-500">· image</span>}
                  {s.image_prompt && <span className="ml-1 text-muted-foreground">· {s.image_prompt.slice(0, 60)}</span>}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[10px] whitespace-pre-wrap break-words">{s.html}</pre>
              </details>
            ))}
          </div>
        </CardContent></Card>
      )}

      {(slots ?? []).length > 0 && (
        <Card><CardContent className="space-y-3 p-4">
          <h3 className="text-xs font-medium text-muted-foreground">
            Images ({slots!.filter((s) => s.present).length}/{slots!.length} uploaded) — slide yang pakai {"{{image}}"}
          </h3>
          {slots!.map((s) => (
            <div key={s.slide} className="flex flex-wrap items-center gap-2">
              <span className="w-16 shrink-0 text-xs font-medium">slide {s.slide}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{s.prompt || "(no description)"}</span>
              {s.present && (
                <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-500 border-transparent">
                  <Check className="mr-1 size-3" />uploaded
                </Badge>
              )}
              <input ref={(el) => { fileInputs.current[s.slide] = el }} type="file" accept="image/*" className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) void uploadImage(s.slide, f)
                  e.target.value = ""
                }} />
              <Button size="sm" variant={s.present ? "ghost" : "outline"} disabled={uploadingSlide !== null}
                onClick={() => fileInputs.current[s.slide]?.click()}>
                {uploadingSlide === s.slide
                  ? <><Upload className="size-4 animate-pulse" /> uploading…</>
                  : s.present ? <><Upload className="size-4" /> Ganti</> : <><Upload className="size-4" /> Upload</>}
              </Button>
            </div>
          ))}
          {slots!.every((s) => s.present) && (
            <p className="text-xs text-emerald-600">Semua gambar lengkap — promo siap dikirim.</p>
          )}
        </CardContent></Card>
      )}
    </div>
  )
}
