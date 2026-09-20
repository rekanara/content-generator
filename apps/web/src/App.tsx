import { useEffect, useState } from "react"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { DashboardView } from "@/views/dashboard.tsx"
import { PillarsView } from "@/views/pillars.tsx"
import { PostsView } from "@/views/posts.tsx"
import { StylesView } from "@/views/styles.tsx"
import { TemplatesView } from "@/views/templates.tsx"
import { SettingsView } from "@/views/settings.tsx"
import { LoginView } from "@/views/login.tsx"
import { GroupsView } from "@/views/groups.tsx"
import { UsersView } from "@/views/users.tsx"
import { ResetPasswordView } from "@/views/reset-password.tsx"
import { Nav } from "@/components/nav.tsx"
import { api } from "@/lib/api"
import { parseRoute, navigate } from "@/lib/router"
import type { AuthMe } from "@workspace/shared"

export function App() {
  const [route, setRoute] = useState(parseRoute(location.pathname)
  )
  const [me, setMe] = useState<AuthMe | null | false>(null) // null=loading, false=logged out

  useEffect(() => {
    const on = () => setRoute(parseRoute(location.pathname))
    window.addEventListener("popstate", on)
    return () => window.removeEventListener("popstate", on)
  }, [])

  useEffect(() => {
    api.me()
      .then((u) => setMe(u))
      .catch(() => setMe(false))
  }, [])

  // 401 from any API call → logged-out state
  useEffect(() => {
    const on = () => setMe(false)
    window.addEventListener("cg-unauthorized", on)
    return () => window.removeEventListener("cg-unauthorized", on)
  }, [])

  // not authed: login view only; authed on /login → /app
  useEffect(() => {
    if (me === null) return
    if (me === false && route.name !== "login") navigate("/login")
    if (me && route.name === "login") navigate("/app")
  }, [me, route.name])

  if (me === null) return null
  if (me === false) {
    return (
      <ThemeProvider>
        <div className="min-h-svh bg-background text-foreground">
          {route.name === "login" ? <LoginView onLogin={(u: AuthMe) => setMe(u)} /> : null}
        </div>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider>
      <div className="min-h-svh bg-background text-foreground">
        <Nav
          route={route}
          me={me}
          onNavigate={(v) => navigate(`/app/${slugOf(route)}/${v}`)}
          onLogout={async () => {
            await api.logout().catch(() => {})
            setMe(false)
            navigate("/login")
          }}
        />
        <main className="mx-auto max-w-4xl p-4 md:p-6">
          {route.name === "groups" && <GroupsView />}
          {route.name === "users" && me.role === "admin" && <UsersView />}
          {route.name === "resetPassword" && me.role === "admin" && <ResetPasswordView id={route.id} />}
          {route.name === "groupView" && (
            <>
              {route.view === "dashboard" && <DashboardView slug={route.slug} />}
              {route.view === "pillars" && <PillarsView slug={route.slug} />}
              {route.view === "posts" && <PostsView slug={route.slug} />}
              {route.view === "styles" && <StylesView slug={route.slug} />}
              {route.view === "templates" && <TemplatesView slug={route.slug} />}
              {route.view === "settings" && <SettingsView slug={route.slug} />}
            </>
          )}
        </main>
      </div>
    </ThemeProvider>
  )
}

function slugOf(route: ReturnType<typeof parseRoute>): string {
  return route.name === "groupView" ? route.slug : "default"
}
