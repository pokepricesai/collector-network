import type { ReactNode } from 'react';
import type { AdminIdentity } from '@/server/admin/require-admin';
import type { NetworkSite } from '@/server/admin/sites';
import { SiteSwitcher } from './SiteSwitcher';
import { Sidebar } from './Sidebar';
import { QuickAddTask } from './QuickAddTask';

// Server component. Composes the permanent admin shell:
// collapsible left sidebar + sticky top bar with site switcher +
// identity chip + sign-out form.

export interface AdminShellProps {
  admin: AdminIdentity;
  sites: NetworkSite[];
  activeSlug: string;              // 'network' or site slug
  pathname: string;
  children: ReactNode;
}

export function AdminShell({
  admin, sites, activeSlug, pathname, children,
}: AdminShellProps) {
  return (
    <div className="admin-root">
      <Sidebar activeSlug={activeSlug} pathname={pathname} />
      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-topbar-left">
            <SiteSwitcher sites={sites} activeSlug={activeSlug} pathname={pathname} />
          </div>
          <div className="admin-topbar-right" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <QuickAddTask
              sites={sites.map((s) => ({ slug: s.slug, name: s.name }))}
              defaultSiteSlug={activeSlug !== 'network' ? activeSlug : undefined}
            />
            <div className="admin-identity" title={admin.email}>
              <span className="admin-identity-role">{admin.role}</span>
              <span className="admin-identity-name">
                {admin.displayName || admin.email}
              </span>
            </div>
            <form action="/admin/sign-out" method="post">
              <button type="submit" className="admin-signout-btn" aria-label="Sign out">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="admin-content">
          <div className="admin-content-inner">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
