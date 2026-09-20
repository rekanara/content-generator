import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { api, ApiError } from "@/lib/api"
import { useStyles } from "@/lib/hooks"

export function StylesView() {
  const { data, error, loading, reload } = useStyles()
  const [form, setForm] = useState({ title: "", body: "", platform: "" })
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.addStyle({ ...form, platform: form.platform || null })
      setForm({ title: "", body: "", platform: "" })
      setMsg(null)
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "gagal menambah style")
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">memuat…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Style Samples</h1>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      <form onSubmit={submit} className="grid gap-3 rounded-lg border p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px]">
          <input className="input" placeholder="judul" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <select className="input" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
            <option value="">semua platform</option>
            <option value="instagram">instagram</option>
            <option value="linkedin">linkedin</option>
          </select>
        </div>
        <textarea className="input min-h-24" placeholder="contoh tulisan (body)" required value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        <Button type="submit" className="justify-self-start">Tambah</Button>
      </form>

      <div className="space-y-3">
        {(data ?? []).map((s) => (
          <div key={s.id} className="rounded-lg border p-4">
            <div className="mb-2 flex items-center gap-2">
              <h3 className="flex-1 text-sm font-medium">{s.title}</h3>
              {s.platform && <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{s.platform}</span>}
              <Button variant="ghost" size="icon" aria-label="hapus" onClick={() => api.delStyle(s.id).then(reload)}>
                <Trash2 className="size-4" />
              </Button>
            </div>
            <p className="text-xs whitespace-pre-wrap text-muted-foreground">{s.body}</p>
          </div>
        ))}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">belum ada style sample</p>}
      </div>
    </div>
  )
}
