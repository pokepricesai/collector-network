import Link from 'next/link';

// Left rail navigation. Five visual groups per the UI polish spec.
// Each top-level link lands on a module's overview — sub-pages live
// inside that module's own page nav (/admin/seo lists Pages,
// Queries, Opportunities etc. with its own tabs).

const GROUPS: Array<{ label: string; items: Array<{ href: string; label: string }> }> = [
  {
    label: 'Overview',
    items: [
      { href: '/admin',              label: 'Dashboard' },
      { href: '/admin/intelligence', label: 'Intelligence' },
      { href: '/admin/brief',        label: 'Daily brief' },
      { href: '/admin/sites',        label: 'Sites' },
    ],
  },
  {
    label: 'Growth',
    items: [
      { href: '/admin/seo',     label: 'SEO' },
      { href: '/admin/content', label: 'Content' },
      { href: '/admin/social',  label: 'Social' },
      { href: '/admin/newsletter', label: 'Newsletter' },
    ],
  },
  {
    label: 'Commercial',
    items: [
      { href: '/admin/revenue',  label: 'Revenue' },
      { href: '/admin/partners', label: 'Partners' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/tasks',      label: 'Tasks' },
      { href: '/admin/alerts',     label: 'Alerts' },
      { href: '/admin/approvals',  label: 'Approvals' },
      { href: '/admin/automation', label: 'Automation' },
      { href: '/admin/jobs',       label: 'Jobs' },
      { href: '/admin/health',     label: 'Health' },
    ],
  },
  {
    label: 'System',
    items: [
      { href: '/admin/integrations', label: 'Integrations' },
      { href: '/admin/settings',     label: 'Settings' },
    ],
  },
];

export function Sidebar({ pathname }: { pathname: string; activeSlug?: string }) {
  const isActive = (href: string) => {
    if (href === '/admin') return pathname === '/admin' || pathname === '/admin/';
    return pathname === href || pathname.startsWith(href + '/');
  };
  return (
    <aside className="admin-sidebar" aria-label="Admin navigation">
      <div className="admin-brand">
        <Link href="/admin" className="admin-brand-link">
          <span className="admin-brand-dot" aria-hidden />
          <span className="admin-brand-text">
            <span>Collector Network</span>
            <span className="admin-brand-sub">Operating System</span>
          </span>
        </Link>
      </div>
      <nav className="admin-nav" aria-label="Modules">
        {GROUPS.map((g) => (
          <div key={g.label} className="admin-nav-group">
            <div className="admin-nav-group-label">{g.label}</div>
            <ul>
              {g.items.map((it) => (
                <li key={it.href}>
                  <Link
                    href={it.href}
                    className={`admin-nav-link${isActive(it.href) ? ' is-active' : ''}`}
                  >
                    {it.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="admin-sidebar-footer">
        <Link href="/" className="admin-nav-link admin-nav-link--muted">
          View public site
        </Link>
      </div>
    </aside>
  );
}
