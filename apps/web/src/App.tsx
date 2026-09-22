import { useEffect, useState } from "react"
import { ThemeProvider } from "@/components/theme-provider.tsx"
import { AppSidebar } from "@/components/app-sidebar.tsx"
import { DashboardView } from "@/views/dashboard.tsx"
import { PillarsView } from "@/views/pillars.tsx"
import { PostsView } from "@/views/posts.tsx"
import { StylesView } from "@/views/styles.tsx"
import { TemplatesView } from "@/views/templates.tsx"
import { TemplateDetailView } from "@/views/template-detail.tsx"
import { PostDetailView } from "@/views/post-detail.tsx"
import { OverridesView } from "@/views/overrides.tsx"
import { PromotionsView } from "@/views/promotions.tsx"
import { PromotionDetailView } from "@/views/promotion-detail.tsx"
import { SettingsView } from "@/views/settings.tsx"
import { LoginView } from "@/views/login.tsx"
import { GroupsView } from "@/views/groups.tsx"
import { UsersView } from "@/views/users.tsx"
import { UsageView } from "@/views/usage.tsx"
import { ResetPasswordView } from "@/views/reset-password.tsx"
import { api } from "@/lib/api"
import { parseRoute, navigate } from "@/lib/router"
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@workspace/ui/components/sidebar"
import { Separator } from "@workspace/ui/components/separator"
import { TooltipProvider } from "@workspace/ui/components/tooltip"
import type { AuthMe, Group } from "@workspace/shared"

export function App() {
  const [route, setRoute] = useState(parseRoute(location.pathname))
  const [me, setMe] = useState<AuthMe | null | false>(null) // null=loading, false=logged out
  const [groups, setGroups] = useState<Group[] | null>(null)

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

  // group list for the sidebar (also refreshes on auth change via me dependency)
  useEffect(() => {
    if (!me) return
    api.groups()
      .then((g) => setGroups(g))
      .catch(() => setGroups([]))
  }, [me])

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

  const logout = async () => {
    await api.logout().catch(() => {})
    setMe(false)
    navigate("/login")
  }

  const view = viewOf(route)

  return (
    <ThemeProvider>
      <TooltipProvider>
        <SidebarProvider>
          <AppSidebar
            route={route}
            me={me}
            groups={(groups ?? []).map((g) => ({ slug: g.slug, name: g.name }))}
            onLogout={logout}
          />
          <SidebarInset className="min-w-0">
          <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 !h-4" />
            <span className="truncate text-sm font-medium text-muted-foreground">{view}</span>
          </header>
          {/* editor pages (template/post detail) get the extra width for side-by-side preview */}
          <main className="min-w-0 flex-1 overflow-x-clip p-4 md:p-6">
            <div className={route.name === "templateDetail" || route.name === "postDetail" ? "mx-auto max-w-6xl" : "mx-auto max-w-4xl"}>
              {route.name === "groups" && <GroupsView />}
              {route.name === "usage" && <UsageView />}
              {route.name === "users" && me.role === "admin" && <UsersView />}
              {route.name === "resetPassword" && me.role === "admin" && <ResetPasswordView id={route.id} />}
              {route.name === "templateDetail" && <TemplateDetailView slug={route.slug} id={route.id} />}
              {route.name === "postDetail" && <PostDetailView slug={route.slug} id={route.id} />}
              {route.name === "promoDetail" && <PromotionDetailView slug={route.slug} id={route.id} />}
              {route.name === "groupView" && (
                <>
                  {route.view === "dashboard" && <DashboardView slug={route.slug} />}
                  {route.view === "pillars" && <PillarsView slug={route.slug} />}
                  {route.view === "posts" && <PostsView slug={route.slug} />}
                  {route.view === "styles" && <StylesView slug={route.slug} />}
                  {route.view === "templates" && <TemplatesView slug={route.slug} />}
                  {route.view === "overrides" && <OverridesView slug={route.slug} />}
              {route.view === "promotions" && <PromotionsView slug={route.slug} />}
                  {route.view === "settings" && <SettingsView slug={route.slug} />}
                </>
              )}
            </div>
          </main>
        </SidebarInset>
        </SidebarProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}

// breadcrumb-ish header label for the current page
function viewOf(route: ReturnType<typeof parseRoute>): string {
  switch (route.name) {
    case "groups": return "Groups"
    case "users": return "Users"
    case "resetPassword": return "Reset password"
    case "templateDetail": return "Template detail"
    case "postDetail": return "Post detail"
    case "groupView": {
      const label: Record<string, string> = {
        dashboard: "Dashboard", pillars: "Pillars & Schedule", posts: "Posts",
        styles: "Style Samples", templates: "Templates", overrides: "Override Content", promotions: "Promotions", settings: "Settings",
      }
      return label[route.view] ?? route.view
    }
    default: return ""
  }
}
