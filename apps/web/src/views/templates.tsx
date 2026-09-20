import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { api, ApiError } from "@/lib/api"
import { useTemplates } from "@/lib/hooks"
import { TEMPLATE_TOKENS, type TemplateFormat } from "@workspace/shared"

const FORMATS: TemplateFormat[] = ["ig-carousel", "li-carousel", "reel"]

export function TemplatesView() {
  const { data, error, loading, reload } = useTemplates()
  const [form, setForm] = useState({ name: "", format: "ig-carousel" as TemplateFormat, html: "", is_active: false })
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.addTemplate(form)
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

      <form onSubmit={submit} className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_auto]">
          <input className="input" placeholder="nama template" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value as TemplateFormat })}>
            {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> aktif
          </label>
        </div>
        <p className="text-xs text-muted-foreground">token: {TEMPLATE_TOKENS[form.format].join(" ")}</p>
        <textarea className="input min-h-32 font-mono text-xs" placeholder="HTML template" required value={form.html} onChange={(e) => setForm({ ...form, html: e.target.value })} />
        <Button type="submit" className="justify-self-start">Tambah</Button>
      </form>

      <div className="divide-y rounded-lg border">
        {(data ?? []).map((t) => (
          <div key={t.id} className="flex items-center gap-3 p-3 text-sm">
            <button
              onClick={() => api.activateTemplate(t.id).then(reload)}
              className={"rounded-full px-2 py-0.5 text-xs " + (t.is_active ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground")}
            >
              {t.is_active ? "aktif" : "off"}
            </button>
            <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
            <span className="text-xs text-muted-foreground">{t.format}</span>
            <Button variant="ghost" size="icon" aria-label="hapus" onClick={() => api.delTemplate(t.id).then(reload)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">belum ada template</p>}
      </div>
    </div>
  )
}
