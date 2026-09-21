// History-API router mini — parse pathname jadi route object. No react-router.
export type Route =
  | { name: 'login' }
  | { name: 'groups' }                                    // /app
  | { name: 'users' }                                     // /app/users
  | { name: 'resetPassword'; id: string }                 // /app/users/:id/reset-password
  | { name: 'templateDetail'; slug: string; id: string }  // /app/:slug/templates/:id
  | { name: 'groupView'; slug: string; view: string };    // /app/:slug/:view

const GROUP_VIEWS = ['dashboard', 'pillars', 'posts', 'styles', 'templates', 'settings'];

export function parseRoute(pathname: string): Route {
  if (pathname === '/login' || pathname === '/app/login') return { name: 'login' };
  if (pathname === '/app' || pathname === '/app/' || pathname === '/') return { name: 'groups' };
  const rm = pathname.match(/^\/app\/users\/([0-9a-f-]{36})\/reset-password\/?$/i);
  if (rm) return { name: 'resetPassword', id: rm[1] };
  if (pathname === '/app/users' || pathname === '/app/users/') return { name: 'users' };
  // template detail must match before the generic group view (which only takes one segment)
  const tm = pathname.match(/^\/app\/([a-z0-9][a-z0-9-]*)\/templates\/([0-9a-f-]{36})\/?$/);
  if (tm) return { name: 'templateDetail', slug: tm[1]!, id: tm[2]! };
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
