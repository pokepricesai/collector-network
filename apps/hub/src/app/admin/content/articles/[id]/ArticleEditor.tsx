'use client';

import { useState, useTransition } from 'react';
import { generateDraftAction, publishArticleAction, runQcAction, setArticleStatusAction, toggleArticleLinkAction, updateArticleAction } from '../actions';

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  meta_title: string | null;
  meta_description: string | null;
  body: string;
  status: string;
  qc_report: { issues?: Array<{ code: string; severity: string; message: string }>; ran_at?: string } | null;
}
interface LinkRow { id: string; target_url: string; anchor_text: string | null; reason: string | null; state: string }

export function ArticleEditor(props: { article: Article; links: LinkRow[] }) {
  const [, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [manualPayload, setManualPayload] = useState<unknown>(null);

  async function wrap(fn: () => Promise<string>) { setMsg('Working…'); try { setMsg(await fn()); } catch (e) { setMsg(`Error: ${(e as Error).message}`); } }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
      <form action={async (fd: FormData) => { 'use client'; await (async () => { const r = await updateArticleAction(fd); setMsg(r.ok ? 'saved' : (r.error ?? 'error')); })(); }} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input type="hidden" name="id" value={props.article.id} />
        <Field label="Title"><input name="title" defaultValue={props.article.title} style={input} required /></Field>
        <Field label="Slug"><input name="slug" defaultValue={props.article.slug} style={input} required /></Field>
        <Field label="Meta title"><input name="metaTitle" defaultValue={props.article.meta_title ?? ''} style={input} /></Field>
        <Field label="Meta description"><input name="metaDescription" defaultValue={props.article.meta_description ?? ''} style={input} /></Field>
        <Field label="Summary"><textarea name="summary" rows={2} defaultValue={props.article.summary ?? ''} style={{ ...input, resize: 'vertical' }} /></Field>
        <Field label="Body (markdown)">
          <textarea name="body" rows={28} defaultValue={props.article.body} style={{ ...input, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, resize: 'vertical' }} />
        </Field>
        <Field label="Change note"><input name="changeNote" placeholder="Short description of this edit" style={input} /></Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className="status-badge status-active" style={buttonLg}>Save</button>
          <button type="button" className="status-badge status-opportunity" style={buttonLg}
            onClick={() => start(async () => wrap(async () => {
              const r = await generateDraftAction(props.article.id);
              return r.ok ? `AI draft generated · ~$${(r.cost ?? 0).toFixed(4)}. Reload to see.` : `Error: ${r.error}`;
            }))}>Generate / Rewrite with AI</button>
          <button type="button" className="status-badge status-info" style={buttonLg}
            onClick={() => start(async () => wrap(async () => {
              const r = await runQcAction(props.article.id);
              return `QC: ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}`;
            }))}>Run QC</button>
        </div>
      </form>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <PanelLite title="Status">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['draft', 'review', 'approved', 'archived'] as const).map((s) => (
              <button key={s} type="button" className={`status-badge ${props.article.status === s ? 'status-active' : 'status-not_connected'}`}
                style={buttonSm}
                onClick={() => start(async () => wrap(async () => {
                  await setArticleStatusAction(props.article.id, s);
                  return `status → ${s}`;
                }))}
              >{s}</button>
            ))}
          </div>
        </PanelLite>

        <PanelLite title="Publish">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="status-badge status-info" style={buttonSm}
              onClick={() => start(async () => wrap(async () => {
                const r = await publishArticleAction(props.article.id, 'preview');
                if (r.ok) { setPreview(r.url ?? null); if (r.manualPayload) setManualPayload(r.manualPayload); return 'preview OK'; }
                return `Error: ${r.error}`;
              }))}>Preview publish</button>
            <button type="button" className="status-badge status-approved" style={buttonSm}
              disabled={props.article.status !== 'approved'}
              onClick={() => {
                if (!window.confirm('Publish this article? For DB-driven sites it goes live immediately on /insights/[slug]. For MTG/PokePrices you will receive a payload for manual delivery.')) return;
                start(async () => wrap(async () => {
                  const r = await publishArticleAction(props.article.id, 'publish');
                  if (r.ok) { setPreview(r.url ?? null); if (r.manualPayload) setManualPayload(r.manualPayload); return r.requiresManual ? 'published (manual delivery required)' : 'published'; }
                  return `Error: ${r.error}`;
                }));
              }}
            >Publish</button>
          </div>
          {preview && <div className="col-dim" style={{ fontSize: 11, marginTop: 6 }}>URL: <a href={preview} target="_blank" rel="noopener noreferrer">{preview}</a></div>}
          {manualPayload != null && (
            <div style={{ marginTop: 8 }}>
              <div className="col-dim" style={{ fontSize: 11 }}>Manual delivery payload:</div>
              <pre style={{ background: '#FAFAFA', padding: 8, borderRadius: 4, maxHeight: 220, overflow: 'auto', fontSize: 11 }}>{JSON.stringify(manualPayload, null, 2)}</pre>
            </div>
          )}
        </PanelLite>

        <PanelLite title={`QC${props.article.qc_report?.issues?.length ? ` (${props.article.qc_report.issues.length})` : ''}`}>
          {(!props.article.qc_report?.issues || props.article.qc_report.issues.length === 0) ? (
            <span className="col-dim" style={{ fontSize: 12 }}>No issues flagged. Click "Run QC" to re-check.</span>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
              {props.article.qc_report.issues.map((i, idx) => (
                <li key={idx} style={{ color: i.severity === 'error' ? '#8A1C27' : i.severity === 'warning' ? '#8A6A1C' : '#555' }}>
                  <strong>{i.code}</strong> — {i.message}
                </li>
              ))}
            </ul>
          )}
        </PanelLite>

        <PanelLite title={`Internal link assistant (${props.links.length})`}>
          {props.links.length === 0 ? <span className="col-dim" style={{ fontSize: 12 }}>No link suggestions yet.</span> : (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {props.links.map((l) => (
                <li key={l.id} style={{ padding: 6, border: '1px solid #EEE', borderRadius: 4 }}>
                  <div style={{ fontSize: 12 }}><strong>{l.anchor_text ?? '(no anchor)'}</strong> → <a href={l.target_url} target="_blank" rel="noopener noreferrer">{l.target_url}</a></div>
                  <div className="col-dim" style={{ fontSize: 11 }}>{l.reason ?? ''}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {(['suggested', 'accepted', 'rejected'] as const).map((s) => (
                      <button key={s} type="button" className={`status-badge ${l.state === s ? 'status-active' : 'status-not_connected'}`} style={buttonSm}
                        onClick={() => start(async () => { await toggleArticleLinkAction(l.id, s); setMsg(`link → ${s}`); })}>{s}</button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </PanelLite>

        {msg && <div style={{ padding: 8, background: '#F5F5F0', borderRadius: 4, fontSize: 11, color: '#555' }}>{msg}</div>}
      </aside>
    </div>
  );
}

const input: React.CSSProperties = { padding: '6px 8px', border: '1px solid #D4D4D4', borderRadius: 4, fontSize: 13, fontFamily: 'inherit', width: '100%' };
const buttonSm: React.CSSProperties = { cursor: 'pointer', border: 'none', fontSize: 10, padding: '3px 8px' };
const buttonLg: React.CSSProperties = { cursor: 'pointer', border: 'none', fontSize: 12, padding: '6px 12px' };

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#555' }}>{label}</span>
      {children}
    </label>
  );
}

function PanelLite({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ border: '1px solid #E6E6E6', borderRadius: 6, padding: 10 }}>
      <h3 style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#333', margin: '0 0 6px' }}>{title}</h3>
      {children}
    </section>
  );
}
