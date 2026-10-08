import { useEffect, useState } from "react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { ApiError } from "@/lib/api"

// Saved-state editor card for detail pages (news topic, promotion, override row).
export function CaptionOverrideCard({ initial, save, note }: {
  initial: { caption_cta: string | null; caption_footer: string | null }
  save: (v: CaptionOverrideValue) => Promise<unknown>
  note?: string
}) {
  const [v, setV] = useState<CaptionOverrideValue>({ caption_cta: initial.caption_cta ?? "", caption_footer: initial.caption_footer ?? "" })
  const [state, setState] = useState<string | null>(null)
  useEffect(() => {
    setV({ caption_cta: initial.caption_cta ?? "", caption_footer: initial.caption_footer ?? "" })
  }, [initial.caption_cta, initial.caption_footer])
  const dirty = v.caption_cta !== (initial.caption_cta ?? "") || v.caption_footer !== (initial.caption_footer ?? "")
  const submit = async () => {
    setState("saving…")
    try { await save(v); setState("saved") } catch (e) { setState(e instanceof ApiError ? e.message : "save failed") }
  }
  return (
    <Card><CardContent className="space-y-3 p-4">
      <div>
        <p className="text-sm font-medium">Caption CTA & footer</p>
        <p className="text-xs text-muted-foreground">{note ?? "Blank = use the CTA/footer from Settings."}</p>
      </div>
      <CaptionOverrideFields id="cap" value={v} onChange={(x) => { setV(x); setState(null) }} />
      <div className="flex items-center gap-3">
        <Button size="sm" variant="outline" disabled={!dirty || state === "saving…"} onClick={submit}>Save</Button>
        {state && <span className="text-xs text-muted-foreground" aria-live="polite">{state}</span>}
      </div>
    </CardContent></Card>
  )
}

export type CaptionOverrideValue = { caption_cta: string; caption_footer: string }

// Per-item CTA/footer override. Blank = the group's Settings value is used.
export function CaptionOverrideFields({ id, value, onChange }: { id: string; value: CaptionOverrideValue; onChange: (v: CaptionOverrideValue) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-cta`}>Override CTA</Label>
        <Input id={`${id}-cta`} placeholder="blank = use Settings CTA" value={value.caption_cta}
          onChange={(e) => onChange({ ...value, caption_cta: e.target.value })} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-footer`}>Override footer</Label>
        <Input id={`${id}-footer`} placeholder="blank = use Settings footer" value={value.caption_footer}
          onChange={(e) => onChange({ ...value, caption_footer: e.target.value })} />
      </div>
    </div>
  )
}
