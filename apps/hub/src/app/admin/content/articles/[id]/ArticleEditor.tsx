'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  generateDraftAction,
  publishArticleAction,
  runQcAction,
  setArticleStatusAction,
  toggleArticleLinkAction,
  updateArticleAction,
} from '../actions';
import { runEditorialQcAction } from '@/app/admin/social/actions';
import { RichEditor, type RichEditorHandle } from './RichEditor';
import { MediaPicker, type ArticleMediaItem } from './MediaPicker';

interface Article {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  standfirst: string | null;
  meta_title: string | null;
  meta_description: string | null;
  body: string;                     // legacy markdown source (immutable here)
  body_format: string;              // 'markdown' | 'html'
  body_rich_html: string | null;    // extracted from body_rich.html when present
  status: string;
  qc_report: {
    issues?: Array<{ code: string; severity: string; message: string }>;
    ran_at?: string;
    deterministic?: { issues: Array<{ code: string; severity: string; message: string }>; ran_at: string | null };
    editorial?: {
      issues: Array<{ code: string; severity: 'blocker' | 'warning' | 'suggestion'; category: string; message: string; location?: string; suggested_fix?: string }>;
      summary: string;
      ran_at: string;
      model: string;
      cost_usd: number;
      checked_against: string[];
    };
  } | null;
}

interface LinkRow { id: string; target_url: string; anchor_text: string | null; reason: string | null; state: string }

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error';

