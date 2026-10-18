'use client';

import { useState } from 'react';
import SetAliasPanel from './SetAliasPanel';

interface Props {
  initialAliases: Array<{ id: string; pp_set_name: string; pp_language: string; tcg_set_code: string; tcg_language: string; notes: string | null; created_at: string }>;
}

// Collapsible wrapper around SetAliasPanel. The alias workflow is now
// a secondary surface — operators spend most of their time in the
// review queue above. The panel stays available but doesn't demand
// screen real estate on page load.

export default function SetAliasSection({ initialAliases }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <section className="admin-panel">
      <header className="admin-panel-head">
        <div>
          <div className="admin-eyebrow">D · secondary workflow</div>
          <h2 className="admin-h2">Set alias management ({initialAliases.length})</h2>
        </div>
        <button
          type="button"
          onClick={() => setOpen(x => !x)}
          className="ui-btn ui-btn--ghost ui-btn--sm"
          aria-expanded={open}
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </header>
      {open && (
        <div className="admin-panel-body">
          <SetAliasPanel initialAliases={initialAliases} />
        </div>
      )}
    </section>
  );
}
