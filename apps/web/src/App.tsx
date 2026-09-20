import { useState } from "react"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { DashboardView } from "@/views/dashboard.tsx"
import { PillarsView } from "@/views/pillars.tsx"
import { PostsView } from "@/views/posts.tsx"
import { StylesView } from "@/views/styles.tsx"
import { TemplatesView } from "@/views/templates.tsx"
import { Nav } from "@/components/nav.tsx"

type View = "dashboard" | "pillars" | "posts" | "styles" | "templates"

export function App() {
  const [view, setView] = useState<View>("dashboard")
  return (
    <ThemeProvider>
      <div className="min-h-svh bg-background text-foreground">
        <Nav view={view} onNavigate={setView} />
        <main className="mx-auto max-w-4xl p-4 md:p-6">
          {view === "dashboard" && <DashboardView />}
          {view === "pillars" && <PillarsView />}
          {view === "posts" && <PostsView />}
          {view === "styles" && <StylesView />}
          {view === "templates" && <TemplatesView />}
        </main>
      </div>
    </ThemeProvider>
  )
}
