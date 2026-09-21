import { useEffect, useState } from "react"
import { ArrowLeft, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { api, ApiError } from "@/lib/api"
import { useTemplate } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import { TEMPLATE_TOKENS, type TemplateFormat } from "@workspace/shared"

// ——— preview: token fill, mirroring render/template.ts (esc + {{token}}) ———

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// 1×1 gray PNG — placeholder for the {{image}} token in cover previews.
const GRAY_IMG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

const SAMPLES: Record<TemplateFormat, Record<string, string>> = {
  "ig-carousel": { headline: esc("Cara deploy tanpa downtime"), body: esc("Contoh body untuk preview — ganti template di kiri, hasilnya langsung terlihat di sini."), index: "2", total: "8", image: GRAY_IMG },
  "li-carousel": { headline: esc("Cara deploy tanpa downtime"), body: esc("Contoh body untuk preview — ganti template di kiri, hasilnya langsung terlihat di sini."), index: "2", total: "8", image: GRAY_IMG },
  reel: { overlay: esc("Bug muncul pas demo"), index: "2", total: "5" },
}

function fillTokens(html: string, format: TemplateFormat): string {
  return html.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => SAMPLES[format]![k] ?? "")
}

// Artifacts render at 1080×1350 (carousel) / 1080×1920 (reel) — scale the iframe to fit.
const REEL = { w: 1080, h: 1920 } as const
const CARD = { w: 1080, h: 1350 } as const

type Part = "body" | "first" | "last"

