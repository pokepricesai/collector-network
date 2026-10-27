'use client';

import { useState, useTransition } from 'react';
import { importPastedDraftAction } from './actions';

interface Props {
  sites: Array<{ slug: string; name: string }>;
  ideas: Array<{ id: string; label: string }>;
}

export function ImportDraftForm({ sites, ideas }: Props) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<{ message: string; path?: string } | null>(null);

  return (
    <form
      style={{ display: 'grid', gap: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await importPastedDraftAction(fd);
          // On success the action redirects, so we only ever observe
          // a return value when the action rejected the paste.
          if (!r.ok) setError({ message: r.error ?? 'import failed', path: r.path });
        });
      }}
    >
      {error && (
        <div style={{
          background: 'rgba(220,38,38,0.08)',
          border: '1px solid rgba(220,38,38,0.3)',
          padding: 10, borderRadius: 6, fontSize: 13,
        }}>
          <strong>Import rejected:</strong> {error.message}
          {error.path && <> <code>({error.path})</code></>}
        </div>
      )}

      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-muted)' }}>
          Idea (preferred — carries site + content type)
        </span>
        <select
          name="idea_id"
          defaultValue=""
          style={{ padding: '6px 8px', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: 13, background: 'var(--admin-bg)', color: 'var(--admin-text)' }}
        >
          <option value="">— no idea (free-form import) —</option>
          {ideas.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </label>

      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-muted)' }}>
          Fallback site (only used if no idea selected)
        </span>
        <select
          name="site_slug"
          defaultValue=""
          style={{ padding: '6px 8px', border: '1px solid var(--admin-border)', borderRadius: 4, fontSize: 13, background: 'var(--admin-bg)', color: 'var(--admin-text)' }}
        >
          <option value="">— pick a site if no idea —</option>
          {sites.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
      </label>

      <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--admin-text-muted)' }}>
          JSON output from Claude Code (prose before/after is OK)
        </span>
        <textarea
          name="paste"
          required
          placeholder='{\n  "idea_id": "…",\n  "title": "…",\n  "slug": "…",\n  "body_markdown": "## …",\n  …\n}'
          style={{
            width: '100%',
            minHeight: 320,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
            fontSize: 12,
            lineHeight: 1.5,
            padding: 10,
            border: '1px solid var(--admin-border)',
            borderRadius: 6,
            background: 'var(--admin-bg)',
            color: 'var(--admin-text)',
            resize: 'vertical',
          }}
        />
      </label>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button
          type="submit"
          disabled={pending}
          className="ui-btn ui-btn--primary ui-btn--sm"
          style={{ opacity: pending ? 0.6 : 1 }}
        >
          {pending ? 'Importing…' : 'Import as review draft'}
        </button>
        <span style={{ fontSize: 11.5, color: 'var(--admin-text-muted)' }}>
          Creates the article in <strong>review</strong> status. Nothing publishes until you approve + schedule.
        </span>
      </div>
    </form>
  );
}
