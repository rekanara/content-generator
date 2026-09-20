import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { api, ApiError } from "@/lib/api"
import { useTemplates } from "@/lib/hooks"
import { TEMPLATE_TOKENS, type TemplateFormat } from "@workspace/shared"

const FORMATS: TemplateFormat[] = ["ig-carousel", "li-carousel", "reel"]

export function TemplatesView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useTemplates(slug)
  const [form, setForm] = useState({ name: "", format: "ig-carousel" as TemplateFormat, html: "", is_active: false })
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.addTemplate(slug, form)
      setForm({ name: "", format: "ig-carousel", html: "", is_active: false })
      setMsg(null)
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "gagal menambah template")
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">memuat…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Templates</h1>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} id="template-form" className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-name">Nama template</Label>
                <Input id="tpl-name" placeholder="nama template" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Format</Label>
                <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v as TemplateFormat })}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tpl-active">Aktif</Label>
                <div className="flex h-7 items-center">
                  <Checkbox id="tpl-active" checked={form.is_active}
                    onCheckedChange={(c) => setForm({ ...form, is_active: c === true })} />
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">token: {TEMPLATE_TOKENS[form.format].join(" ")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-html">HTML template</Label>
              <Textarea id="tpl-html" className="min-h-32 font-mono text-xs" placeholder="HTML template" required
                value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} />
            </div>
            <Button type="submit" form="template-form" className="justify-self-start">Tambah</Button>
          </form>
        </CardContent>
      </Card>

      <div className="divide-y rounded-lg border">
        {(data ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-3 p-3 text-sm">
            <button onClick={() => api.activateTemplate(slug, t.id).then(reload)}>
              <Badge variant="secondary" className={t.is_active ? "bg-emerald-500/15 text-emerald-500 border-transparent" : ""}>
                {t.is_active ? "aktif" : "off"}
              </Badge>
            </button>
            <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
            <span className="text-xs text-muted-foreground">{t.format}</span>
            <Button variant="ghost" size="icon" aria-label="hapus" onClick={() => api.delTemplate(slug, t.id).then(reload)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">belum ada template</p>}
      </div>
    </div>
  )
}