export function TemplateDetailView({ slug, id }: { slug: string; id: string }) {
  const { data, error, loading, reload } = useTemplate(slug, id)
  const [name, setName] = useState("")
  const [html, setHtml] = useState("")
  const [htmlFirst, setHtmlFirst] = useState("")
  const [htmlLast, setHtmlLast] = useState("")
  const [touched, setTouched] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [tab, setTab] = useState<Part>("body")
  const [previewHtml, setPreviewHtml] = useState("")

  // prefill once when detail loads; user edits after that win
  useEffect(() => {
    if (data && !touched) {
      setName(data.name)
      setHtml(data.html)
      setHtmlFirst(data.html_first ?? "")
      setHtmlLast(data.html_last ?? "")
    }
  }, [data, touched])

  // debounced preview re-render while typing — follows the active tab
  useEffect(() => {
    const t = setTimeout(() => {
      if (!data) return
      const src = tab === "body" ? html : tab === "first" ? htmlFirst : htmlLast
      setPreviewHtml(src ? fillTokens(src, data.format) : "")
    }, 300)
    return () => clearTimeout(t)
  }, [html, htmlFirst, htmlLast, tab, data])

  const isReel = data?.format === "reel"

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.patchTemplate(slug, id, {
        name,
        html,
        html_first: isReel || htmlFirst === "" ? null : htmlFirst,
        html_last: isReel || htmlLast === "" ? null : htmlLast,
      })
      setTouched(false)
      reload()
      setMsg("saved")
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : "failed to save")
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    setBusy(true)
    try {
      await api.delTemplate(slug, id)
      navigate(`/app/${slug}/templates`)
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : "failed to delete")
      setBusy(false)
    }
  }

  const activate = async () => {
    setBusy(true); setMsg(null)
    try {
      await api.activateTemplate(slug, id)
      reload()
      setMsg("activated — one active template per format")
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : "failed to activate")
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!data) return null

  const dirty =
    touched && (name !== data.name || html !== data.html ||
      htmlFirst !== (data.html_first ?? "") || htmlLast !== (data.html_last ?? ""))

  const tabs: { id: Part; label: string; value: string; has: boolean }[] = [
    { id: "body", label: "Body", value: html, has: true },
    { id: "first", label: "Cover", value: htmlFirst, has: !isReel },
    { id: "last", label: "CTA", value: htmlLast, has: !isReel },
  ]

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="back" onClick={() => navigate(`/app/${slug}/templates`)}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{data.name}</h1>
        <Badge variant="secondary">{data.format}</Badge>
        <button onClick={activate} disabled={busy}>
          <Badge variant="secondary" className={data.is_active ? "bg-emerald-500/15 text-emerald-500 border-transparent" : ""}>
            {data.is_active ? "active" : "off"}
          </Badge>
        </button>
        <Button variant="ghost" size="icon" aria-label="delete" disabled={busy} onClick={del}>
          <Trash2 className="size-4" />
        </Button>
      </section>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <Card className="min-w-0">
          <CardContent className="p-4">
            <form onSubmit={save} className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Template name</Label>
                <Input id="tpl-name" required value={name}
                  onChange={(e) => { setName(e.target.value); setTouched(true) }} />
              </div>
              <p className="text-xs text-muted-foreground">
                format is immutable · updated {new Date(data.updated_at).toLocaleString("en-US")}
              </p>

              <div className="flex gap-1 rounded-md bg-muted p-1">
                {tabs.filter((t) => t.has).map((t) => (
                  <button key={t.id} type="button"
                    className={"flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors " +
                      (tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
                    onClick={() => setTab(t.id)}>
                    {t.label}{t.id !== "body" && (t.value ? "" : " ·")}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                token: {TEMPLATE_TOKENS[data.format][tab]?.join(" ") ?? TEMPLATE_TOKENS[data.format].body.join(" ")}
                {tab === "first" && " · cover needs a generated image (group Image Model setting)"}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor="tpl-html">
                  {tab === "body" ? "Body HTML (middle slides)" : tab === "first" ? "Cover HTML (first slide)" : "CTA HTML (last slide)"}
                </Label>
                <Textarea
                  id="tpl-html" className="min-h-[32rem] font-mono text-xs leading-relaxed" required
                  spellCheck={false}
                  placeholder={tab === "first" ? "empty = no cover page (falls back to body)" : tab === "last" ? "empty = no CTA page (falls back to body)" : undefined}
                  value={tab === "body" ? html : tab === "first" ? htmlFirst : htmlLast}
                  onChange={(e) => {
                    const v = e.target.value
                    if (tab === "body") setHtml(v)
                    else if (tab === "first") setHtmlFirst(v)
                    else setHtmlLast(v)
                    setTouched(true)
                  }} />
              </div>

              <div className="flex gap-2">
                <Button type="submit" disabled={busy || !dirty}>
                  {busy ? "saving…" : "Save"}
                </Button>
                <Button type="button" variant="ghost" disabled={!dirty}
                  onClick={() => {
                    setName(data.name); setHtml(data.html)
                    setHtmlFirst(data.html_first ?? ""); setHtmlLast(data.html_last ?? "")
                    setTouched(false); setMsg(null)
                  }}>
                  Revert
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        {previewHtml && <TemplatePreview html={previewHtml} format={data.format} label={tab} />}
        {!previewHtml && tab !== "body" && (
          <div className="flex w-90 items-center justify-center rounded-lg border border-dashed p-6 text-xs text-muted-foreground">
            empty {tab === "first" ? "cover" : "CTA"} — falls back to the body template
          </div>
        )}
      </div>
    </div>
  )
}

function TemplatePreview({ html, format, label }: { html: string; format: TemplateFormat; label: Part }) {
  const dim = format === "reel" ? REEL : CARD
  const PREVIEW_W = 360
  const scale = PREVIEW_W / dim.w
  return (
    <div className="space-y-1.5 self-start">
      <p className="text-xs font-medium text-muted-foreground">
        Preview · {label} · {dim.w}×{dim.h} · sample data
      </p>
      <div
        className="overflow-hidden rounded-lg border bg-muted"
        style={{ width: PREVIEW_W, height: Math.round(dim.h * scale) }}
      >
        <iframe
          title="template preview"
          srcDoc={html}
          sandbox=""
          className="border-0"
          style={{ width: dim.w, height: dim.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
        />
      </div>
    </div>
  )
}
