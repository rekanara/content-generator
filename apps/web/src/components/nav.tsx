import { Moon, Sun, LogOut } from "lucide-react"
import { Button } from "@workspace/ui/components/button"
import { useTheme } from "@/components/theme-provider.tsx"
import { navigate } from "@/lib/router"
import type { Route } from "@/lib/router"
import type { AuthMe } from "@workspace/shared"

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "pillars", label: "Pillars" },
  { id: "posts", label: "Posts" },
  { id: "styles", label: "Styles" },
  { id: "templates", label: "Templates" },
  { id: "settings", label: "Settings" },
] as const

export function Nav({ route, me, onNavigate, onLogout }: {
  route: Route
  me: AuthMe
  onNavigate: (v: string) => void
  onLogout: () => void
}) {
  const { theme, setTheme } = useTheme()
  // detail pages stay inside a group — keep tabs visible, matching tab highlighted
  const slug = route.name === 'groupView' || route.name === 'templateDetail' || route.name === 'postDetail' ? route.slug : null
  const view = route.name === 'groupView'
    ? route.view
    : route.name === 'templateDetail' ? 'templates'
      : route.name === 'postDetail' ? 'posts' : null

  return (
    <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
      {/* keep header aligned with the content width (template detail renders wider) */}
      <div className={"mx-auto flex items-center gap-1 p-3 " + (route.name === "templateDetail" ? "max-w-6xl" : "max-w-4xl")}>
        <button
          className="mr-2 text-sm font-semibold tracking-tight hover:underline"
          onClick={() => navigate("/app")}
        >
          content-gen
        </button>
        {slug && (
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
        )}
        {!slug && <div className="flex-1" />}
        <span className="text-xs text-muted-foreground">{me.username}{me.role === "admin" ? " · admin" : ""}</span>
        {me.role === "admin" && (
          <Button
            variant="ghost"
            size="sm"
            className={route.name === "users" ? "bg-accent" : ""}
            onClick={() => navigate("/app/users")}
          >
            Users
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="toggle theme"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
        <Button variant="ghost" size="icon" aria-label="logout" onClick={onLogout}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  )
}
