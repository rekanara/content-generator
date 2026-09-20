import { Moon, Sun } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { useTheme } from "@/components/theme-provider.tsx"

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pillars", label: "Pillars" },
  { id: "posts", label: "Posts" },
  { id: "styles", label: "Styles" },
  { id: "templates", label: "Templates" },
] as const

export type ViewId = (typeof TABS)[number]["id"]

export function Nav({ view, onNavigate }: { view: ViewId; onNavigate: (v: ViewId) => void }) {
  const { theme, setTheme } = useTheme()
  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-center gap-1 p-3">
        <span className="mr-2 text-sm font-semibold tracking-tight">content-gen</span>
        <nav className="flex flex-1 gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => onNavigate(t.id)}
              className={
                "rounded-md px-3 py-1.5 text-sm whitespace-nowrap transition-colors " +
                (view === t.id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground")
              }
            >
              {t.label}
            </button>
          ))}
        </nav>
        <Button
          variant="ghost"
          size="icon"
          aria-label="toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </div>
    </header>
  )
}
