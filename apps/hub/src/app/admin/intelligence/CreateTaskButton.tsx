'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createTaskFromItemAction, type CreateTaskResult } from './actions';

// CN-05 OS UX fix (v2) — Client-side navigator for Create Task.
//
// The paired Server Action (createTaskFromItemAction) performs the
// DB mutations and returns a structured result. This component
// drives the browser-side navigation via useRouter.push(), which is
// substantially more reliable than redirect() from inside a Server
// Action (the previous attempt silently failed to navigate when the
// client bundle was stale or any client-side error interfered — the
// Server Action still ran, the opportunity's status still flipped,
// but the browser stayed on /admin/intelligence).
//
// Error handling: if the Server Action returns ok: false, we render
// the error next to the button and leave the opportunity actionable
// so retrying is safe. The intel item is NOT marked task_created
// unless the task row actually exists (enforced server-side).

export function CreateTaskButton({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    setError(null);
    startTransition(async () => {
      let result: CreateTaskResult;
      try {
        result = await createTaskFromItemAction(itemId);
      } catch (e) {
        setError(`Create Task failed to reach the server: ${(e as Error).message}. Opportunity remains actionable; try again.`);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Server Action succeeded. Navigate the browser to the task
      // detail page via the App Router. The ?from=intelligence
      // query param gives the task-detail page a context-aware
      // back-link so the operator stays inside one coherent
      // Intelligence → act → back-to-Intelligence loop.
      // router.push() does a soft client-side navigation;
      // router.refresh() ensures any cached segments reflect the
      // DB mutations the Server Action made.
      router.push(`/admin/tasks/${result.task_id}?from=intelligence`);
      router.refresh();
    });
  }

  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <button
        type="button"
        onClick={onClick}
        disabled={pending}
        className="ui-btn ui-btn--primary ui-btn--sm"
        aria-busy={pending ? 'true' : 'false'}
      >
        {pending ? 'Opening…' : 'Review & act'}
      </button>
      {error && (
        <div
          role="alert"
          style={{
            fontSize: 11,
            color: '#b00020',
            background: 'rgba(176, 0, 32, 0.08)',
            border: '1px solid rgba(176, 0, 32, 0.3)',
            padding: '4px 8px',
            borderRadius: 4,
            maxWidth: 340,
            lineHeight: 1.4,
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}
