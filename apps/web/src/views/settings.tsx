import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { Card, CardContent } from "@workspace/ui/components/card"
import { Input } from "@workspace/ui/components/input"
import { Textarea } from "@workspace/ui/components/textarea"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import { api, ApiError } from "@/lib/api"
import { useApi } from "@/lib/hooks"
import { navigate } from "@/lib/router"
import type { Group } from "@workspace/shared"

// Field config: key, label, placeholder, whether secret (write-only + *_set flag).
type Field = { key: string; label: string; ph?: string; secret?: boolean }

const LLM_FIELDS: Field[] = [
  { key: "llm_base_url", label: "Base URL", ph: "https://openrouter.ai/api/v1" },
  { key: "llm_api_key", label: "API Key", ph: "sk-…", secret: true },
  { key: "llm_model", label: "Model", ph: "gpt-4o-mini" },
  { key: "llm_model_critic", label: "Critic Model", ph: "gpt-4o" },
  { key: "image_model", label: "Image Model", ph: "model = auto · blank or 'empty' = upload via Telegram" },
]
const TTS_FIELDS: Field[] = [
  { key: "tts_provider", label: "Provider", ph: "edge | openai" },
  { key: "tts_voice", label: "Voice", ph: "id-ID-ArdiNeural" },
  { key: "tts_base_url", label: "Base URL", ph: "https://api.openai.com/v1" },
  { key: "tts_api_key", label: "API Key", ph: "sk-…", secret: true },
  { key: "tts_model", label: "Model", ph: "tts-1" },
]
const TG_FIELDS: Field[] = [
  { key: "telegram_bot_token", label: "Bot Token", ph: "123456:ABC-…", secret: true },
  { key: "telegram_chat_id", label: "Chat ID", ph: "-1001234567890" },
]

export function SettingsView({ slug }: { slug: string }) {
  const { data: group, error, loading, reload } = useApi<Group>(() => api.group(slug), [slug])
  const [patch, setPatch] = useState<Record<string, string>>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)

  const set = (k: string, v: string) => setPatch((p) => ({ ...p, [k]: v }))

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setMsg(null)
    try {
      // only send filled fields; empty string → null (clears override, falls back to env)
      const body = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === "" ? null : v]))
      if (Object.keys(body).length > 0) await api.patchGroup(slug, body)
      setPatch({})
      reload()
      setMsg("saved")
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to save")
    } finally {
      setBusy(false)
    }
  }

  const del = async () => {
    setBusy(true)
    try {
      await api.delGroup(slug)
      navigate("/app")
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : "failed to delete group")
      setBusy(false)
    }
  }

  if (loading && !group) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!group) return null

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">Settings — {group.name}</h1>
          <p className="text-xs text-muted-foreground">slug: {group.slug} · leave a field empty = fall back to server env</p>
        </div>
      </section>

      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium">Approval gate</p>
            <p className="text-xs text-muted-foreground">
              Generated posts pause before sending — approve/reject via Telegram buttons or the Posts tab. Rotation only advances after approval.
            </p>
          </div>
          <Switch
            checked={group.approval_required}
            onCheckedChange={(v) => {
              api.patchGroup(slug, { approval_required: v }).then(reload).catch((err) => {
                setMsg(err instanceof ApiError ? err.message : "failed to save")
              })
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium">AI planner</p>
            <p className="text-xs text-muted-foreground">
              Daily at 17:00 WIB the AI reviews next week's runs and creates plans sparingly (special content with matching templates — cancelable anytime).
            </p>
          </div>
          <Switch
            checked={group.auto_plan}
            onCheckedChange={(v) => {
              api.patchGroup(slug, { auto_plan: v }).then(reload).catch((err) => {
                setMsg(err instanceof ApiError ? err.message : "failed to save")
              })
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 p-4">
          <Label htmlFor="caption-cta">Caption CTA</Label>
          <Input id="caption-cta" placeholder="e.g. Follow untuk tips developer tiap hari 🚀"
            value={patch["caption_cta"] ?? group.caption_cta ?? ""}
            onChange={(e) => set("caption_cta", e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Replaces the AI-generated CTA line on every caption (consistent brand voice). Empty = use the AI's CTA.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1.5 p-4">
          <Label htmlFor="caption-footer">Caption footer</Label>
          <Textarea id="caption-footer" placeholder="e.g. 💡 Tips developer tiap hari — follow untuk lanjutan"
            value={patch["caption_footer"] ?? group.caption_footer ?? ""}
            onChange={(e) => set("caption_footer", e.target.value)} />
          <p className="text-xs text-muted-foreground">
            Appended after the CTA of every generated caption (title / subtitle / CTA / footer / tags). Empty = not shown.
          </p>
        </CardContent>
      </Card>

      <form className="space-y-6" onSubmit={save}>
        <Section title="LLM">
          {LLM_FIELDS.map((f) => (
            <FieldRow key={f.key} f={f} group={group} value={patch[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          ))}
        </Section>
        <Section title="TTS">
          {TTS_FIELDS.map((f) => (
            <FieldRow key={f.key} f={f} group={group} value={patch[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          ))}
        </Section>
        <Section title="Telegram">
          {TG_FIELDS.map((f) => (
            <FieldRow key={f.key} f={f} group={group} value={patch[f.key] ?? ""} onChange={(v) => set(f.key, v)} />
          ))}
        </Section>

        <div className="flex items-center gap-2">
          <Button type="submit" disabled={busy || Object.keys(patch).length === 0}>
            {busy ? "saving…" : "Save"}
          </Button>
          {Object.keys(patch).length > 0 && (
            <Button type="button" variant="ghost" onClick={() => setPatch({})}>Reset</Button>
          )}
        </div>
      </form>

      <Card className="border-destructive/50">
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium">Delete this account</p>
            <p className="text-xs text-muted-foreground">All pillars, posts, styles, templates will be deleted too.</p>
          </div>
          {confirmDel ? (
            <div className="flex gap-2">
              <Button variant="destructive" size="sm" disabled={busy} onClick={del}>Yes, delete</Button>
              <Button variant="ghost" size="sm" onClick={() => setConfirmDel(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmDel(true)}>
              <Trash2 className="size-4" /> Delete
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 md:grid-cols-2">
        <h2 className="text-sm font-medium text-muted-foreground md:col-span-2">{title}</h2>
        {children}
      </CardContent>
    </Card>
  )
}

function FieldRow({ f, group, value, onChange }: {
  f: Field; group: Group; value: string; onChange: (v: string) => void
}) {
  const flagKey = f.secret ? `${f.key}_set` : null
  const isSet = flagKey ? (group as unknown as Record<string, boolean>)[flagKey] === true : null
  const current = f.secret ? null : (group as unknown as Record<string, string | null>)[f.key]
  return (
    <div className="space-y-1.5">
      <Label htmlFor={f.key}>
        {f.label}
        {f.secret && (
          <span className={"ml-1 text-xs " + (isSet ? "text-emerald-500" : "text-muted-foreground")}>
            {isSet ? "· set" : "· env"}
          </span>
        )}
        {!f.secret && current && <span className="ml-1 text-xs text-muted-foreground">· active: {current}</span>}
      </Label>
      <Input
        id={f.key}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={f.secret ? (isSet ? "set — fill to replace, empty = unchanged" : f.ph) : (f.ph ?? "")}
        type={f.secret ? "password" : "text"}
        autoComplete="off"
      />
    </div>
  )
}
