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
import { Button, Field, Input, Panel, Textarea } from '@/components/admin/admin-ui';
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
  body: string;
  body_format: string;
  body_rich_html: string | null;
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
    try { setMsg(await fn()); }
    catch (e) { setMsg(`Error: ${(e as Error).message}`); }
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
      if (!r.ok) { setSaveState('error'); setSaveError(r.error ?? 'save failed'); return; }
      pristine.current = { title, slug, metaTitle, metaDescription, summary, standfirst, bodyHtml };
      setChangeNote('');
      setSaveState('saved');
      setTimeout(() => setSaveState((s) => (s === 'saved' ? 'clean' : s)), 1800);
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

  const insertImage = (opts: { url: string; alt: string | null; caption: string | null; mediaId: string }) => {
    editorRef.current?.insertFigure({
      mediaId: opts.mediaId,
      src: opts.url,
      alt: opts.alt,
      caption: opts.caption,
    });
  };

  const saveLabel = {
    clean:  'All changes saved',
    dirty:  'Unsaved changes',
    saving: 'Saving…',
    saved:  'Saved',
    error:  `Save failed${saveError ? ` · ${saveError}` : ''}`,
  }[saveState];

  return (
    <div className="editor-grid">
      {/* ─── Main editor column ─── */}
      <div className="editor-main">
        <div className={`editor-savebar editor-savebar--${saveState}`}>
          <div className="editor-savebar-label">
            {saveLabel}
            {saveState === 'dirty' && <span className="col-dim" style={{ marginLeft: 6, fontWeight: 400 }}>Cmd/Ctrl+S to save</span>}
          </div>
          <div className="editor-savebar-right">
            <Input
              value={changeNote}
              onChange={(e) => setChangeNote(e.currentTarget.value)}
              placeholder="Change note (optional)"
              style={{ width: 220, height: 28, fontSize: 12, padding: '4px 10px' }}
            />
            <Button
              variant="primary"
              onClick={() => void save()}
              disabled={saveState === 'saving' || !isDirty}
            >
              {saveState === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            <Button
              variant="secondary"
              title="Open a site-aware preview in a new tab. Previews the last saved version."
              onClick={() => {
                const qs = isDirty ? '?dirty=1' : '';
                window.open(`/admin/content/articles/${props.article.id}/preview${qs}`, '_blank', 'noopener,noreferrer');
              }}
            >
              Preview ↗
            </Button>
          </div>
        </div>

        <input
          className="editor-title-input"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          placeholder="Article title"
          maxLength={300}
          aria-label="Title"
        />

        <Field label="Standfirst">
          <Textarea
            value={standfirst}
            onChange={(e) => setStandfirst(e.currentTarget.value)}
            rows={2}
            maxLength={400}
            placeholder="Short lede above the body"
          />
        </Field>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="ui-field-label">Body</span>
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
          <Button size="sm" variant="secondary" onClick={() => start(async () => wrapMsg(async () => {
            const r = await generateDraftAction(props.article.id);
            return r.ok ? `AI draft generated · ~$${(r.cost ?? 0).toFixed(4)}. Reload to see.` : `Error: ${r.error}`;
          }))}>Generate with AI</Button>
          <Button size="sm" variant="secondary" onClick={() => start(async () => wrapMsg(async () => {
            const r = await runQcAction(props.article.id);
            return `QC: ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'}`;
          }))}>Run QC</Button>
          <Button size="sm" variant="secondary" onClick={() => start(async () => wrapMsg(async () => {
            const r = await runEditorialQcAction(props.article.id);
            if (!r.ok) return `Error: ${r.error}`;
            return `Editorial QC: ${r.issue_count} issues (${r.blockers} blocker, ${r.warnings} warning) · ~$${(r.cost ?? 0).toFixed(4)}`;
          }))}>Editorial AI QC</Button>
        </div>

        <Panel title="Metadata">
          <div className="ui-stack-row">
            <Field label="Slug">
              <Input value={slug} onChange={(e) => setSlug(e.currentTarget.value)} required maxLength={120} />
            </Field>
            <Field label="Meta title">
              <Input value={metaTitle} onChange={(e) => setMetaTitle(e.currentTarget.value)} maxLength={200} />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Meta description" help="Falls back to summary when empty.">
              <Textarea value={metaDescription} onChange={(e) => setMetaDescription(e.currentTarget.value)} rows={2} maxLength={400} />
            </Field>
          </div>
          <div style={{ marginTop: 10 }}>
            <Field label="Summary (card excerpt)">
              <Textarea value={summary} onChange={(e) => setSummary(e.currentTarget.value)} rows={2} maxLength={400} />
            </Field>
          </div>
        </Panel>

        {props.article.body_format === 'markdown' && props.article.body && (
          <details style={{ fontSize: 12, color: 'var(--admin-text-muted)' }}>
            <summary style={{ cursor: 'pointer' }}>Markdown source (read-only, imported on first open)</summary>
            <pre style={{ background: 'var(--admin-surface-strong)', padding: 10, borderRadius: 6, maxHeight: 240, overflow: 'auto', fontFamily: 'var(--admin-font-mono)', fontSize: 11.5 }}>{props.article.body}</pre>
          </details>
        )}
      </div>

      {/* ─── Sidebar column ─── */}
      <aside className="editor-sidebar">
        <Panel title="Status">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(['draft', 'review', 'approved', 'archived'] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={props.article.status === s ? 'primary' : 'secondary'}
                onClick={() => start(async () => wrapMsg(async () => {
                  await setArticleStatusAction(props.article.id, s);
                  return `Status → ${s}`;
                }))}
              >{s}</Button>
            ))}
          </div>
        </Panel>

        <Panel title="Publish">
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Button size="sm" variant="secondary" onClick={() => start(async () => wrapMsg(async () => {
              const r = await publishArticleAction(props.article.id, 'preview');
              if (r.ok) { setPreview(r.url ?? null); if (r.manualPayload) setManualPayload(r.manualPayload); return 'Preview OK'; }
              return `Error: ${r.error}`;
            }))}>Preview publish</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={props.article.status !== 'approved'}
              onClick={() => {
                if (!window.confirm('Publish this article? For DB-driven sites it goes live immediately on /insights/[slug]. For MTG/PokePrices you will receive a payload for manual delivery.')) return;
                start(async () => wrapMsg(async () => {
                  const r = await publishArticleAction(props.article.id, 'publish');
                  if (r.ok) { setPreview(r.url ?? null); if (r.manualPayload) setManualPayload(r.manualPayload); return r.requiresManual ? 'Published (manual delivery required)' : 'Published'; }
                  return `Error: ${r.error}`;
                }));
              }}
            >Publish</Button>
          </div>
          {preview && <div className="col-dim" style={{ fontSize: 12, marginTop: 6 }}>URL: <a href={preview} target="_blank" rel="noopener noreferrer">{preview}</a></div>}
          {manualPayload != null && (
            <div style={{ marginTop: 8 }}>
              <div className="col-dim" style={{ fontSize: 11 }}>Manual delivery payload:</div>
              <pre style={{ background: 'var(--admin-surface-strong)', padding: 8, borderRadius: 6, maxHeight: 220, overflow: 'auto', fontSize: 11, fontFamily: 'var(--admin-font-mono)' }}>{JSON.stringify(manualPayload, null, 2)}</pre>
            </div>
          )}
        </Panel>

        <div id="article-media-picker">
          <MediaPicker
            articleId={props.article.id}
            media={props.media}
            featuredMediaId={props.featuredMediaId}
            onInsertInline={insertImage}
          />
        </div>

        <Panel title={`Deterministic QC${(props.article.qc_report?.deterministic?.issues?.length ?? props.article.qc_report?.issues?.length) ? ` (${props.article.qc_report?.deterministic?.issues?.length ?? props.article.qc_report?.issues?.length})` : ''}`}>
          {(() => {
            const issues = props.article.qc_report?.deterministic?.issues ?? props.article.qc_report?.issues ?? [];
            const ranAt = props.article.qc_report?.deterministic?.ran_at ?? props.article.qc_report?.ran_at ?? null;
            if (issues.length === 0) return <span className="col-dim" style={{ fontSize: 12.5 }}>No issues flagged{ranAt ? ` (ran ${new Date(ranAt).toISOString().slice(0, 16).replace('T', ' ')})` : ''}.</span>;
            return (
              <>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {issues.map((i, idx) => (
                    <li key={idx} style={{ color: i.severity === 'error' ? 'var(--danger)' : i.severity === 'warning' ? 'var(--warning)' : 'var(--admin-text-muted)' }}>
                      <strong>{i.code}</strong> · {i.message}
                    </li>
                  ))}
                </ul>
                {ranAt && <div className="col-dim" style={{ fontSize: 10.5, marginTop: 6 }}>ran {new Date(ranAt).toISOString().slice(0, 16).replace('T', ' ')}</div>}
              </>
            );
          })()}
        </Panel>

        <Panel title={`Editorial AI QC${props.article.qc_report?.editorial?.issues?.length ? ` (${props.article.qc_report.editorial.issues.length})` : ''}`}>
          {!props.article.qc_report?.editorial ? (
            <span className="col-dim" style={{ fontSize: 12.5 }}>Not run yet. Click &ldquo;Editorial AI QC&rdquo; for a semantic review.</span>
          ) : (
            <>
              <div style={{ fontSize: 12.5, marginBottom: 8, color: 'var(--admin-text-muted)' }}><em>{props.article.qc_report.editorial.summary}</em></div>
              {props.article.qc_report.editorial.issues.length === 0 ? (
                <span className="col-dim" style={{ fontSize: 12.5 }}>Zero semantic issues.</span>
              ) : (
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {props.article.qc_report.editorial.issues.map((i, idx) => (
                    <li key={idx} style={{ color: i.severity === 'blocker' ? 'var(--danger)' : i.severity === 'warning' ? 'var(--warning)' : 'var(--admin-text-muted)' }}>
                      <strong>[{i.severity.toUpperCase()}] {i.category}</strong>
                      {i.location && <span className="col-dim"> @ {i.location}</span>}
                      <div>{i.message}</div>
                      {i.suggested_fix && <div className="col-dim">Fix: {i.suggested_fix}</div>}
                    </li>
                  ))}
                </ul>
              )}
              <div className="col-dim" style={{ fontSize: 10.5, marginTop: 8 }}>ran {new Date(props.article.qc_report.editorial.ran_at).toISOString().slice(0, 16).replace('T', ' ')} · {props.article.qc_report.editorial.model} · ${props.article.qc_report.editorial.cost_usd.toFixed(4)}</div>
            </>
          )}
        </Panel>

        <Panel title={`Internal link assistant (${props.links.length})`}>
          {props.links.length === 0 ? <span className="col-dim" style={{ fontSize: 12.5 }}>No link suggestions yet.</span> : (
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
              {props.links.map((l) => (
                <li key={l.id} style={{ padding: 8, border: '1px solid var(--admin-border)', borderRadius: 6, background: 'var(--admin-surface-raised)' }}>
                  <div style={{ fontSize: 12.5 }}><strong>{l.anchor_text ?? '(no anchor)'}</strong> → <a href={l.target_url} target="_blank" rel="noopener noreferrer">{l.target_url}</a></div>
                  <div className="col-dim" style={{ fontSize: 11.5 }}>{l.reason ?? ''}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                    {(['suggested', 'accepted', 'rejected'] as const).map((s) => (
                      <Button
                        key={s}
                        size="sm"
                        variant={l.state === s ? 'primary' : 'secondary'}
                        onClick={() => start(async () => { await toggleArticleLinkAction(l.id, s); setMsg(`Link → ${s}`); })}
                      >{s}</Button>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {msg && <div className="ui-notice" style={{ fontSize: 12 }}>{msg}</div>}
      </aside>
    </div>
  );
}
