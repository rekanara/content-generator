"use client"

import * as React from "react"
import {
  LayoutDashboardIcon,
  LayersIcon,
  NewspaperIcon,
  PaletteIcon,
  FileStackIcon,
  CalendarCheckIcon,
  SettingsIcon,
  UsersIcon,
  LogOutIcon,
  MoonIcon,
  SunIcon,
  SparklesIcon,
  MegaphoneIcon,
  CoinsIcon,
  ActivityIcon,
  InboxIcon,
  BookOpenIcon,
} from "lucide-react"

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@workspace/ui/components/sidebar"
import { useTheme } from "@/components/theme-provider.tsx"
import { navigate } from "@/lib/router"
import type { Route } from "@/lib/router"
import type { AuthMe } from "@workspace/shared"

// Group-scoped views, grouped by WHAT they feed — one section per content source,
// so a source's config (e.g. Pillars → regular posts) never sits next to an
// unrelated source (News). Order = sidebar order.
type View = { id: string; label: string; icon: React.ReactNode; hint?: string }
const SECTIONS: { label: string; views: View[] }[] = [
  { label: "Overview", views: [
    { id: "dashboard", label: "Dashboard", icon: <LayoutDashboardIcon /> },
    { id: "studio", label: "Studio", icon: <ActivityIcon />, hint: "Live pipeline" },
    { id: "posts", label: "Posts", icon: <InboxIcon />, hint: "Everything generated" },
  ] },
  { label: "Regular posts", views: [
    { id: "pillars", label: "Pillars & schedule", icon: <LayersIcon />, hint: "Topics + cron for auto posts" },
  ] },
  { label: "News", views: [
    { id: "news", label: "News topics", icon: <NewspaperIcon />, hint: "Sources, rules, valid items" },
  ] },
  { label: "Tutorials", views: [
    { id: "tutorials", label: "Tutorials", icon: <BookOpenIcon />, hint: "Docs-grounded how-tos" },
  ] },
  { label: "Manual content", views: [
    { id: "overrides", label: "Overrides", icon: <SparklesIcon />, hint: "Your own content for a date" },
    { id: "promotions", label: "Promotions", icon: <MegaphoneIcon />, hint: "Product promo decks" },
  ] },
  { label: "Configure (all content)", views: [
    { id: "styles", label: "Style samples", icon: <PaletteIcon />, hint: "Voice every AI writer imitates" },
    { id: "templates", label: "Templates", icon: <FileStackIcon />, hint: "Visuals for every content type" },
    { id: "settings", label: "Settings", icon: <SettingsIcon />, hint: "Group, LLM, Telegram, caption" },
  ] },
]

export function AppSidebar({
  route,
  me,
  groups,
  onLogout,
  ...props
}: {
  route: Route
  me: AuthMe
  groups: { slug: string; name: string }[]
  onLogout: () => void
} & React.ComponentProps<typeof Sidebar>) {
  const { theme, setTheme } = useTheme()
  // group context — active inside a group (list views + detail pages)
  const groupSlug = route.name === "groupView" || route.name === "templateDetail" || route.name === "postDetail" || route.name === "newsTopicDetail" || route.name === "newsItemDetail" || route.name === "promoDetail"
    ? route.slug : null
  // active view id for highlight (detail pages highlight their parent tab)
  const activeView = route.name === "groupView"
    ? route.view
    : route.name === "templateDetail" ? "templates"
      : route.name === "postDetail" ? "posts"
        : route.name === "newsTopicDetail" || route.name === "newsItemDetail" ? "news"
          : route.name === "promoDetail" ? "promotions" : null

  const go = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    navigate(path)
  }

  return (
    <Sidebar variant="inset" className="scanline" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/app" onClick={go("/app")}>
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <CalendarCheckIcon className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold tracking-tight">content-gen</span>
                  <span className="readout truncate text-[0.65rem] uppercase text-muted-foreground">
                    {me.role === "admin" ? "admin" : "user"} · {me.username}
                  </span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Groups</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {groups.length === 0 && (
                <SidebarMenuItem><span className="px-2 text-xs text-muted-foreground">no groups</span></SidebarMenuItem>
              )}
              {groups.map((g) => (
                <SidebarMenuItem key={g.slug}>
                  <SidebarMenuButton
                    asChild
                    isActive={groupSlug === g.slug || (route.name === "groups" && groups.length === 1 && groups[0]!.slug === g.slug)}
                    tooltip={g.name}
                  >
                    <a href={`/app/${g.slug}/dashboard`} onClick={go(`/app/${g.slug}/dashboard`)}>
                      <span className="truncate">{g.name}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {groupSlug && (
          <>
            <SidebarSeparator />
            {SECTIONS.map((sec) => (
              <SidebarGroup key={sec.label} className="py-1">
                <SidebarGroupLabel>{sec.label}</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {sec.views.map((v) => (
                      <SidebarMenuItem key={v.id}>
                        <SidebarMenuButton
                          asChild
                          isActive={activeView === v.id}
                          tooltip={v.hint ? `${v.label} — ${v.hint}` : v.label}
                        >
                          <a href={`/app/${groupSlug}/${v.id}`} onClick={go(`/app/${groupSlug}/${v.id}`)} title={v.hint}>
                            {v.icon}
                            <span>{v.label}</span>
                          </a>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            ))}
          </>
        )}

        <SidebarSeparator />
        <SidebarGroup>
          <SidebarGroupLabel>Global</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={route.name === "usage"} tooltip="Usage & Cost">
                  <a href="/app/usage" onClick={go("/app/usage")}>
                    <CoinsIcon />
                    <span>Usage &amp; Cost</span>
                  </a>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {me.role === "admin" && (
          <>
            <SidebarSeparator />
            <SidebarGroup>
              <SidebarGroupLabel>Admin</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild isActive={route.name === "users"} tooltip="Users">
                      <a href="/app/users" onClick={go("/app/users")}>
                        <UsersIcon />
                        <span>Users</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={() => setTheme(theme === "dark" ? "light" : "dark")} tooltip="Toggle theme">
              {theme === "dark" ? <SunIcon /> : <MoonIcon />}
              <span>{theme === "dark" ? "Light mode" : "Dark mode"}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton onClick={onLogout} tooltip="Log out">
              <LogOutIcon />
              <span>Log out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
