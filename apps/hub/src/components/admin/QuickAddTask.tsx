'use client';

import { useRef, useState, useTransition } from 'react';
import { createManualTaskAction } from '@/app/admin/tasks/actions';

// Persistent "+ Task" button in the admin topbar. Opens a native
// <dialog> drawer-ish modal with: title, site, fix|improvement,
// priority, notes. Submission uses the server action and closes
// on success. Keeps dependencies tiny — no third-party modal lib.

interface Site { slug: string; name: string }

export function QuickAddTask({ sites, defaultSiteSlug }: { sites: Site[]; defaultSiteSlug?: string }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<'fix' | 'improvement'>('improvement');
  const [priority, setPriority] = useState<'high' | 'normal' | 'low'>('normal');

  function open() {
    const d = dialogRef.current;
    if (!d) return;
    if (!d.open) d.showModal();
    // Focus the title input a tick after showModal.
    setTimeout(() => {
      const titleInput = formRef.current?.querySelector('input[name="title"]') as HTMLInputElement | null;
      titleInput?.focus();
    }, 0);
  }
  function close() {
    dialogRef.current?.close();
    formRef.current?.reset();
    setKind('improvement');
    setPriority('normal');
  }

  async function handleSubmit(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const data = new FormData(form);
    startTransition(async () => {
      try {
        await createManualTaskAction(data);
        close();
      } catch (err) {
        // Server action throws rejected if validation hit; the
        // dialog stays open so the operator can retry.
        console.error('[QuickAddTask] submit failed:', err);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="ui-btn ui-btn--primary ui-btn--sm"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6,
          height: 32, padding: '0 12px', fontSize: 13, fontWeight: 600,
        }}
        aria-label="Quick-add a task"
      >
        <span style={{ fontSize: 16, lineHeight: 1 }}>+</span>
        <span>Task</span>
      </button>

      <dialog
        ref={dialogRef}
        onClick={(ev) => {
          // Click outside dialog closes it. The dialog element
          // receives the click when the backdrop (outside the
          // dialog's padding box) is clicked.
          if (ev.target === dialogRef.current) close();
        }}
        style={{
          padding: 0, border: 'none', borderRadius: 10,
          maxWidth: 480, width: 'min(480px, calc(100vw - 32px))',
          background: 'var(--admin-surface, #fff)',
          color: 'var(--admin-text, #111)',
          boxShadow: '0 24px 72px rgba(0,0,0,0.35)',
        }}
      >
        <form ref={formRef} onSubmit={handleSubmit} style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <strong style={{ fontSize: 14 }}>Quick-add task</strong>
            <button
              type="button" onClick={close}
              aria-label="Close"
              style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--admin-text-muted)' }}
            >×</button>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <span className="admin-eyebrow" style={{ fontSize: 10 }}>Task</span>
            <input
              name="title"
              type="text"
              required
              maxLength={240}
              placeholder="What needs doing?"
              className="ui-input"
              style={{ padding: '8px 10px', fontSize: 14, borderRadius: 6, border: '1px solid var(--admin-border)' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
              <span className="admin-eyebrow" style={{ fontSize: 10 }}>Site</span>
              <select
                name="site_slug"
                defaultValue={defaultSiteSlug ?? 'network'}
                className="ui-input"
                style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--admin-border)', background: 'var(--admin-surface)' }}
              >
                <option value="network">Network</option>
                {sites.map((s) => (
                  <option key={s.slug} value={s.slug}>{s.name}</option>
                ))}
              </select>
            </label>

            <fieldset style={{ border: '1px solid var(--admin-border)', borderRadius: 6, padding: '4px 6px', display: 'flex', gap: 4 }}>
              <legend className="admin-eyebrow" style={{ fontSize: 10, padding: '0 4px' }}>Kind</legend>
              {(['fix', 'improvement'] as const).map((k) => (
                <label key={k} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 4, background: kind === k ? 'var(--admin-accent, #4a90e2)' : 'transparent', color: kind === k ? '#fff' : 'var(--admin-text)' }}>
                  <input
                    type="radio"
                    name="task_kind"
                    value={k}
                    checked={kind === k}
                    onChange={() => setKind(k)}
                    style={{ display: 'none' }}
                  />
                  {k}
                </label>
              ))}
            </fieldset>
          </div>

          <fieldset style={{ border: '1px solid var(--admin-border)', borderRadius: 6, padding: '4px 6px', display: 'flex', gap: 4 }}>
            <legend className="admin-eyebrow" style={{ fontSize: 10, padding: '0 4px' }}>Priority (optional)</legend>
            {(['high', 'normal', 'low'] as const).map((p) => (
              <label key={p} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, fontSize: 12, cursor: 'pointer', padding: '4px 6px', borderRadius: 4, background: priority === p ? 'var(--admin-accent, #4a90e2)' : 'transparent', color: priority === p ? '#fff' : 'var(--admin-text)' }}>
                <input
                  type="radio"
                  name="priority"
                  value={p}
                  checked={priority === p}
                  onChange={() => setPriority(p)}
                  style={{ display: 'none' }}
                />
                {p}
              </label>
            ))}
          </fieldset>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
            <span className="admin-eyebrow" style={{ fontSize: 10 }}>Notes (optional)</span>
            <textarea
              name="notes"
              rows={2}
              maxLength={1000}
              placeholder="Extra context, if useful"
              className="ui-input"
              style={{ padding: '8px 10px', fontSize: 13, borderRadius: 6, border: '1px solid var(--admin-border)', resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
            <button type="button" onClick={close} className="ui-btn ui-btn--secondary ui-btn--sm">Cancel</button>
            <button type="submit" disabled={isPending} className="ui-btn ui-btn--primary ui-btn--sm">
              {isPending ? 'Adding…' : 'Add task'}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
