import { useEffect, useRef, useState } from "react"
import { Pencil, Sparkles, Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Badge } from "@workspace/ui/components/badge"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Textarea } from "@workspace/ui/components/textarea"
import { Checkbox } from "@workspace/ui/components/checkbox"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@workspace/ui/components/dialog"
import { api, ApiError } from "@/lib/api"
import { usePillars, useCron, useGroup } from "@/lib/hooks"
import type { Pillar, PillarSuggestion } from "@workspace/shared"

export function PillarsView({ slug }: { slug: string }) {
  const { data: pillars, error, loading, reload } = usePillars(slug)
  const { data: cron } = useCron(slug)
  const [form, setForm] = useState({ name: "", description: "", is_news: false, sort_order: 0 })
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Pillar | null>(null)
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

  const generatePillars = async (brief: string) => {
    const ctrl = new AbortController()
    ctrlRef.current = ctrl
    setSuggesting(false); setSuggestRows(null); setSuggestErr(null); setSuggestBusy(true); setSuggestStarted(Date.now())
    try {
      const r = await api.suggestPillars(slug, brief, ctrl.signal)
      setSuggestRows(r.pillars.map((p) => ({ ...p, pick: true })))
      if (r.pillars.length === 0) setSuggestErr("AI did not find any new pillar beyond the existing ones.")
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
    const nextOrder = (pillars ?? []).reduce((m, p) => Math.max(m, p.sort_order), 0) + 1
    setSuggestBusy(true); setSuggestErr(null)
    const failed: string[] = []
    const done = new Set<Row>()
    for (const [i, r] of picked.entries()) {
      try {
        await api.addPillar(slug, { name: r.name.trim(), description: r.description.trim(), is_news: r.is_news, sort_order: nextOrder + i })
        done.add(r)
      } catch (e) {
        failed.push(`${r.name}: ${e instanceof ApiError ? e.message : "failed"}`)
      }
    }
    setSuggestBusy(false)
    if (failed.length === 0) { setSuggestRows(null); reload(); return }
    setSuggestRows((rs) => rs!.filter((r) => !done.has(r)))
    setSuggestErr(failed.join(" · "))
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      await api.addPillar(slug, form)
      setForm({ name: "", description: "", is_news: false, sort_order: 0 })
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to add pillar")
    } finally {
      setBusy(false)
    }
  }

  const saveCron = async (expr: string, enabled: boolean) => {
    try {
      await api.saveCron(slug, expr, enabled)
      setMsg(null)
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to save cron")
    }
  }

  if (loading && !pillars) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Pillars &amp; schedule</h1>
          <p className="text-sm text-muted-foreground">Regular posts only: the topics the AI rotates through, and when the daily auto-post runs. News topics are configured under News.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setSuggesting(true)}>
          <Sparkles className="size-4" /> Generate pillars
        </Button>
      </div>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      {(suggestBusy || suggestErr || suggestRows) && (
        <PillarSuggestCard
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

      {cron && <CronEditor cron={cron} onSave={saveCron} />}

      <form onSubmit={submit} className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1.5">
          <Label htmlFor="pillar-name">Pillar name</Label>
          <Input id="pillar-name" placeholder="pillar name" required value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-desc">Description</Label>
          <Input id="pillar-desc" placeholder="description" required value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-news">News</Label>
          <div className="flex h-7 items-center">
            <Checkbox id="pillar-news" checked={form.is_news}
              onCheckedChange={(c) => setForm({ ...form, is_news: c === true })} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-order">Order</Label>
          <Input id="pillar-order" type="number" placeholder="order" value={form.sort_order}
            onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </div>
        <Button type="submit" disabled={busy} className="justify-self-start self-end">Add</Button>
      </form>

      <div className="divide-y rounded-lg border">
        {(pillars ?? []).map((p) => (
          <div key={p.id} className="flex items-center gap-3 p-3 text-sm">
            <button onClick={() => api.togglePillar(slug, p.id).then(reload)}>
              <Badge variant="secondary" className={p.active ? "bg-emerald-500/15 text-emerald-500 border-transparent" : ""}>
                {p.active ? "active" : "off"}
              </Badge>
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{p.name} {p.is_news && <span className="text-xs text-muted-foreground">(news)</span>}</p>
              <p className="truncate text-xs text-muted-foreground">{p.description}</p>
            </div>
            <span className="text-xs text-muted-foreground">#{p.sort_order}</span>
            <Button variant="ghost" size="icon" aria-label="edit" onClick={() => setEditing(p)}>
              <Pencil className="size-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="delete" onClick={() => api.delPillar(slug, p.id).then(reload)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {pillars?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no pillars yet</p>}
      </div>

      {editing && (
        <EditPillarDialog
          slug={slug}
          pillar={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload() }}
        />
      )}

      {suggesting && (
        <SuggestPillarsDialog
          slug={slug}
          onClose={() => setSuggesting(false)}
          onGenerate={generatePillars}
        />
      )}
    </div>
  )
}

type Row = PillarSuggestion & { pick: boolean }
const valid = (r: Row) => r.pick && r.name.trim() !== "" && r.description.trim() !== ""

function PillarSuggestCard({ rows, err, busy, elapsed, onCancel, onClear, onAdd, onRow }: {
  rows: Row[] | null; err: string | null; busy: boolean; elapsed: number;
  onCancel: () => void; onClear: () => void; onAdd: () => void; onRow: (i: number, p: Partial<Row>) => void
}) {
  const pickedN = (rows ?? []).filter(valid).length
  return (
    <Card className={err ? "border-destructive/40" : "border-amber-500/40"}>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Generating pillars</p>
            <p className="text-xs text-muted-foreground">
              {busy ? `AI is designing pillars from your brief… ${elapsed}s` : err ? "Generation stopped." : "Review and edit the generated pillars before adding."}
            </p>
          </div>
          {busy ? <Button size="sm" variant="outline" onClick={onCancel}>Cancel</Button> : <Button size="sm" variant="ghost" onClick={onClear}>Dismiss</Button>}
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        {rows && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="flex gap-3 rounded-lg border p-3">
                <Checkbox aria-label={`select ${r.name}`} checked={r.pick} className="mt-2"
                  onCheckedChange={(c) => onRow(i, { pick: c === true })} />
                <div className="min-w-0 flex-1 space-y-2">
                  <Input aria-label="pillar name" value={r.name} onChange={(e) => onRow(i, { name: e.target.value })} />
                  <Textarea aria-label="description" className="min-h-16" value={r.description} onChange={(e) => onRow(i, { description: e.target.value })} />
                  {r.is_news && <p className="text-xs text-amber-500">News pillar — needs RSS (set it up in News), otherwise the pipeline falls back to another pillar.</p>}
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

function SuggestPillarsDialog({ slug, onClose, onGenerate }: {
  slug: string; onClose: () => void; onGenerate: (brief: string) => void
}) {
  const { data: group } = useGroup(slug)
  const [brief, setBrief] = useState<string | null>(null)
  const text = brief ?? group?.brief ?? ""
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Generate pillars</DialogTitle>
          <DialogDescription>Describe this account: target audience, goals, voice, topics to cover, and topics to avoid. The dialog closes immediately; progress and results appear on this page.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="pillar-brief">Brief</Label>
          <Textarea id="pillar-brief" className="min-h-40" value={text}
            placeholder="e.g. an account for Indonesian junior developers with 0-2 years of work experience. Goal: help them survive at work — code review, task estimates, PM communication…"
            onChange={(e) => setBrief(e.target.value)} />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={text.trim().length < 20} onClick={() => onGenerate(text)}><Sparkles className="size-4" /> Generate</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditPillarDialog({ slug, pillar, onClose, onSaved }: {
  slug: string; pillar: Pillar; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: pillar.name, description: pillar.description,
    is_news: pillar.is_news, sort_order: pillar.sort_order,
  })
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    try {
      await api.patchPillar(slug, pillar.id, form)
      onSaved()
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : "failed to save")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit pillar</DialogTitle>
          <DialogDescription>{pillar.active ? "active" : "inactive"} · rotation order follows creation time, not the order field</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Pillar name</Label>
            <Input id="edit-name" required value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-desc">Description</Label>
            <Input id="edit-desc" required value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="edit-news">News pillar (needs RSS)</Label>
            <Checkbox id="edit-news" checked={form.is_news}
              onCheckedChange={(c) => setForm({ ...form, is_news: c === true })} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-order">Order (display only)</Label>
            <Input id="edit-order" type="number" value={form.sort_order}
              onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
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

function CronEditor({ cron, onSave }: { cron: { expr: string; enabled: boolean; running: boolean }; onSave: (expr: string, enabled: boolean) => void }) {
  const [expr, setExpr] = useState(cron.expr)
  const [enabled, setEnabled] = useState(cron.enabled)
  return (
    <Card>
      <CardContent className="flex flex-wrap items-end gap-3 p-4">
        <div className="space-y-1.5">
          <Label htmlFor="cron-expr">Cron (5 fields, e.g. "0 7 * * *")</Label>
          <Input id="cron-expr" className="font-mono" value={expr} onChange={(e) => setExpr(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="cron-enabled">Enabled</Label>
          <div className="flex h-7 items-center">
            <Checkbox id="cron-enabled" checked={enabled} onCheckedChange={(c) => setEnabled(c === true)} />
          </div>
        </div>
        <Button size="sm" onClick={() => onSave(expr, enabled)}>Save schedule</Button>
        <span className="pb-2 text-xs text-muted-foreground">status: {cron.running ? "running" : "stopped"}</span>
      </CardContent>
    </Card>
  )
}
