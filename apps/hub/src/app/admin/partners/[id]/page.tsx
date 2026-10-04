import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';
import { Panel, SectionHeader, StatusBadge, Table } from '@/components/admin/admin-ui';
import { requireAdmin } from '@/server/admin/require-admin';
import { listNetworkSites } from '@/server/admin/sites';
import {
  getPartner,
  listPartnerContacts,
  listPartnerInteractions,
  listSponsorships,
} from '@/server/partners/queries';
import {
  updatePartnerAction,
  createPartnerContactAction,
  logInteractionAction,
} from '@/server/partners/actions';
import { formatDateOnly, formatRelative, formatMoneyMinor } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const STATUSES = [
  'prospect', 'researching', 'ready_to_contact', 'contacted', 'replied',
  'meeting', 'proposal', 'negotiating', 'won', 'lost', 'nurture', 'archived',
];
const KINDS = [
  'grading_company', 'lgs', 'marketplace', 'scanner_tool', 'accessory',
  'storage', 'auction', 'vendor', 'content_creator', 'event',
  'tcgplayer_direct', 'ebay', 'other',
];
const INTERACTION_KINDS = [
  'email_sent', 'email_received', 'call', 'meeting', 'dm', 'note',
  'proposal_sent', 'proposal_received', 'contract_sent', 'contract_signed',
  'invoice_sent', 'payment_received', 'other',
];

interface Params { params: Promise<{ id: string }> }

