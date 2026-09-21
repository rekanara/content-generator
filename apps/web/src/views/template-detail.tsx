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

// 1×1 gray PNG — placeholder for the {{image}} token in first-kind previews.
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

export function TemplateDetailView({ slug, id }: { slug: string; id: string }) {
  const { data, error, loading, reload } = useTemplate(slug, id)
  const [name, setName] = useState("")
  const [html, setHtml] = useState("")
  const [touched, setTouched] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [previewHtml, setPreviewHtml] = useState("")

  // prefill once when detail loads; user edits after that win
  useEffect(() => {
    if (data && !touched) {
      setName(data.name)
      setHtml(data.html)
    }
  }, [data, touched])

  // debounced preview re-render while typing
  useEffect(() => {
    const t = setTimeout(() => {
      if (data) setPreviewHtml(fillTokens(html, data.format))
    }, 300)
    return () => clearTimeout(t)
  }, [html, data])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.patchTemplate(slug, id, { name, html })
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
      setMsg("activated — one active template per format, siblings deactivated")
    } catch (e2) {
      setMsg(e2 instanceof ApiError ? e2.message : "failed to activate")
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-4">
      <section className="flex items-center gap-2">
        <Button variant="ghost" size="icon" aria-label="back" onClick={() => navigate(`/app/${slug}/templates`)}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-lg font-semibold">{data.name}</h1>
        <Badge variant="secondary">{data.format}</Badge>
        {data.kind !== "body" && (
          <Badge variant="secondary" className="bg-sky-500/15 text-sky-500 border-transparent">{data.kind}</Badge>
        )}
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

      {/* minmax(0,1fr): editor takes all remaining width, never overflows the container */}
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
                token: {TEMPLATE_TOKENS[data.format][data.kind].join(" ")} · format & kind are immutable · updated {new Date(data.updated_at).toLocaleString("en-US")}
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-html">HTML template</Label>
                <Textarea id="tpl-html" className="min-h-[32rem] font-mono text-xs leading-relaxed" required value={html}
                  spellCheck={false}
                  onChange={(e) => { setHtml(e.target.value); setTouched(true) }} />
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || (!touched && name === data.name && html === data.html)}>
                  {busy ? "saving…" : "Save"}
                </Button>
                <Button type="button" variant="ghost" disabled={!touched}
                  onClick={() => { setName(data.name); setHtml(data.html); setTouched(false); setMsg(null) }}>
                  Revert
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <TemplatePreview html={previewHtml} format={data.format} />
      </div>
    </div>
  )
}

function TemplatePreview({ html, format }: { html: string; format: TemplateFormat }) {
  const dim = format === "reel" ? REEL : CARD
  const PREVIEW_W = 360
  const scale = PREVIEW_W / dim.w
  return (
    <div className="space-y-1.5 self-start">
      <p className="text-xs font-medium text-muted-foreground">
        Preview · {dim.w}×{dim.h} · sample data
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
