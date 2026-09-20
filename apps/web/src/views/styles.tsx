import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"
import { api, ApiError } from "@/lib/api"
import { useStyles } from "@/lib/hooks"

export function StylesView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useStyles(slug)
  const [form, setForm] = useState({ title: "", body: "", platform: "all" })
  const [msg, setMsg] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.addStyle(slug, { ...form, platform: form.platform === "all" ? null : form.platform })
      setForm({ title: "", body: "", platform: "all" })
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

      <Card>
        <CardContent className="grid gap-3 p-4">
          <form onSubmit={submit} id="style-form" className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[1fr_180px]">
              <div className="space-y-1.5">
                <Label htmlFor="style-title">Judul</Label>
                <Input id="style-title" placeholder="judul" required value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="semua platform" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">semua platform</SelectItem>
                    <SelectItem value="instagram">instagram</SelectItem>
                    <SelectItem value="linkedin">linkedin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="style-body">Contoh tulisan (body)</Label>
              <Textarea id="style-body" placeholder="contoh tulisan (body)" required value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <Button type="submit" form="style-form" className="justify-self-start">Tambah</Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {(data ?? []).map((s) => (
          <Card key={s.id}>
            <CardContent className="p-4">
              <div className="mb-2 flex items-center gap-2">
                <h3 className="flex-1 text-sm font-medium">{s.title}</h3>
                {s.platform && <Badge variant="secondary">{s.platform}</Badge>}
                <Button variant="ghost" size="icon" aria-label="hapus" onClick={() => api.delStyle(slug, s.id).then(reload)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <p className="text-xs whitespace-pre-wrap text-muted-foreground">{s.body}</p>
            </CardContent>
          </Card>
        ))}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">belum ada style sample</p>}
      </div>
    </div>
  )
}
