import Link from 'next/link';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, Notice } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import { ImportDraftForm } from './ImportDraftForm';

// CN-05 OS Phase A.1 — Paste-draft import page.
//
// Simple paste surface. The operator pastes the structured JSON that
// Claude Code returned from a writing-brief prompt. We parse, convert
// Markdown → TipTap HTML via the server sanitiser, create the article
// via the canonical pathway, and redirect into the editor.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function ImportDraftPage() {
  const { admin, sb } = await requireAdmin('/admin/content/articles/import');
  const sites = await listNetworkSites(sb);

  // Load approved + drafting ideas so the operator can bind the paste
  // to a specific idea (preserving the idea → draft audit trail). The
  // paste's own idea_id field is still honoured if the form choice is
  // blank — this just makes the common case one click.
  const { data: ideaRows } = await sb
    .from('network_content_ideas')
    .select('id, working_title, status, network_sites(slug, name)')
    .in('status', ['approved', 'drafting'])
    .order('priority', { ascending: true })
    .limit(50);
  const ideas = ((ideaRows ?? []) as unknown as Array<{
    id: string; working_title: string; status: string; network_sites: { slug: string; name: string };
  }>).map((r) => ({
    id: r.id,
    label: `${r.network_sites.name} — ${r.working_title} (${r.status})`,
  }));

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname="/admin/content/articles/import">
      <SectionHeader
        eyebrow="Collector Network OS · Content"
        title="Import pasted Claude Code draft"
        description="Paste the structured JSON Claude returned from a writing brief. We parse it, convert the Markdown body to TipTap-compatible HTML, create a review-ready draft via the canonical pathway, and open the editor."
        actions={<Link className="ui-btn ui-btn--secondary ui-btn--sm" href="/admin/content/articles">← Articles</Link>}
      />

      <Panel title="How this fits" eyebrow="Writing-brief → Claude Code → paste → editor">
        <Notice tone="info">
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            <li>Open an approved idea, copy its <strong>Claude Code writing brief</strong>.</li>
            <li>Paste the brief into Claude Code. Claude writes the article offline (no AI API spend on our side).</li>
            <li>Claude returns a JSON block matching the brief&apos;s output schema. Paste that JSON here.</li>
            <li>We create a draft in <strong>review</strong> status (not published, not scheduled) and open the editor so you can inspect, tweak, approve.</li>
          </ol>
        </Notice>
      </Panel>

      <Panel title="Paste JSON" eyebrow="Structured output from Claude Code">
        <ImportDraftForm sites={sites.map((s) => ({ slug: s.slug, name: s.name }))} ideas={ideas} />
      </Panel>
    </AdminShell>
  );
}
