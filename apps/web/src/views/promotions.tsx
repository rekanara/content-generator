import { useState } from "react"
import { Megaphone, Plus, Sparkles } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { api, ApiError } from "@/lib/api"
import { usePromotions, useTemplates } from "@/lib/hooks"
import { navigate } from "@/lib/router"

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-transparent",
  content_ready: "bg-blue-500/15 text-blue-500 border-transparent",
  awaiting_images: "bg-cyan-500/15 text-cyan-500 border-transparent",
  ready: "bg-emerald-500/15 text-emerald-500 border-transparent",
  sent: "bg-zinc-500/15 text-zinc-500 border-transparent",
}

export function PromotionsView({ slug }: { slug: string }) {
  const { data, error, loading } = usePromotions(slug)
  const { data: templates } = useTemplates(slug)
  const [mode, setMode] = useState<"off" | "manual" | "brief">("off")
  const [brief, setBrief] = useState("")
  const [form, setForm] = useState({ name: "", topic: "", features: "", stacks: "", stats: "", price: "", price_sale: "", template_id: "none" })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const promoTemplates = (templates ?? []).filter((t) => t.format.endsWith("-promo"))

  const submitManual = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const p = await api.addPromotion(slug, {
        name: form.name, topic: form.topic,
        features: form.features.split("\n").map((s) => s.trim()).filter(Boolean),
        stacks: form.stacks.split("\n").map((s) => s.trim()).filter(Boolean),
        stats: form.stats.split("\n").map((s) => s.trim()).filter(Boolean),
        price: form.price, price_sale: form.price_sale,
        template_id: form.template_id === "none" ? null : form.template_id,
      })
      navigate(`/app/${slug}/promotions/${p.id}`)
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to create")
    } finally { setBusy(false) }
  }

  const submitBrief = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const p = await api.addPromotion(slug, {
        brief,
        template_id: form.template_id === "none" ? null : form.template_id,
      } as never)
      navigate(`/app/${slug}/promotions/${p.id}`)
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "AI brief failed")
    } finally { setBusy(false) }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Promotions</h1>
        <div className="flex gap-2">
          <Button size="sm" variant={mode === "manual" ? "default" : "outline"} onClick={() => setMode(mode === "manual" ? "off" : "manual")}>
            <Plus className="size-4" /> Manual
          </Button>
          <Button size="sm" variant={mode === "brief" ? "default" : "outline"} onClick={() => setMode(mode === "brief" ? "off" : "brief")}>
            <Sparkles className="size-4" /> From AI brief
          </Button>
        </div>
      </section>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      {mode === "brief" && (
        <Card><CardContent className="p-4">
          <form onSubmit={submitBrief} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="brief">Brief kasar — AI akan draft data promo lengkap</Label>
              <Textarea id="brief" className="min-h-24" required placeholder="e.g. jasa audit & refactor codebase, target startup, harga 1.5jt, pernah 10+ proyek…" value={brief} onChange={(e) => setBrief(e.target.value)} />
            </div>
            <div className="max-w-xs space-y-1.5">
              <Label htmlFor="brief-tpl">Template (promo format)</Label>
              <select id="brief-tpl" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
                <option value="none">default</option>
                {promoTemplates.map((t) => <option key={t.id} value={t.id}>{t.name} · {t.format}</option>)}
              </select>
              <p className="text-xs text-muted-foreground">AI draft datanya; konten slide nulis di template ini.</p>
            </div>
            <Button type="submit" disabled={busy || !brief.trim()}>{busy ? "drafting…" : "Draft with AI"}</Button>
          </form>
        </CardContent></Card>
      )}

      {mode === "manual" && (
        <Card><CardContent className="p-4">
          <form onSubmit={submitManual} className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_220px]">
              <div className="space-y-1.5">
                <Label htmlFor="pr-name">Name</Label>
                <Input id="pr-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-topic">Topic / angle</Label>
                <Input id="pr-topic" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Template (promo format)</Label>
                <select className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={form.template_id} onChange={(e) => setForm({ ...form, template_id: e.target.value })}>
                  <option value="none">default</option>
                  {promoTemplates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="pr-features">Features (1 per line)</Label>
                <Textarea id="pr-features" className="min-h-20" value={form.features} onChange={(e) => setForm({ ...form, features: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-stacks">Stacks (1 per line)</Label>
                <Textarea id="pr-stacks" className="min-h-20" value={form.stacks} onChange={(e) => setForm({ ...form, stacks: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-stats">Social proof (1 per line)</Label>
                <Textarea id="pr-stats" className="min-h-20" value={form.stats} onChange={(e) => setForm({ ...form, stats: e.target.value })} />
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pr-price">Price (display text)</Label>
                <Input id="pr-price" placeholder="Rp 299rb" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pr-sale">Sale price (empty = none)</Label>
                <Input id="pr-sale" placeholder="Rp 199rb" value={form.price_sale} onChange={(e) => setForm({ ...form, price_sale: e.target.value })} />
              </div>
            </div>
            <Button type="submit" disabled={busy} className="justify-self-start">{busy ? "creating…" : "Create promotion"}</Button>
          </form>
        </CardContent></Card>
      )}

      <div className="divide-y rounded-lg border">
        {(data ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <Badge variant="secondary" className={STATUS_BADGE[p.status]}>{p.status.replace("_", " ")}</Badge>
            <button className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => navigate(`/app/${slug}/promotions/${p.id}`)}>
              <Megaphone className="mr-1 inline size-3.5" />{p.name}
            </button>
            <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">
              {p.content ? `${p.content.length} slides` : "no content"} · {p.price_sale || p.price || "—"}
            </span>
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no promotions yet — create one manually or from an AI brief</p>}
      </div>
    </div>
  )
}
