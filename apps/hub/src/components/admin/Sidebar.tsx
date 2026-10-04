import Link from 'next/link';

// Static left-sidebar navigation. Groups match the Phase 0 IA:
// Overview; Sites; (SEO/Health/Content/Social/Revenue) module
// pillar; Tasks/Alerts/Approvals/Automation operations pillar;
// Integrations and Settings at the bottom.

const GROUPS: Array<{ label: string; items: Array<{ href: string; label: string }> }> = [
  {
    label: 'Overview',
    items: [
      { href: '/admin',       label: 'Overview' },
      { href: '/admin/brief', label: 'Daily brief' },
      { href: '/admin/sites', label: 'Sites' },
    ],
  },
  {
    label: 'SEO',
    items: [
      { href: '/admin/seo',                   label: 'SEO overview' },
      { href: '/admin/seo/opportunities',     label: 'Opportunities' },
      { href: '/admin/seo/internal-links',    label: 'Internal links' },
      { href: '/admin/seo/page-opportunities',label: 'Page opportunities' },
      { href: '/admin/seo/sitemaps',          label: 'Sitemaps' },
      { href: '/admin/seo/indexing',          label: 'Indexing' },
      { href: '/admin/seo/changes',           label: 'Changes' },
    ],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/content',           label: 'Overview' },
      { href: '/admin/content/ideas',     label: 'Ideas' },
      { href: '/admin/content/briefs',    label: 'Briefs' },
      { href: '/admin/content/articles',  label: 'Articles' },
      { href: '/admin/content/calendar',  label: 'Calendar' },
    ],
  },
  {
    label: 'Distribution',
    items: [
      { href: '/admin/social',          label: 'Social · Today' },
      { href: '/admin/social/ideas',    label: 'Social · Ideas' },
      { href: '/admin/social/posts',    label: 'Social · Posts' },
      { href: '/admin/social/calendar', label: 'Social · Calendar' },
      { href: '/admin/newsletter',      label: 'Newsletter' },
    ],
  },
  {
    label: 'Portfolio',
    items: [
      { href: '/admin/health',  label: 'Health' },
    ],
  },
  {
    label: 'Revenue',
    items: [
      { href: '/admin/revenue',               label: 'Revenue dashboard' },
      { href: '/admin/revenue/entries',       label: 'Entries ledger' },
      { href: '/admin/revenue/import',        label: 'Import affiliate CSV' },
      { href: '/admin/revenue/costs',         label: 'Costs + contribution' },
      { href: '/admin/revenue/opportunities', label: 'Opportunities' },
    ],
  },
  {
    label: 'Partners',
    items: [
      { href: '/admin/partners',               label: 'Partner CRM' },
      { href: '/admin/partners/offers',        label: 'Offer catalogue' },
      { href: '/admin/partners/sponsorships',  label: 'Sponsorships' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/admin/tasks',      label: 'Tasks' },
      { href: '/admin/alerts',     label: 'Alerts' },
      { href: '/admin/approvals',  label: 'Approvals' },
      { href: '/admin/jobs',       label: 'Jobs' },
      { href: '/admin/automation', label: 'Automation' },
    ],
  },
  {
    label: 'Platform',
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
          ← Public site
        </Link>
      </div>
    </aside>
  );
}
