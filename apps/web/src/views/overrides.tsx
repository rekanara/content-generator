import { useRef, useState } from "react"
import { Ban, Plus, Trash2 } from "lucide-react"
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
import { useOverrides, useTemplates } from "@/lib/hooks"
import type { OverrideType } from "@workspace/shared"

const TYPE_RULES: Record<OverrideType, string> = {
  mix: "exactly 1 image + text",
  image_only: "1-10 images + caption",
  text_only: "no images — text only",
}

const STATUS_BADGE: Record<string, string> = {
  scheduled: "bg-blue-500/15 text-blue-500 border-transparent",
  sent: "bg-emerald-500/15 text-emerald-500 border-transparent",
  cancelled: "bg-zinc-500/15 text-zinc-500 border-transparent",
}

export function OverridesView({ slug }: { slug: string }) {
  const { data, error, loading, reload } = useOverrides(slug)
  const { data: templates } = useTemplates(slug)
  const [form, setForm] = useState({
    name: "", type: "mix" as OverrideType, template_id: "none",
    description: "", for_date: "",
  })
  const [files, setFiles] = useState<File[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      const fd = new FormData()
      fd.set("name", form.name)
      fd.set("type", form.type)
      fd.set("template_id", form.template_id === "none" ? "" : form.template_id)
      fd.set("description", form.description)
      fd.set("for_date", form.for_date)
      const imgs = form.type === "text_only" ? [] : files
      for (const f of imgs) fd.append("images", f, f.name)
      await api.addOverride(slug, fd)
      setForm({ name: "", type: "mix", template_id: "none", description: "", for_date: "" })
      setFiles([])
      if (fileInput.current) fileInput.current.value = ""
      reload()
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to create override")
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>

  const matchingTemplates = (templates ?? []).filter((t) => t.type === form.type)

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">Override Content</h1>
      <p className="text-xs text-muted-foreground">
        Replaces the automatic pipeline for a date — generate is cancelled, this content is sent instead. Rotation unchanged.
      </p>
      {msg && <p className="text-sm text-amber-500">{msg}</p>}

      <Card>
        <CardContent className="p-4">
          <form onSubmit={submit} className="grid gap-3">
            <div className="grid gap-3 md:grid-cols-[1fr_180px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="ov-name">Name</Label>
                <Input id="ov-name" placeholder="override name" required value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as OverrideType, template_id: "none" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mix">mix</SelectItem>
                    <SelectItem value="image_only">image_only</SelectItem>
                    <SelectItem value="text_only">text_only</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ov-date">Date (slot to replace)</Label>
                <Input id="ov-date" type="date" required value={form.for_date}
                  onChange={(e) => setForm({ ...form, for_date: e.target.value })} />
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              rule: {TYPE_RULES[form.type]}
              {matchingTemplates.length > 0 && ` · ${matchingTemplates.length} matching template(s)`}
            </p>

            <div className="grid gap-3 md:grid-cols-[1fr_220px]">
              <div className="space-y-1.5">
                <Label htmlFor="ov-desc">Description</Label>
                <Textarea id="ov-desc" className="min-h-24" placeholder="text content / caption"
                  required={form.type !== "image_only"} value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Template (optional)</Label>
                <Select value={form.template_id} onValueChange={(v) => setForm({ ...form, template_id: v })}>
                  <SelectTrigger className="w-full"><SelectValue placeholder="none" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">none</SelectItem>
                    {matchingTemplates.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {form.type !== "text_only" && (
              <div className="space-y-1.5">
                <Label htmlFor="ov-images">Images {form.type === "mix" ? "(exactly 1)" : "(1-10)"}</Label>
                <Input id="ov-images" type="file" accept="image/jpeg,image/png,image/webp"
                  multiple={form.type === "image_only"} ref={fileInput}
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
                {files.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {files.length} selected{form.type === "mix" && files.length > 1 ? " — mix allows exactly 1!" : ""}
                  </p>
                )}
              </div>
            )}

            <Button type="submit" disabled={busy} className="justify-self-start">
              <Plus className="size-4" /> {busy ? "creating…" : "Create override"}
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="divide-y rounded-lg border">
        {(data ?? []).map((o) => (
          <div key={o.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <Badge variant="secondary" className={STATUS_BADGE[o.status]}>{o.status}</Badge>
            <Badge variant="outline">{o.type}</Badge>
            <span className="w-24 shrink-0 font-mono text-xs text-muted-foreground">{o.for_date}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{o.name}</p>
              {o.description && <p className="truncate text-xs text-muted-foreground">{o.description}</p>}
            </div>
            {o.images.length > 0 && (
              <div className="flex shrink-0 gap-1">
                {o.images.slice(0, 4).map((f) => (
                  <img key={f} src={api.overrideImageUrl(slug, o.id, f)} alt={f}
                    className="size-10 rounded border object-cover" loading="lazy" />
                ))}
                {o.images.length > 4 && <span className="self-center text-xs text-muted-foreground">+{o.images.length - 4}</span>}
              </div>
            )}
            {o.status === "scheduled" && (
              <Button variant="ghost" size="icon" aria-label="cancel" title="Cancel — frees the date for normal generation"
                onClick={() => api.cancelOverride(slug, o.id).then(reload)}>
                <Ban className="size-4" />
              </Button>
            )}
            <Button variant="ghost" size="icon" aria-label="delete" onClick={() => api.delOverride(slug, o.id).then(reload)}>
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {data?.length === 0 && <p className="p-4 text-sm text-muted-foreground">no overrides yet</p>}
      </div>
    </div>
  )
}
