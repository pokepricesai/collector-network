'use client';

// Filter panel — a standard <form GET> so the entire page continues
// to work without JS. Submitting the form navigates to a URL that
// re-runs the server-side finder query. The only client-side
// behaviour is the "Filters" collapse on mobile.

import { useState } from 'react';
import type { FinderFilters } from '../../lib/finder-filters';
import { SORT_OPTIONS } from '../../lib/finder-filters';
import styles from './CardFinder.module.css';

const ATTRIBUTES = ['LIGHT', 'DARK', 'FIRE', 'WATER', 'WIND', 'EARTH', 'DIVINE'];
const FRAME_TYPES = [
  { key: 'effect', label: 'Effect' },
  { key: 'normal', label: 'Normal' },
  { key: 'ritual', label: 'Ritual' },
  { key: 'fusion', label: 'Fusion' },
  { key: 'synchro', label: 'Synchro' },
  { key: 'xyz', label: 'Xyz' },
  { key: 'pendulum', label: 'Pendulum' },
  { key: 'link', label: 'Link' },
  { key: 'spell', label: 'Spell' },
  { key: 'trap', label: 'Trap' },
];
const MONSTER_TYPES = [
  'Dragon', 'Spellcaster', 'Warrior', 'Beast', 'Beast-Warrior', 'Winged Beast',
  'Zombie', 'Fiend', 'Fairy', 'Machine', 'Aqua', 'Pyro', 'Thunder', 'Rock',
  'Plant', 'Insect', 'Fish', 'Sea Serpent', 'Reptile', 'Psychic', 'Dinosaur',
  'Wyrm', 'Cyberse', 'Divine-Beast',
];
const BANLIST_STATES: { key: string; label: string }[] = [
  { key: '', label: 'Any' },
  { key: 'forbidden', label: 'Forbidden' },
  { key: 'limited', label: 'Limited' },
  { key: 'semi_limited', label: 'Semi-Limited' },
  { key: 'unlimited', label: 'Unlimited' },
];

interface Props {
  filters: FinderFilters;
}

export function FilterPanel({ filters }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        className={styles.mobileToggle}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span>Filters</span>
        <span aria-hidden>{open ? '−' : '+'}</span>
      </button>

      <form
        method="get"
        action="/card-finder"
        className={`${styles.panel} ${!open ? styles.panelCollapsed : ''}`}
      >
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            type="text"
            defaultValue={filters.q ?? ''}
            placeholder="e.g. LIGHT Dragon Level 4 1800+"
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="attribute">Attribute</label>
          <select id="attribute" name="attribute" defaultValue={filters.attribute ?? ''} className={styles.select}>
            <option value="">Any</option>
            {ATTRIBUTES.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="frameType">Card class</label>
          <select id="frameType" name="frameType" defaultValue={filters.frameType ?? ''} className={styles.select}>
            <option value="">Any</option>
            {FRAME_TYPES.map((f) => (
              <option key={f.key} value={f.key}>{f.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="race">Monster type</label>
          <select id="race" name="race" defaultValue={filters.race ?? ''} className={styles.select}>
            <option value="">Any</option>
            {MONSTER_TYPES.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="archetype">Archetype</label>
          <input
            id="archetype"
            name="archetype"
            type="text"
            defaultValue={filters.archetype ?? ''}
            placeholder="e.g. Blue-Eyes"
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>Level / Rank / Link</label>
          <div className={styles.rangeRow}>
            <input name="level" type="number" min={0} max={13} defaultValue={filters.level ?? ''} placeholder="Level" className={styles.input} />
            <input name="rank" type="number" min={0} max={13} defaultValue={filters.rank ?? ''} placeholder="Rank" className={styles.input} />
          </div>
          <input name="link" type="number" min={1} max={8} defaultValue={filters.linkRating ?? ''} placeholder="Link rating" className={styles.input} />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>ATK range</label>
          <div className={styles.rangeRow}>
            <input name="atk_min" type="number" min={0} defaultValue={filters.atkMin ?? ''} placeholder="Min" className={styles.input} />
            <input name="atk_max" type="number" min={0} defaultValue={filters.atkMax ?? ''} placeholder="Max" className={styles.input} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>DEF range</label>
          <div className={styles.rangeRow}>
            <input name="def_min" type="number" min={0} defaultValue={filters.defMin ?? ''} placeholder="Min" className={styles.input} />
            <input name="def_max" type="number" min={0} defaultValue={filters.defMax ?? ''} placeholder="Max" className={styles.input} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel}>USD price range</label>
          <div className={styles.rangeRow}>
            <input name="price_min" type="number" min={0} step="0.01" defaultValue={filters.priceMin ?? ''} placeholder="Min" className={styles.input} />
            <input name="price_max" type="number" min={0} step="0.01" defaultValue={filters.priceMax ?? ''} placeholder="Max" className={styles.input} />
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="fnl">TCG legality</label>
          <select id="fnl" name="fnl" defaultValue={filters.banlistTcg ?? ''} className={styles.select}>
            {BANLIST_STATES.map((b) => (
              <option key={b.key} value={b.key}>{b.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="setCode">Set code</label>
          <input
            id="setCode"
            name="setCode"
            type="text"
            defaultValue={filters.setCode ?? ''}
            placeholder="e.g. lob, phni"
            className={styles.input}
          />
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="sort">Sort</label>
          <select id="sort" name="sort" defaultValue={filters.sort ?? 'relevance'} className={styles.select}>
            {SORT_OPTIONS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
        </div>

        <div className={styles.actions}>
          <button type="submit" className={styles.button}>Search</button>
          <a href="/card-finder" className={styles.buttonGhost}>Clear</a>
        </div>
      </form>
    </div>
  );
}
