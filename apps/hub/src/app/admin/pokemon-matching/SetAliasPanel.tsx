'use client';

import { useState, useTransition } from 'react';
import { addSetAlias, searchTcgSetsAction, previewAliasImpact, listAliases, deleteAlias } from './actions';

interface Props {
  initialAliases: Array<{ id: string; pp_set_name: string; pp_language: string; tcg_set_code: string; tcg_language: string; notes: string | null; created_at: string }>;
}

type TcgSetResult = { code: string; name: string; language: string; releasedAt: string | null; cards: number | null };

export default function SetAliasPanel({ initialAliases }: Props) {
  const [isPending, startTransition] = useTransition();
  const [aliases, setAliases] = useState(initialAliases);
  const [ppSetName, setPpSetName] = useState('');
  const [ppLang, setPpLang] = useState<'en' | 'jp'>('en');
  const [tcgSearch, setTcgSearch] = useState('');
  const [tcgResults, setTcgResults] = useState<TcgSetResult[]>([]);
  const [selectedTcg, setSelectedTcg] = useState<TcgSetResult | null>(null);
  const [impact, setImpact] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const refresh = async () => {
    const list = await listAliases();
    if (list.ok) setAliases(list.aliases || []);
  };

  const onSearchTcg = () => startTransition(async () => {
    const res = await searchTcgSetsAction(tcgSearch);
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'error' }); return; }
    setTcgResults(res.results || []);
  });

  const onPreviewImpact = () => startTransition(async () => {
    if (!ppSetName.trim()) return;
    const res = await previewAliasImpact({ pp_set_name: ppSetName.trim(), pp_language: ppLang });
    if (!res.ok) { setMsg({ ok: false, text: res.error ?? 'error' }); return; }
    setImpact(res.message ?? null);
  });

  const onAdd = () => startTransition(async () => {
    if (!ppSetName.trim() || !selectedTcg) return;
    const res = await addSetAlias({
      pp_set_name: ppSetName.trim(),
      pp_language: ppLang,
      tcg_set_code: selectedTcg.code,
      tcg_language: (selectedTcg.language === 'ja' ? 'ja' : 'en'),
      notes: notes.trim() || null,
    });
    setMsg({ ok: !!res.ok, text: res.ok ? (res.message ?? 'added') : (res.error ?? 'error') });
    if (res.ok) {
      setPpSetName(''); setTcgSearch(''); setSelectedTcg(null); setTcgResults([]); setImpact(null); setNotes('');
      await refresh();
    }
  });

  const onDelete = (id: string) => startTransition(async () => {
    if (!confirm('Delete this alias? Re-run the matcher to regenerate candidates. Already-approved mappings are not affected.')) return;
    const res = await deleteAlias(id);
    setMsg({ ok: !!res.ok, text: res.ok ? (res.message ?? 'deleted') : (res.error ?? 'error') });
    if (res.ok) await refresh();
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 12, color: '#555' }}>
        Aliases connect a PokePrices <code>set_name</code> to a TCGGraph set code. Adding or deleting an alias does
        <em> not</em> modify already-approved mappings — re-run the matcher backfill to regenerate candidates for
        pending/unmatched rows.
      </div>

      <div style={{ padding: 10, background: '#f6f8fa', border: '1px solid #d0d7de', borderRadius: 4 }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Add a new alias</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
          <label style={{ fontSize: 12 }}>
            <div>PokePrices set name (exact)</div>
            <input className="ui-input" value={ppSetName} onChange={(e) => setPpSetName(e.target.value)} placeholder="e.g. Scarlet &amp; Violet Promos" />
          </label>
          <label style={{ fontSize: 12 }}>
            <div>PP language</div>
            <select className="ui-select" value={ppLang} onChange={(e) => setPpLang(e.target.value as 'en' | 'jp')}>
              <option value="en">English</option>
              <option value="jp">Japanese</option>
            </select>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input className="ui-input" value={tcgSearch} onChange={(e) => setTcgSearch(e.target.value)} placeholder="Search TCGGraph sets (name or code)…" style={{ flex: 1 }} />
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onSearchTcg} disabled={isPending || !tcgSearch.trim()}>Search</button>
        </div>
        {tcgResults.length > 0 && (
          <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4, marginBottom: 8 }}>
            {tcgResults.map((s) => (
              <button
                key={s.code}
                type="button"
                className={selectedTcg?.code === s.code ? 'alias-row alias-row--selected' : 'alias-row'}
                onClick={() => setSelectedTcg(s)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '6px 10px', fontSize: 12,
                  background: selectedTcg?.code === s.code ? '#eaf3fb' : 'white',
                  border: 'none', borderBottom: '1px solid #eee', cursor: 'pointer',
                }}
              >
                <strong>{s.code}</strong> · {s.name} · {s.language} · {s.releasedAt ?? 'no date'} · {s.cards ?? '?'} cards
              </button>
            ))}
          </div>
        )}
        {selectedTcg && (
          <div style={{ fontSize: 12, marginBottom: 8 }}>
            Selected: <strong>{selectedTcg.code}</strong> — {selectedTcg.name}
          </div>
        )}
        <label style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>
          <div>Note (optional)</div>
          <input className="ui-input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="ui-btn ui-btn--secondary ui-btn--sm" onClick={onPreviewImpact} disabled={isPending || !ppSetName.trim()}>Preview impact</button>
          <button type="button" className="ui-btn ui-btn--primary ui-btn--sm" onClick={onAdd} disabled={isPending || !ppSetName.trim() || !selectedTcg}>Add alias</button>
        </div>
        {impact && <div style={{ fontSize: 12, marginTop: 6, color: '#555' }}>{impact}</div>}
      </div>

      {msg && (
        <div style={{
          fontSize: 12, padding: 8, borderRadius: 4,
          background: msg.ok ? '#f1f8f1' : '#fdf1f1',
          border: `1px solid ${msg.ok ? '#cfe3cf' : '#e5c0c0'}`,
          color: msg.ok ? '#1a5c1a' : '#8b1a1a',
        }}>{msg.text}</div>
      )}

      <div>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Current aliases ({aliases.length})</div>
        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid #ddd', borderRadius: 4 }}>
          {aliases.length === 0 ? (
            <div style={{ fontSize: 12, padding: 10, color: '#666' }}>No aliases yet.</div>
          ) : aliases.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', fontSize: 12, borderBottom: '1px solid #eee' }}>
              <div style={{ flex: 1 }}>
                <strong>{a.pp_set_name}</strong> ({a.pp_language}) → <code>{a.tcg_set_code}</code> ({a.tcg_language})
                {a.notes && <span style={{ color: '#666' }}> · {a.notes}</span>}
              </div>
              <button type="button" className="ui-btn ui-btn--ghost ui-btn--sm" onClick={() => onDelete(a.id)} disabled={isPending}>Delete</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
