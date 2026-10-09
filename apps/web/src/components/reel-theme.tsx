import { useMemo, useState } from "react"
import { Player } from "@remotion/player"
import { ReelsVideo, demoTimeline, type ReelsThemeType, FONT_CATALOG, PRESETS, PRESET_ORDER } from "@workspace/reels"
import { Input } from "@workspace/ui/components/input"
import { Label } from "@workspace/ui/components/label"
import { Switch } from "@workspace/ui/components/switch"
import {
  Select as SelectUI,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select"

const LAYOUTS = ["kinetic", "news", "minimal", "split"] as const
const CAPTION_STYLES = ["word-highlight", "line", "none"] as const
const POSITIONS = ["top", "center", "bottom"] as const

function Select<T extends string>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <select id={id} className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value as T)}>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  )
}

function Color({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex gap-2">
        <input type="color" aria-label={`${label} picker`} className="h-9 w-10 rounded border bg-background" value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"} onChange={(e) => onChange(e.target.value)} />
        <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  )
}

// Theme form — every change produces a full theme object (schema defaults fill the rest).
export function ReelThemeForm({ theme, onChange }: { theme: ReelsThemeType; onChange: (t: ReelsThemeType) => void }) {
  const set = (patch: Partial<ReelsThemeType>) => onChange({ ...theme, ...patch })
  const pal = (k: keyof ReelsThemeType["palette"]) => (v: string) => set({ palette: { ...theme.palette, [k]: v } })
  const [customFont, setCustomFont] = useState(false)
  const catalogFont = FONT_CATALOG.find((f) => f.family === theme.font.family)
  return (
    <div className="grid gap-4">
      <div className="space-y-1.5">
        <Label>Preset</Label>
        <div className="flex flex-wrap gap-2">
          {PRESET_ORDER.map((key) => (
            <button key={key} type="button" className="rounded border px-3 py-1.5 text-xs font-medium hover:bg-muted" onClick={() => onChange({ ...PRESETS[key]!.theme, brand: { ...PRESETS[key]!.theme.brand, handle: theme.brand.handle } })}>
              {PRESETS[key]!.name}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select id="rt-layout" label="Layout" value={theme.layout} options={LAYOUTS} onChange={(layout) => set({ layout })} />
        <div className="space-y-1.5">
          <Label htmlFor="rt-handle">Handle / brand</Label>
          <Input id="rt-handle" placeholder="@youraccount" value={theme.brand.handle} onChange={(e) => set({ brand: { ...theme.brand, handle: e.target.value } })} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Color id="rt-bg" label="Background" value={theme.palette.bg} onChange={pal("bg")} />
        <Color id="rt-bg2" label="Background 2" value={theme.palette.bg2} onChange={pal("bg2")} />
        <Color id="rt-accent" label="Accent" value={theme.palette.accent} onChange={pal("accent")} />
        <Color id="rt-text" label="Text" value={theme.palette.text} onChange={pal("text")} />
        <Color id="rt-muted" label="Muted" value={theme.palette.muted} onChange={pal("muted")} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Select id="rt-cap" label="Captions" value={theme.captions.style} options={CAPTION_STYLES} onChange={(style) => set({ captions: { ...theme.captions, style } })} />
        <Select id="rt-cappos" label="Caption position" value={theme.captions.position} options={POSITIONS} onChange={(position) => set({ captions: { ...theme.captions, position } })} />
        <Select id="rt-case" label="Text case" value={theme.captions.case} options={["preserve", "upper"] as const} onChange={(c) => set({ captions: { ...theme.captions, case: c } })} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="rt-font">Font family</Label>
          {!customFont ? (
            <SelectUI value={catalogFont?.family ?? ""} onValueChange={(v) => {
              if (v === "custom") return setCustomFont(true)
              const f = FONT_CATALOG.find((x) => x.family === v)
              set({ font: { ...theme.font, family: v, weight: f ? Number(f.weight) : theme.font.weight } })
            }}>
              <SelectTrigger><SelectValue placeholder="Pick font" /></SelectTrigger>
              <SelectContent>
                {FONT_CATALOG.map((f) => <SelectItem key={f.family} value={f.family}>{f.name}</SelectItem>)}
                <SelectItem value="custom">Custom font…</SelectItem>
              </SelectContent>
            </SelectUI>
          ) : (
            <div className="flex gap-2">
              <Input id="rt-font" value={theme.font.family} onChange={(e) => set({ font: { ...theme.font, family: e.target.value } })} placeholder="Font family" />
              <button type="button" className="shrink-0 rounded border px-2 text-xs" onClick={() => setCustomFont(false)}>Picker</button>
            </div>
          )}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rt-scale">Headline size ({theme.font.scale.toFixed(2)}×)</Label>
          <input id="rt-scale" type="range" min={0.7} max={1.3} step={0.05} className="w-full" value={theme.font.scale} onChange={(e) => set({ font: { ...theme.font, scale: Number(e.target.value) } })} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rt-trans">Transition ({theme.transition.durationFrames} frames)</Label>
          <input id="rt-trans" type="range" min={0} max={30} step={1} className="w-full" value={theme.transition.durationFrames} onChange={(e) => set({ transition: { durationFrames: Number(e.target.value) } })} />
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Switch id="rt-progress" checked={theme.progressBar} onCheckedChange={(progressBar) => set({ progressBar })} />
        <Label htmlFor="rt-progress">Progress bar</Label>
        <Select id="rt-brandpos" label="Handle position" value={theme.brand.position} options={["top", "bottom"] as const} onChange={(position) => set({ brand: { ...theme.brand, position } })} />
      </div>
    </div>
  )
}

// Live Remotion preview with sample scenes — same composition the server renders.
export function ReelPreview({ theme }: { theme: ReelsThemeType }) {
  const inputProps = useMemo(() => ({ timeline: demoTimeline, theme }), [theme])
  return (
    <div className="space-y-1.5 self-start">
      <p className="text-xs font-medium text-muted-foreground">Live preview · 1080×1920 · sample scenes (word timing approximated)</p>
      <div className="overflow-hidden rounded-lg border bg-black" style={{ width: 300 }}>
        <Player
          component={ReelsVideo}
          inputProps={inputProps}
          durationInFrames={demoTimeline.durationInFrames}
          fps={demoTimeline.fps}
          compositionWidth={demoTimeline.width}
          compositionHeight={demoTimeline.height}
          style={{ width: 300, height: Math.round(300 * 16 / 9) }}
          controls
          loop
          autoPlay
          acknowledgeRemotionLicense
        />
      </div>
    </div>
  )
}