export function ArticleEditor(props: {
  article: Article;
  links: LinkRow[];
  media: ArticleMediaItem[];
  featuredMediaId: string | null;
  initialHtml: string;
}) {
  const [, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [manualPayload, setManualPayload] = useState<unknown>(null);

  // Controlled form state so we can detect dirty.
  const [title, setTitle] = useState(props.article.title);
  const [slug, setSlug] = useState(props.article.slug);
  const [metaTitle, setMetaTitle] = useState(props.article.meta_title ?? '');
  const [metaDescription, setMetaDescription] = useState(props.article.meta_description ?? '');
  const [summary, setSummary] = useState(props.article.summary ?? '');
  const [standfirst, setStandfirst] = useState(props.article.standfirst ?? '');
  const [changeNote, setChangeNote] = useState('');
  const [bodyHtml, setBodyHtml] = useState(props.initialHtml);

  const pristine = useRef({
    title: props.article.title,
    slug: props.article.slug,
    metaTitle: props.article.meta_title ?? '',
    metaDescription: props.article.meta_description ?? '',
    summary: props.article.summary ?? '',
    standfirst: props.article.standfirst ?? '',
    bodyHtml: props.initialHtml,
  });

  // Imperative handle on the editor — the media picker inserts at the
  // editor's saved selection via this ref, rather than by rebuilding
  // the HTML string.
  const editorRef = useRef<RichEditorHandle>(null);

  const [saveState, setSaveState] = useState<SaveState>('clean');
  const [saveError, setSaveError] = useState<string | null>(null);

  const isDirty = useMemo(() => {
    const p = pristine.current;
    return (
      title !== p.title ||
      slug !== p.slug ||
      metaTitle !== p.metaTitle ||
      metaDescription !== p.metaDescription ||
      summary !== p.summary ||
      standfirst !== p.standfirst ||
      bodyHtml !== p.bodyHtml
    );
  }, [title, slug, metaTitle, metaDescription, summary, standfirst, bodyHtml]);

  useEffect(() => {
    setSaveState((s) => {
      if (s === 'saving') return s;
      if (isDirty) return 'dirty';
      return s === 'saved' ? 'saved' : 'clean';
    });
  }, [isDirty]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (!isDirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [isDirty]);

  async function wrapMsg(fn: () => Promise<string>) {
    setMsg('Working…');
    try {
      setMsg(await fn());
    } catch (e) {
      setMsg(`Error: ${(e as Error).message}`);
    }
  }

  const save = useCallback(async () => {
    setSaveState('saving');
    setSaveError(null);
    try {
      const fd = new FormData();
      fd.set('id', props.article.id);
      fd.set('title', title);
      fd.set('slug', slug);
      fd.set('metaTitle', metaTitle);
      fd.set('metaDescription', metaDescription);
      fd.set('summary', summary);
      fd.set('standfirst', standfirst);
      fd.set('bodyRich', bodyHtml);
      if (changeNote) fd.set('changeNote', changeNote);
      const r = await updateArticleAction(fd);
      if (!r.ok) {
        setSaveState('error');
        setSaveError(r.error ?? 'save failed');
        return;
      }
      pristine.current = { title, slug, metaTitle, metaDescription, summary, standfirst, bodyHtml };
      setChangeNote('');
      setSaveState('saved');
      setTimeout(() => {
        setSaveState((s) => (s === 'saved' ? 'clean' : s));
      }, 1800);
    } catch (e) {
      setSaveState('error');
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [props.article.id, title, slug, metaTitle, metaDescription, summary, standfirst, bodyHtml, changeNote]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (saveState !== 'saving') void save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save, saveState]);

  // Pure imperative — forward to the editor ref so the figure is
  // inserted at the saved selection via a TipTap transaction instead
  // of appending to the serialised HTML string (which was the root
  // cause of the end-append bug). The editor's onUpdate still fires,
  // which propagates the new HTML back into bodyHtml, keeping the
  // dirty-state detector working.
  const insertImage = (opts: { url: string; alt: string | null; caption: string | null; mediaId: string }) => {
    editorRef.current?.insertFigure({
      mediaId: opts.mediaId,
      src: opts.url,
      alt: opts.alt,
      caption: opts.caption,
    });
  };

  const saveLabel = {
    clean: 'All changes saved',
    dirty: 'Unsaved changes',
    saving: 'Saving…',
    saved: 'Saved',
    error: `Save failed: ${saveError ?? ''}`,
  }[saveState];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20 }}>
      {/* ─── Main editor column ─── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          justifyContent: 'space-between', padding: '6px 8px',
          background: saveStateBg(saveState), borderRadius: 4,
          position: 'sticky', top: 0, zIndex: 2,
        }}>
          <div style={{ fontSize: 12, color: saveStateColor(saveState) }}>
            <strong>{saveLabel}</strong>
            {saveState === 'dirty' && <span className="col-dim" style={{ marginLeft: 6 }}>· Cmd/Ctrl+S to save</span>}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={changeNote}
              onChange={(e) => setChangeNote(e.currentTarget.value)}
              placeholder="Change note (optional)"
              style={{ ...input, fontSize: 11, padding: '4px 8px', width: 220 }}
            />
            <button
              type="button"
              onClick={() => void save()}
              disabled={saveState === 'saving' || !isDirty}
              style={{ ...buttonLg, background: isDirty ? '#1A1A1A' : '#D4D4D4', color: '#fff', cursor: isDirty ? 'pointer' : 'not-allowed' }}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        <Field label="Title">
          <input value={title} onChange={(e) => setTitle(e.currentTarget.value)} style={input} required maxLength={300} />
        </Field>
        <Field label="Slug">
          <input value={slug} onChange={(e) => setSlug(e.currentTarget.value)} style={input} required maxLength={120} />
        </Field>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Field label="Meta title">
            <input value={metaTitle} onChange={(e) => setMetaTitle(e.currentTarget.value)} style={input} maxLength={200} />
          </Field>
          <Field label="Meta description">
            <input value={metaDescription} onChange={(e) => setMetaDescription(e.currentTarget.value)} style={input} maxLength={400} />
          </Field>
        </div>
        <Field label="Standfirst (short lede above the body)">
          <textarea value={standfirst} onChange={(e) => setStandfirst(e.currentTarget.value)} rows={2} style={{ ...input, resize: 'vertical' }} maxLength={400} />
        </Field>
        <Field label="Summary (card excerpt / meta fallback)">
          <textarea value={summary} onChange={(e) => setSummary(e.currentTarget.value)} rows={2} style={{ ...input, resize: 'vertical' }} maxLength={400} />
        </Field>

        {/* Deliberately NOT wrapped in <Field label="Body"> — a <label>
            around a contenteditable div causes some browsers to redirect
            clicks to the first labelable descendant, which can interfere
            with TipTap's own selection/focus handling. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#555' }}>Body</span>
          <RichEditor
            ref={editorRef}
            initialHtml={props.initialHtml}
            onChange={setBodyHtml}
            onRequestInsertImage={() => {
              document.getElementById('article-media-picker')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            }}
            placeholder="Start writing…"
          />
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="status-badge status-opportunity" style={buttonLg}
            onClick={() => start(async () => wrapMsg(async () => {
              const r = await generateDraftAction(props.article.id);
              return r.ok ? `AI draft generated · ~$${(r.cost ?? 0).toFixed(4)}. Reload to see.` : `Error: ${r.error}`;
            }))}>
            Generate / rewrite with AI
          </button>
          <button type="button" className="status-badge status-info" style={buttonLg}
            onClick={() => start(async () => wrapMsg(async () => {
              const r = await runQcAction(props.article.id);
              return `QC: ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}`;
            }))}>
            Run deterministic QC
          </button>
          <button type="button" className="status-badge status-opportunity" style={buttonLg}
            onClick={() => start(async () => wrapMsg(async () => {
              const r = await runEditorialQcAction(props.article.id);
              if (!r.ok) return `Error: ${r.error}`;
              return `Editorial QC: ${r.issue_count} issues (${r.blockers} blocker, ${r.warnings} warning) · ~$${(r.cost ?? 0).toFixed(4)}`;
            }))}>
            Run editorial AI QC
          </button>
        </div>

        {props.article.body_format === 'markdown' && props.article.body && (
          <details style={{ fontSize: 11, color: '#555' }}>
            <summary style={{ cursor: 'pointer' }}>Markdown source (read-only, imported on first open)</summary>
            <pre style={{ background: '#FAFAFA', padding: 10, borderRadius: 4, maxHeight: 240, overflow: 'auto', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>{props.article.body}</pre>
          </details>
        )}
      </div>

      {/* ─── Sidebar column ─── */}
      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div id="article-media-picker">
          <MediaPicker
            articleId={props.article.id}
            media={props.media}
            featuredMediaId={props.featuredMediaId}
            onInsertInline={insertImage}
          />
        </div>

        <PanelLite title="Status">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['draft', 'review', 'approved', 'archived'] as const).map((s) => (
              <button key={s} type="button" className={`status-badge ${props.article.status === s ? 'status-active' : 'status-not_connected'}`}
                style={buttonSm}
                onClick={() => start(async () => wrapMsg(async () => {
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
              onClick={() => start(async () => wrapMsg(async () => {
                const r = await publishArticleAction(props.article.id, 'preview');
                if (r.ok) { setPreview(r.url ?? null); if (r.manualPayload) setManualPayload(r.manualPayload); return 'preview OK'; }
                return `Error: ${r.error}`;
              }))}>Preview publish</button>
            <button type="button" className="status-badge status-approved" style={buttonSm}
              disabled={props.article.status !== 'approved'}
              onClick={() => {
                if (!window.confirm('Publish this article? For DB-driven sites it goes live immediately on /insights/[slug]. For MTG/PokePrices you will receive a payload for manual delivery.')) return;
                start(async () => wrapMsg(async () => {
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

        <PanelLite title={`Deterministic QC${(props.article.qc_report?.deterministic?.issues?.length ?? props.article.qc_report?.issues?.length) ? ` (${props.article.qc_report?.deterministic?.issues?.length ?? props.article.qc_report?.issues?.length})` : ''}`}>
          {(() => {
            const issues = props.article.qc_report?.deterministic?.issues ?? props.article.qc_report?.issues ?? [];
            const ranAt = props.article.qc_report?.deterministic?.ran_at ?? props.article.qc_report?.ran_at ?? null;
            if (issues.length === 0) return <span className="col-dim" style={{ fontSize: 12 }}>No issues flagged{ranAt ? ` (ran ${new Date(ranAt).toISOString().slice(0, 16).replace('T', ' ')})` : ''}. Click &ldquo;Run deterministic QC&rdquo; to re-check.</span>;
            return (
              <>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {issues.map((i, idx) => (
                    <li key={idx} style={{ color: i.severity === 'error' ? '#8A1C27' : i.severity === 'warning' ? '#8A6A1C' : '#555' }}>
                      <strong>{i.code}</strong> — {i.message}
                    </li>
                  ))}
                </ul>
                {ranAt && <div className="col-dim" style={{ fontSize: 10, marginTop: 4 }}>ran {new Date(ranAt).toISOString().slice(0, 16).replace('T', ' ')}</div>}
              </>
            );
          })()}
        </PanelLite>

        <PanelLite title={`Editorial AI QC${props.article.qc_report?.editorial?.issues?.length ? ` (${props.article.qc_report.editorial.issues.length})` : ''}`}>
          {!props.article.qc_report?.editorial ? (
            <span className="col-dim" style={{ fontSize: 12 }}>Not run yet. Click &ldquo;Run editorial AI QC&rdquo; above for a semantic review.</span>
          ) : (
            <>
              <div style={{ fontSize: 12, marginBottom: 6 }}><em>{props.article.qc_report.editorial.summary}</em></div>
              {props.article.qc_report.editorial.issues.length === 0 ? (
                <span className="col-dim" style={{ fontSize: 12 }}>Zero semantic issues.</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                  {props.article.qc_report.editorial.issues.map((i, idx) => (
                    <li key={idx} style={{ color: i.severity === 'blocker' ? '#8A1C27' : i.severity === 'warning' ? '#8A6A1C' : '#555', marginBottom: 4 }}>
                      <strong>[{i.severity.toUpperCase()}] {i.category}</strong>
                      {i.location && <span className="col-dim"> @ {i.location}</span>}
                      <div>{i.message}</div>
                      {i.suggested_fix && <div className="col-dim">Fix: {i.suggested_fix}</div>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="col-dim" style={{ fontSize: 10, marginTop: 6 }}>ran {new Date(props.article.qc_report.editorial.ran_at).toISOString().slice(0, 16).replace('T', ' ')} · {props.article.qc_report.editorial.model} · ${props.article.qc_report.editorial.cost_usd.toFixed(4)}</div>
            </>
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

function saveStateBg(s: SaveState): string {
  if (s === 'dirty') return '#FFF6DD';
  if (s === 'saving') return '#EEF4FF';
  if (s === 'saved') return '#EAF7EE';
  if (s === 'error') return '#FFEAEA';
  return '#F5F5F0';
}
function saveStateColor(s: SaveState): string {
  if (s === 'dirty') return '#7A5A00';
  if (s === 'saving') return '#1A3A7B';
  if (s === 'saved') return '#0A6B2A';
  if (s === 'error') return '#8A1C27';
  return '#555';
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
