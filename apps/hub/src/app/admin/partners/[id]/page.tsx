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
import {
  listVendorCategories,
  listVendorOffers,
  listOutreachTemplates,
} from '@/server/partners/cn06a-queries';
import {
  updatePartnerCn06aAction,
  recomputePartnerFitScoreAction,
  updateContactVerificationAction,
} from '@/server/partners/cn06a-actions';
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
  const [p, contacts, interactions, sponsorships, categories] = await Promise.all([
    getPartner(sb, id),
    listPartnerContacts(sb, id),
    listPartnerInteractions(sb, id, 50),
    listSponsorships(sb, { partnerId: id }),
    listVendorCategories(sb),
  ]);
  if (!p) notFound();

  const cn = p as unknown as {
    vendor_category: string | null;
    relevant_tcgs: string[];
    us_state: string | null;
    is_us_business: boolean;
    estimated_size: string | null;
    fit_score: number | null;
    fit_score_breakdown: Record<string, number> | null;
    first_wave: boolean;
    research_confidence: string | null;
    research_sources: string[];
    last_researched_at: string | null;
    recommended_offer_id: string | null;
    recommended_price_minor: number | null;
    recommended_currency: string | null;
  };
  const vendorOffers = cn.vendor_category ? await listVendorOffers(sb, cn.vendor_category) : [];
  const templates = cn.vendor_category ? await listOutreachTemplates(sb, cn.vendor_category) : [];

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

      <Panel
        title="CN-06A sponsorship fit"
        eyebrow={cn.first_wave ? 'FIRST-WAVE' : 'Categorise + score'}
        actions={
          <form action={recomputePartnerFitScoreAction} style={{ display: 'inline' }}>
            <input type="hidden" name="id" value={p.id} />
            <button type="submit" className="status-badge status-info" style={{ cursor: 'pointer', border: 'none', fontSize: 11, padding: '4px 10px' }}>Recompute score</button>
          </form>
        }
      >
        <form action={updatePartnerCn06aAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <input type="hidden" name="id" value={p.id} />
          <label><span style={{ fontSize: 11 }}>Category</span>
            <select name="vendorCategory" defaultValue={cn.vendor_category ?? ''} style={inp}>
              <option value="">—</option>
              {categories.map((c) => <option key={c.code} value={c.code}>{c.display_name}</option>)}
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>US state (if US)</span>
            <input name="usState" defaultValue={cn.us_state ?? ''} placeholder="e.g. CA" maxLength={2} style={inp} />
          </label>
          <label><span style={{ fontSize: 11 }}>Size</span>
            <select name="estimatedSize" defaultValue={cn.estimated_size ?? ''} style={inp}>
              <option value="">—</option>
              <option value="small">small</option>
              <option value="medium">medium</option>
              <option value="large">large</option>
            </select>
          </label>
          <label style={{ gridColumn: '1 / span 3' }}>
            <span style={{ fontSize: 11 }}>Relevant TCGs</span>
            <span style={{ display: 'inline-flex', gap: 10, marginLeft: 10 }}>
              {['pokemon','mtg','ygo','onepiece','lorcana'].map((t) => (
                <label key={t} style={{ display: 'inline-flex', gap: 4, fontSize: 12 }}>
                  <input type="checkbox" name="relevantTcgs" value={t} defaultChecked={cn.relevant_tcgs?.includes(t)} />
                  {t}
                </label>
              ))}
            </span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" name="isUsBusiness" defaultChecked={cn.is_us_business} />
            <span style={{ fontSize: 12 }}>US-based business</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" name="firstWave" defaultChecked={cn.first_wave} />
            <span style={{ fontSize: 12 }}>First-wave prospect</span>
          </label>
          <label><span style={{ fontSize: 11 }}>Research confidence</span>
            <select name="researchConfidence" defaultValue={cn.research_confidence ?? ''} style={inp}>
              <option value="">—</option>
              <option value="high">high</option>
              <option value="medium">medium</option>
              <option value="low">low</option>
            </select>
          </label>
          <label style={{ gridColumn: '1 / span 3' }}>
            <span style={{ fontSize: 11 }}>Research sources (comma or space separated URLs — required proof trail)</span>
            <textarea
              name="researchSources"
              rows={2}
              defaultValue={cn.research_sources?.join('\n') ?? ''}
              style={{ ...inp, resize: 'vertical', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}
            />
          </label>
          <label><span style={{ fontSize: 11 }}>Recommended offer</span>
            <select name="recommendedOfferId" defaultValue={cn.recommended_offer_id ?? ''} style={inp}>
              <option value="">—</option>
              {vendorOffers.map((o) => (
                <option key={o.id} value={o.id}>{o.display_name} · £{(o.price_minor / 100).toLocaleString()}/mo{o.is_live_capability ? '' : ' (needs build)'}</option>
              ))}
            </select>
          </label>
          <label><span style={{ fontSize: 11 }}>Recommended price (override)</span>
            <input name="recommendedPrice" placeholder="e.g. 300" defaultValue={cn.recommended_price_minor != null ? (cn.recommended_price_minor / 100).toString() : ''} style={inp} />
          </label>
          <label><span style={{ fontSize: 11 }}>Currency</span>
            <input name="recommendedCurrency" maxLength={3} defaultValue={cn.recommended_currency ?? 'GBP'} style={inp} />
          </label>
          <div style={{ gridColumn: '1 / span 3' }}>
            <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Save CN-06A fields</button>
          </div>
        </form>
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>Fit score</div>
            <div style={{ fontSize: 28, fontWeight: 600 }}>
              {cn.fit_score == null ? <span className="col-dim">—</span> : <>{cn.fit_score}<span style={{ fontSize: 14, color: 'var(--admin-text-muted)' }}> / 100</span></>}
            </div>
            {cn.fit_score_breakdown && Object.keys(cn.fit_score_breakdown).length > 0 && (
              <ul style={{ margin: '6px 0 0', paddingLeft: 16, fontSize: 11 }}>
                <li>audience {cn.fit_score_breakdown.audience ?? 0} / 30</li>
                <li>commercial {cn.fit_score_breakdown.commercial ?? 0} / 25</li>
                <li>placement {cn.fit_score_breakdown.placement ?? 0} / 20</li>
                <li>contact {cn.fit_score_breakdown.contact ?? 0} / 15</li>
                <li>cross-TCG {cn.fit_score_breakdown.cross_tcg ?? 0} / 10</li>
              </ul>
            )}
            {cn.last_researched_at && <div className="col-dim" style={{ fontSize: 11, marginTop: 6 }}>Researched {formatRelative(cn.last_researched_at)}</div>}
          </div>
          <div>
            <div style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>Research sources</div>
            {cn.research_sources?.length ? (
              <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 11, fontFamily: 'ui-monospace, monospace' }}>
                {cn.research_sources.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer">{u}</a></li>)}
              </ul>
            ) : <div className="col-dim" style={{ fontSize: 12 }}>No sources yet</div>}
          </div>
        </div>
      </Panel>

      {templates.length > 0 && (
        <Panel title="Outreach templates for this category" eyebrow="Draft only — not sent">
          <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
            {templates.map((t) => (
              <li key={t.id} style={{ marginBottom: 10 }}>
                <strong>{t.subject_line}</strong>{' '}
                <code style={{ fontSize: 11, color: 'var(--admin-text-muted)' }}>({t.slug})</code>
                <details style={{ marginTop: 4 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 11 }}>Preview body</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11, background: 'var(--admin-bg-subtle, #f5f5f5)', padding: 10, borderRadius: 4, marginTop: 6 }}>{t.body_markdown}</pre>
                  {t.variables.length > 0 && <div className="col-dim" style={{ fontSize: 10 }}>Variables: {t.variables.join(', ')}</div>}
                </details>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title={`Contacts (${contacts.length})`} eyebrow="People">
        {contacts.length === 0 ? (
          <div className="admin-table-empty">
            No contacts yet. CN-06A guardrail: only add publicly listed emails or named contacts — never inferred from naming conventions.
          </div>
        ) : (
          <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none' }}>
            {contacts.map((c) => {
              const v = c as unknown as {
                email_verification: string | null;
                source_url: string | null;
                contact_url: string | null;
                suppressed: boolean;
                suppressed_reason: string | null;
                priority: number | null;
              };
              return (
                <li key={c.id} style={{ padding: '10px 0', borderTop: '1px solid var(--admin-border, #eee)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {c.is_primary && <StatusBadge state="success" label="primary" />}
                    <strong>{c.full_name}</strong>
                    {c.role_title && <span className="col-dim" style={{ fontSize: 12 }}>· {c.role_title}</span>}
                    {c.email ? <code style={{ fontSize: 11 }}>{c.email}</code> : <span className="col-dim" style={{ fontSize: 11 }}>no email</span>}
                    {v.email_verification && <StatusBadge state={v.email_verification === 'confirmed' ? 'success' : v.email_verification === 'validated' ? 'info' : 'warning'} label={v.email_verification.replace(/_/g, ' ')} />}
                    {v.suppressed && <StatusBadge state="suppressed" label="suppressed" />}
                    {c.linkedin && <a href={c.linkedin} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11 }}>LinkedIn</a>}
                  </div>
                  {c.notes && <div className="col-dim" style={{ fontSize: 12, marginTop: 4 }}>{c.notes}</div>}
                  <details style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer', fontSize: 11, color: 'var(--admin-text-muted)' }}>Edit verification / suppression / sources</summary>
                    <form action={updateContactVerificationAction} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 8, maxWidth: 720 }}>
                      <input type="hidden" name="id" value={c.id} />
                      <label><span style={{ fontSize: 11 }}>Email verification</span>
                        <select name="emailVerification" defaultValue={v.email_verification ?? ''} style={inp}>
                          <option value="">— unknown</option>
                          <option value="public_listed">public_listed (on their site/directory)</option>
                          <option value="validated">validated (SMTP/MX ok)</option>
                          <option value="confirmed">confirmed (delivered previously)</option>
                        </select>
                      </label>
                      <label><span style={{ fontSize: 11 }}>Priority (1 top → 5)</span>
                        <input type="number" min={1} max={5} name="priority" defaultValue={v.priority ?? ''} style={inp} />
                      </label>
                      <label><span style={{ fontSize: 11 }}>Source URL (where this contact was found publicly)</span>
                        <input name="sourceUrl" defaultValue={v.source_url ?? ''} placeholder="https://company.com/about" style={inp} />
                      </label>
                      <label><span style={{ fontSize: 11 }}>Public contact URL (form / /contact page)</span>
                        <input name="contactUrl" defaultValue={v.contact_url ?? ''} placeholder="https://company.com/contact" style={inp} />
                      </label>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" name="suppressed" defaultChecked={v.suppressed} />
                        <span style={{ fontSize: 12 }}>Suppress this contact</span>
                      </label>
                      <label><span style={{ fontSize: 11 }}>Suppression reason</span>
                        <input name="suppressedReason" defaultValue={v.suppressed_reason ?? ''} style={inp} />
                      </label>
                      <div style={{ gridColumn: '1 / span 2' }}>
                        <button type="submit" className="status-badge status-active" style={{ cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' }}>Save contact fields</button>
                      </div>
                    </form>
                  </details>
                </li>
              );
            })}
          </ul>
        )}
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
            <label><span style={{ fontSize: 11 }}>Email verification</span>
              <select name="emailVerification" defaultValue="" style={inp}>
                <option value="">—</option>
                <option value="public_listed">public_listed</option>
                <option value="validated">validated</option>
                <option value="confirmed">confirmed</option>
              </select>
            </label>
            <label><span style={{ fontSize: 11 }}>Source URL (public page where found)</span>
              <input name="sourceUrl" placeholder="https://company.com/about" style={inp} />
            </label>
            <label><span style={{ fontSize: 11 }}>Public contact URL</span>
              <input name="contactUrl" placeholder="https://company.com/contact" style={inp} />
            </label>
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
