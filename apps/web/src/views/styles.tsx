import { useState } from "react"
import { Pencil, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
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
import { useStyles } from "@/lib/hooks"
import type { StyleSample } from "@workspace/shared"

export function StylesView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useStyles(slug)
  const [form, setForm] = useState({ title: "", body: "", platform: "all" })
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState<StyleSample | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.addStyle(slug, { ...form, platform: form.platform === "all" ? null : form.platform })
      setForm({ title: "", body: "", platform: "all" })
      setMsg(null)
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to add style")
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Style Samples</h1>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      <Card>
        <CardContent className="grid gap-3 p-4">
          <form onSubmit={submit} id="style-form" className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
              <div className="space-y-1.5">
                <Label htmlFor="style-title">Title</Label>
                <Input id="style-title" placeholder="title" required value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Platform</Label>
                <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="all platforms" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">all platforms</SelectItem>
                    <SelectItem value="instagram">instagram</SelectItem>
                    <SelectItem value="linkedin">linkedin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="style-body">Sample text (body)</Label>
              <Textarea id="style-body" placeholder="sample text (body)" required value={form.body}
                onChange={(e) => setForm({ ...form, body: e.target.value })} />
            </div>
            <Button type="submit" form="style-form" className="justify-self-start">Add</Button>
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
                <Button variant="ghost" size="icon" aria-label="edit" onClick={() => setEditing(s)}>
                  <Pencil className="size-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label="delete" onClick={() => api.delStyle(slug, s.id).then(reload)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
              <p className="text-xs whitespace-pre-wrap break-words text-muted-foreground">{s.body}</p>
            </CardContent>
          </Card>
        ))}
        {data?.length === 0 && <p className="text-sm text-muted-foreground">no style samples yet</p>}
      </div>

      {editing && (
        <EditStyleDialog
          slug={slug}
          style={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}
    </div>
  )
}

function EditStyleDialog({ slug, style, onClose, onSaved }: {
  slug: string; style: StyleSample; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    title: style.title, body: style.body, platform: style.platform ?? "all",
  })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.patchStyle(slug, style.id, {
        title: form.title, body: form.body, platform: form.platform === "all" ? null : form.platform,
      })
      onSaved()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "failed to save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit style sample</DialogTitle>
          <DialogDescription>8 newest samples are injected into writer + critic prompts</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
            <div className="space-y-1.5">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" required value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Platform</Label>
              <Select value={form.platform} onValueChange={(v) => setForm({ ...form, platform: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">all platforms</SelectItem>
                  <SelectItem value="instagram">instagram</SelectItem>
                  <SelectItem value="linkedin">linkedin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-body">Sample text (body)</Label>
            <Textarea id="edit-body" className="min-h-32" required value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </div>
          {err && <p className="text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? "saving…" : "Save"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