export default async function PartnerDetailPage({ params }: Params) {
  const { admin, sb } = await requireAdmin('/admin/partners');
  const sites = await listNetworkSites(sb);
  const { id } = await params;
  const [p, contacts, interactions, sponsorships] = await Promise.all([
    getPartner(sb, id),
    listPartnerContacts(sb, id),
    listPartnerInteractions(sb, id, 50),
    listSponsorships(sb, { partnerId: id }),
  ]);
  if (!p) notFound();

  const inp: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit' };

  return (
    <AdminShell admin={admin} sites={sites} activeSlug="network" pathname={`/admin/partners/${id}`}>
      <SectionHeader
        eyebrow={`Partner · ${p.kind.replace(/_/g, ' ')}`}
        title={p.display_name}
        description={
          <span>
            <StatusBadge state={p.status === 'won' ? 'success' : p.status === 'lost' ? 'failed' : 'info'} label={p.status.replace(/_/g, ' ')} />
            {' · P'}{p.priority}{' · '}
            {p.website ? <a href={p.website} target="_blank" rel="noopener noreferrer">{p.website}</a> : <span className="col-dim">no website</span>}
            {p.last_contact_at && <> · last contact {formatRelative(p.last_contact_at)}</>}
          </span>
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <Link className="status-badge status-active" href={`/admin/partners/sponsorships/new?partnerId=${p.id}`}>+ Sponsorship</Link>
            <Link className="status-badge status-not_connected" href="/admin/partners">← All</Link>
          </span>
        }
      />

      <Panel title="Profile" eyebrow="Edit">
        <form action={updatePartnerAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <input type="hidden" name="id" value={p.id} />
          <label><span style={{ fontSize: 11 }}>Name</span><input name="displayName" defaultValue={p.display_name} style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Status</span>
            <select name="status" defaultValue={p.status} style={inp}>
              {STATUSES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Kind</span>
            <select name="kind" defaultValue={p.kind} style={inp}>
              {KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Priority</span><input type="number" min={1} max={5} name="priority" defaultValue={p.priority} style={inp} /></label>
          <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Website</span><input name="website" defaultValue={p.website ?? ''} style={inp} /></label>
          <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Description</span><textarea name="description" rows={2} defaultValue={p.description ?? ''} style={{ ...inp, resize: 'vertical' }} /></label>
          <label><span style={{ fontSize: 11 }}>Next action</span><input name="nextAction" defaultValue={p.next_action ?? ''} style={inp} /></label>
          <label><span style={{ fontSize: 11 }}>Next action due</span><input type="date" name="nextActionDue" defaultValue={p.next_action_due ?? ''} style={inp} /></label>
          <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Tags (comma)</span><input name="tags" defaultValue={p.tags.join(', ')} style={inp} /></label>
          <div style={{ gridColumn: '1 / span 2' }}><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Save</button></div>
        </form>
      </Panel>

      <Panel title={`Contacts (${contacts.length})`} eyebrow="People">
        <Table
          rows={contacts}
          columns={[
            { key: 'name', header: 'Name', render: (c) => <span>{c.is_primary && <StatusBadge state="success" label="primary" />}<strong style={{ marginLeft: c.is_primary ? 8 : 0 }}>{c.full_name}</strong></span> },
            { key: 'role', header: 'Role', render: (c) => c.role_title ?? '—' },
            { key: 'email', header: 'Email', render: (c) => c.email ? <code style={{ fontSize: 11 }}>{c.email}</code> : <span className="col-dim">—</span> },
            { key: 'linkedin', header: 'LinkedIn', render: (c) => c.linkedin ? <a href={c.linkedin} target="_blank" rel="noopener noreferrer">link</a> : <span className="col-dim">—</span> },
            { key: 'notes', header: 'Notes', render: (c) => <span className="col-dim" style={{ fontSize: 12 }}>{c.notes ?? ''}</span> },
          ]}
          empty={<span className="col-dim">No contacts yet.</span>}
        />
        <details style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>Add contact</summary>
          <form action={createPartnerContactAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10, maxWidth: 800 }}>
            <input type="hidden" name="partnerId" value={p.id} />
            <label><span style={{ fontSize: 11 }}>Full name</span><input name="fullName" required style={inp} /></label>
            <label><span style={{ fontSize: 11 }}>Role</span><input name="roleTitle" style={inp} /></label>
            <label><span style={{ fontSize: 11 }}>Email</span><input name="email" type="email" style={inp} /></label>
            <label><span style={{ fontSize: 11 }}>Phone</span><input name="phone" style={inp} /></label>
            <label><span style={{ fontSize: 11 }}>LinkedIn</span><input name="linkedin" style={inp} /></label>
            <label><span style={{ fontSize: 11 }}>Twitter / X</span><input name="twitter" style={inp} /></label>
            <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Notes</span><input name="notes" style={inp} /></label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><input type="checkbox" name="isPrimary" /><span style={{ fontSize: 12 }}>Primary contact</span></label>
            <div style={{ gridColumn: '1 / span 2' }}><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Add contact</button></div>
          </form>
        </details>
      </Panel>

      <Panel title={`Sponsorships (${sponsorships.length})`} eyebrow="Deals">
        <Table
          rows={sponsorships}
          columns={[
            { key: 'title', header: 'Title', render: (s) => <Link href={`/admin/partners/sponsorships/${s.id}`}>{s.title}</Link> },
            { key: 'status', header: 'Status', render: (s) => <StatusBadge state={s.status === 'active' ? 'success' : s.status === 'cancelled' ? 'failed' : 'info'} label={s.status} /> },
            { key: 'value', header: 'Value', className: 'num', render: (s) => formatMoneyMinor(s.total_value_minor, s.currency) },
            { key: 'term', header: 'Term', render: (s) => <span style={{ fontSize: 12 }}>{s.term_months ? `${s.term_months} mo` : '—'}{s.ends_on && <> · ends {formatDateOnly(s.ends_on)}</>}</span> },
          ]}
          empty={<span className="col-dim">No sponsorships yet.</span>}
        />
      </Panel>

      <Panel title={`Interactions (${interactions.length})`} eyebrow="History">
        <details>
          <summary style={{ cursor: 'pointer', fontSize: 12 }}>+ Log interaction</summary>
          <form action={logInteractionAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10, maxWidth: 800 }}>
            <input type="hidden" name="partnerId" value={p.id} />
            <label><span style={{ fontSize: 11 }}>Kind</span>
              <select name="kind" required style={inp}>
                {INTERACTION_KINDS.map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}
              </select>
            </label>
            <label><span style={{ fontSize: 11 }}>Direction</span>
              <select name="direction" defaultValue="outbound" style={inp}>
                <option value="outbound">outbound</option>
                <option value="inbound">inbound</option>
                <option value="internal">internal</option>
              </select>
            </label>
            <label><span style={{ fontSize: 11 }}>Contact</span>
              <select name="contactId" style={inp}>
                <option value="">—</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
              </select>
            </label>
            <label><span style={{ fontSize: 11 }}>Occurred at</span><input type="datetime-local" name="occurredAt" style={inp} /></label>
            <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Summary</span><input name="summary" required style={inp} placeholder="One-line summary (what happened)" /></label>
            <label style={{ gridColumn: '1 / span 2' }}><span style={{ fontSize: 11 }}>Detail</span><textarea name="detail" rows={3} style={{ ...inp, resize: 'vertical' }} /></label>
            <label><span style={{ fontSize: 11 }}>External ref</span><input name="externalRef" style={inp} /></label>
            <div style={{ gridColumn: '1 / span 2' }}><button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Log</button></div>
          </form>
        </details>
        <ul style={{ margin: '12px 0 0', paddingLeft: 20, fontSize: 13 }}>
          {interactions.length === 0 ? <li className="col-dim">No interactions logged yet.</li> : interactions.map((it) => (
            <li key={it.id} style={{ marginBottom: 10 }}>
              <StatusBadge state="info" label={`${it.kind.replace(/_/g, ' ')} · ${it.direction}`} />{' '}
              <strong>{it.summary}</strong>
              {' '}<span className="col-dim" style={{ fontSize: 11 }}>· {formatRelative(it.occurred_at)}</span>
              {it.detail && <div className="col-dim" style={{ fontSize: 12 }}>{it.detail}</div>}
            </li>
          ))}
        </ul>
      </Panel>
    </AdminShell>
  );
}
