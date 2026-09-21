import { useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@workspace/ui/components/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { api, ApiError } from "@/lib/api"
import { useTemplates, useTemplate } from "@/lib/hooks"
import { TEMPLATE_TOKENS, type TemplateFormat } from "@workspace/shared"

const FORMATS: TemplateFormat[] = ["ig-carousel", "li-carousel", "reel"]

export function TemplatesView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useTemplates(slug)
  const [form, setForm] = useState({ name: "", format: "ig-carousel" as TemplateFormat, html: "", is_active: false })
  const [msg, setMsg] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.addTemplate(slug, form)
      setForm({ name: "", format: "ig-carousel", html: "", is_active: false })
      setMsg(null)
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to add template")
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
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
                <Label htmlFor="tpl-name">Template name</Label>
                <Input id="tpl-name" placeholder="template name" required value={form.name}
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
                <Label htmlFor="tpl-active">Active</Label>
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
            <Button type="submit" form="template-form" className="justify-self-start">Add</Button>
          </form>
        </CardContent>
      </Card>

      <div className="divide-y rounded-lg border">
        {(data ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-3 p-3 text-sm">
            <button onClick={() => api.activateTemplate(slug, t.id).then(reload)}>
              <Badge variant="secondary" className={t.is_active ? "bg-emerald-500/15 text-emerald-500 border-transparent" : ""}>
                {t.is_active ? "active" : "off"}
              </Badge>
            </button>
            <button className="min-w-0 flex-1 truncate text-left font-medium hover:underline" onClick={() => setSelected(t.id)}>
              {t.name}
            </button>
            <span className="text-xs text-muted-foreground">{t.format}</span>
            <Button variant="ghost" size="icon" aria-label="delete" onClick={() => api.delTemplate(slug, t.id).then(reload)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no templates yet</p>}
      </div>

      {selected && (
        <TemplateDetailModal
          key={selected}
          slug={slug}
          id={selected}
          onClose={() => setSelected(null)}
          onSaved={() => { setSelected(null); reload() }}
        />
      )}
    </div>
  )
}

function TemplateDetailModal({ slug, id, onClose, onSaved }: {
  slug: string; id: string; onClose: () => void; onSaved: () => void
}) {
  const { data, error, loading } = useTemplate(slug, id)
  const [form, setForm] = useState({ name: "", html: "" })
  const [touched, setTouched] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // prefill once when detail loads; user edits after that win
  useEffect(() => {
    if (data && !touched) setForm({ name: data.name, html: data.html })
  }, [data, touched])

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!data) return
    setBusy(true); setErr(null)
    try {
      await api.patchTemplate(slug, id, { name: form.name, html: form.html })
      onSaved()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "failed to save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-2xl overflow-y-auto">
        {loading && <p className="text-sm text-muted-foreground">loading…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {data && (
          <form onSubmit={save} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>Edit template</DialogTitle>
              <DialogDescription>
                {data.format} · {data.is_active ? "active" : "inactive"} · format is immutable
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-edit-name">Template name</Label>
              <Input id="tpl-edit-name" required value={form.name}
                onChange={(e) => { setForm((f) => ({ ...f, name: e.target.value })); setTouched(true) }} />
            </div>
            <p className="text-xs text-muted-foreground">token: {TEMPLATE_TOKENS[data.format].join(" ")}</p>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-edit-html">HTML template</Label>
              <Textarea id="tpl-edit-html" className="min-h-64 font-mono text-xs" required value={form.html}
                onChange={(e) => { setForm((f) => ({ ...f, html: e.target.value })); setTouched(true) }} />
            </div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "saving…" : "Save"}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
