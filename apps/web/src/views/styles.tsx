import { useEffect, useRef, useState } from "react"
import { Pencil, Sparkles, Trash2 } from "lucide-react"
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
import { useStyles } from "@/lib/hooks"
import type { StyleSample, StyleSuggestion } from "@workspace/shared"

export function StylesView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useStyles(slug)
  const [form, setForm] = useState({ title: "", body: "", platform: "all" })
  const [msg, setMsg] = useState<string | null>(null)
  const [editing, setEditing] = useState<StyleSample | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [suggestRows, setSuggestRows] = useState<Row[] | null>(null)
  const [suggestErr, setSuggestErr] = useState<string | null>(null)
  const [suggestBusy, setSuggestBusy] = useState(false)
  const [suggestStarted, setSuggestStarted] = useState(0)
  const ctrlRef = useRef<AbortController | null>(null)
  const [, tick] = useState(0)

  useEffect(() => {
    if (!suggestBusy) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [suggestBusy])

  const generateStyles = async () => {
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setSuggesting(false); setSuggestRows(null); setSuggestErr(null); setSuggestBusy(true); setSuggestStarted(Date.now())
    try {
      const r = await api.suggestStyles(slug, ctrl.signal)
      setSuggestRows(r.samples.map((s) => ({ ...s, pick: true })))
      if (r.samples.length === 0) setSuggestErr("AI did not produce any new sample beyond the existing ones.")
    } catch (e) {
      setSuggestErr(e instanceof ApiError ? e.message : "failed to generate")
    } finally {
      setSuggestBusy(false); ctrlRef.current = null
    }
  }

  const cancelSuggest = () => {
    ctrlRef.current?.abort()
    ctrlRef.current = null
    setSuggestBusy(false)
    setSuggestErr("Generation canceled.")
  }

  const addSuggested = async () => {
    const picked = (suggestRows ?? []).filter(valid)
    setSuggestBusy(true); setSuggestErr(null)
    const failed: string[] = []
    const done = new Set<Row>()
    for (const r of picked) {
      try {
        await api.addStyle(slug, { title: r.title.trim(), body: r.body.trim(), platform: r.platform })
        done.add(r)
      } catch (e) {
        failed.push(`${r.title}: ${e instanceof ApiError ? e.message : "failed"}`)
      }
    }
    setSuggestBusy(false)
    if (failed.length === 0) { setSuggestRows(null); reload(); return }
    setSuggestRows((rs) => rs!.filter((r) => !done.has(r)))
    setSuggestErr(failed.join(" · "))
  }

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
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Style samples</h1>
          <p className="text-sm text-muted-foreground">Example posts whose tone and rhythm every AI writer imitates — regular posts, news, and override polish.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setSuggesting(true)}>
          <Sparkles className="size-4" /> Generate from pillars
        </Button>
      </div>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      {(suggestBusy || suggestErr || suggestRows) && (
        <StyleSuggestCard
          rows={suggestRows}
          err={suggestErr}
          busy={suggestBusy}
          elapsed={suggestStarted ? Math.max(0, Math.round((Date.now() - suggestStarted) / 1000)) : 0}
          onCancel={cancelSuggest}
          onClear={() => { setSuggestRows(null); setSuggestErr(null) }}
          onAdd={addSuggested}
          onRow={(i, p) => setSuggestRows((rs) => rs!.map((r, j) => (j === i ? { ...r, ...p } : r)))}
        />
      )}

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

      {suggesting && (
        <SuggestStylesDialog
          onClose={() => setSuggesting(false)}
          onGenerate={generateStyles}
        />
      )}
    </div>
  )
}

type Row = StyleSuggestion & { pick: boolean }
const valid = (r: Row) => r.pick && r.title.trim() !== "" && r.body.trim() !== ""

function StyleSuggestCard({ rows, err, busy, elapsed, onCancel, onClear, onAdd, onRow }: {
  rows: Row[] | null; err: string | null; busy: boolean; elapsed: number;
  onCancel: () => void; onClear: () => void; onAdd: () => void; onRow: (i: number, p: Partial<Row>) => void
}) {
  const pickedN = (rows ?? []).filter(valid).length
  return (
    <Card className={err ? "border-destructive/40" : "border-amber-500/40"}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Generating style samples</p>
            <p className="text-xs text-muted-foreground">
              {busy ? `AI is writing examples from active pillars… ${elapsed}s` : err ? "Generation stopped." : "Review and edit the generated samples before adding."}
            </p>
          </div>
          {busy ? <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button> : <Button size="sm" variant="ghost" onClick={onClear}>Dismiss</Button>}
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-3 rounded-lg border p-3">
                <Checkbox aria-label={`select ${r.title}`} checked={r.pick} className="mt-2"
                  onCheckedChange={(c) => onRow(i, { pick: c === true })} />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_160px]">
                    <Input aria-label="title" value={r.title} onChange={(e) => onRow(i, { title: e.target.value })} />
                    <Select value={r.platform ?? "all"} onValueChange={(v) => onRow(i, { platform: v === "all" ? null : v as "instagram" | "linkedin" })}>
                      <SelectTrigger className="w-full" aria-label="platform"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">all platforms</SelectItem>
                        <SelectItem value="instagram">instagram</SelectItem>
                        <SelectItem value="linkedin">linkedin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Textarea aria-label="body" className="min-h-32" value={r.body} onChange={(e) => onRow(i, { body: e.target.value })} />
                </div>
              </div>
            ))}
            <div className="flex justify-end">
              <Button disabled={busy || pickedN === 0} onClick={onAdd}>{busy ? "adding…" : `Add ${pickedN}`}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SuggestStylesDialog({ onClose, onGenerate }: {
  onClose: () => void; onGenerate: () => void
}) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate style samples</DialogTitle>
          <DialogDescription>AI writes example posts from your active pillars (and the account brief, if set). The dialog closes immediately; progress and results appear on this page.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={onGenerate}><Sparkles className="size-4" /> Generate</Button>
        </div>
      </DialogContent>
    </Dialog>
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
