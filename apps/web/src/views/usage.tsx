import { useState } from "react"
import { CoinsIcon } from "lucide-react"
import { Card, CardContent } from "@workspace/ui/components/card"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@workspace/ui/components/select"
import { api } from "@/lib/api"
import { useApi } from "@/lib/hooks"

const fmtUsd = (n: number) => `$${n < 0.01 && n > 0 ? n.toFixed(4) : n.toFixed(2)}`
const fmtTok = (n: number) => n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n)

export function UsageView() {
  const [days, setDays] = useState(30)
  const { data, error, loading } = useApi(() => api.usage(days), [days])

  if (loading && !data) return <p className="text-muted-foreground text-sm">loading…</p>
  if (error) return <p className="text-destructive text-sm">{error}</p>
  if (!data) return null

  return (
    <div className="space-y-6">
      <section className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Usage &amp; Cost</h1>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            {[7, 30, 90, 365].map((d) => (
              <SelectItem key={d} value={String(d)}>last {d} days</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </section>

      <section className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Total cost</p>
            <p className="truncate text-sm font-medium font-mono">{fmtUsd(data.total.cost)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Prompt tokens</p>
            <p className="truncate text-sm font-medium font-mono">{fmtTok(data.total.promptTokens)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs text-muted-foreground">Completion tokens</p>
            <p className="truncate text-sm font-medium font-mono">{fmtTok(data.total.completionTokens)}</p>
          </CardContent>
        </Card>
      </section>

      {data.groups.map((g) => (
        <Card key={g.group.id}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-center gap-2">
              <h2 className="flex-1 text-sm font-semibold">{g.group.name}</h2>
              <span className="text-xs text-muted-foreground">
                {g.posts} posts · {g.plannerRuns} planner runs
              </span>
              <span className="font-mono text-sm font-semibold text-emerald-600">{fmtUsd(g.cost)}</span>
            </div>

            {g.byModel.length === 0 && (
              <p className="text-xs text-muted-foreground">no LLM usage in this period</p>
            )}
            {g.byModel.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="py-1.5 pr-2 text-left font-medium">Model</th>
                      <th className="px-2 text-right font-medium">Prompt</th>
                      <th className="px-2 text-right font-medium">Completion</th>
                      <th className="px-2 text-right font-medium">Runs</th>
                      <th className="pl-2 text-right font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.byModel.map((m) => (
                      <tr key={m.model} className="border-b last:border-0">
                        <td className="py-1.5 pr-2 font-mono break-all">{m.model}</td>
                        <td className="px-2 text-right font-mono">{fmtTok(m.prompt)}</td>
                        <td className="px-2 text-right font-mono">{fmtTok(m.completion)}</td>
                        <td className="px-2 text-right font-mono">{m.runs}</td>
                        <td className="pl-2 text-right font-mono">{fmtUsd(m.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      {data.groups.length === 0 && (
        <p className="text-sm text-muted-foreground">no visible groups</p>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CoinsIcon className="size-3" />
        Costs are catalog estimates (llm-costs.ts) snapshotted at run time — actual billing follows your gateway.
      </p>
    </div>
  )
}
