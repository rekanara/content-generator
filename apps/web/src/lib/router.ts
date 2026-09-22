// History-API router mini — parse pathname jadi route object. No react-router.
export type Route =
  | { name: 'login' }
  | { name: 'groups' }                                    // /app
  | { name: 'usage' }                                      // /app/usage
  | { name: 'users' }                                     // /app/users
  | { name: 'resetPassword'; id: string }                 // /app/users/:id/reset-password
  | { name: 'templateDetail'; slug: string; id: string }  // /app/:slug/templates/:id
  | { name: 'postDetail'; slug: string; id: string }      // /app/:slug/posts/:id
  | { name: 'groupView'; slug: string; view: string };    // /app/:slug/:view

const GROUP_VIEWS = ['dashboard', 'pillars', 'posts', 'styles', 'templates', 'overrides', 'settings'];

export function parseRoute(pathname: string): Route {
  if (pathname === '/login' || pathname === '/app/login') return { name: 'login' };
  if (pathname === '/app' || pathname === '/app/' || pathname === '/') return { name: 'groups' };
  const rm = pathname.match(/^\/app\/users\/([0-9a-f-]{36})\/reset-password\/?$/);
  if (rm) return { name: 'resetPassword', id: rm[1] };
  if (pathname === '/app/users' || pathname === '/app/users/') return { name: 'users' };
  if (pathname === '/app/usage' || pathname === '/app/usage/') return { name: 'usage' };
  // detail routes must match before the generic group view (which only takes one segment)
  const tm = pathname.match(/^\/app\/([a-z0-9][a-z0-9-]*)\/templates\/([0-9a-f-]{36})\/?$/);
  if (tm) return { name: 'templateDetail', slug: tm[1]!, id: tm[2]! };
  const pm = pathname.match(/^\/app\/([a-z0-9][a-z0-9-]*)\/posts\/([0-9a-f-]{36})\/?$/);
  if (pm) return { name: 'postDetail', slug: pm[1]!, id: pm[2]! };
  const m = pathname.match(/^\/app\/([a-z0-9][a-z0-9-]*)(?:\/([a-z]+))?\/?$/);
  if (m) {
    const view = m[2] ?? 'dashboard';
    return { name: 'groupView', slug: m[1], view: GROUP_VIEWS.includes(view) ? view : 'dashboard' };
  }
  return { name: 'groups' };
}

export function navigate(path: string) {
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
