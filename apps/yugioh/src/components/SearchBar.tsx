'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ANALYTICS_EVENTS, trackEvent } from '../lib/analytics-events';
import styles from './SearchBar.module.css';

interface SearchBarProps {
  size?: 'sm' | 'lg';
  placeholder?: string;
  defaultQuery?: string;
  autoFocus?: boolean;
}

interface Suggestion {
  name: string;
  variantCount: number;
  representativeCollectorNumber: string | null;
  representativeRarity: string | null;
}

const DEBOUNCE_MS = 250;

// The single interactive component in Slice 5. Server components
// render the hero + header shell; this component only owns the input +
// autocomplete dropdown. All routing lands at /search?q=… so nothing
// depends on card/printing pages existing yet.
export function SearchBar({
  size = 'sm',
  placeholder = 'Card name, set code, archetype…',
  defaultQuery = '',
  autoFocus = false,
}: SearchBarProps) {
  const router = useRouter();
  const [value, setValue] = useState(defaultQuery);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const abortRef = useRef<AbortController | null>(null);
  const dropdownId = useId();

  useEffect(() => {
    if (!value.trim() || value.trim().length < 2) {
      setSuggestions([]);
      abortRef.current?.abort();
      abortRef.current = null;
      return;
    }
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search/suggest?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { suggestions: Suggestion[] };
        if (!controller.signal.aborted) {
          setSuggestions(data.suggestions.slice(0, 8));
          setActiveIndex(-1);
        }
      } catch {
        // AbortError or network — swallow silently, the next keystroke
        // will retry.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  const submit = useCallback(
    (submittedValue: string) => {
      const q = submittedValue.trim();
      if (!q) return;
      trackEvent(ANALYTICS_EVENTS.SEARCH_SUBMITTED, { query: q, length: q.length });
      router.push(`/search?q=${encodeURIComponent(q)}`);
      setOpen(false);
    },
    [router],
  );

  const selectSuggestion = useCallback(
    (s: Suggestion) => {
      trackEvent(ANALYTICS_EVENTS.SEARCH_SUGGESTION_SELECTED, {
        name: s.name,
        variantCount: s.variantCount,
      });
      setValue(s.name);
      submit(s.name);
    },
    [submit],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, suggestions.length - 1));
        setOpen(true);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter') {
        if (activeIndex >= 0 && suggestions[activeIndex]) {
          e.preventDefault();
          const chosen = suggestions[activeIndex];
          selectSuggestion(chosen);
        }
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    },
    [activeIndex, suggestions, selectSuggestion],
  );

  return (
    <form
      className={`${styles.form} ${size === 'lg' ? styles.large : ''}`}
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
      onBlur={(e) => {
        // Close the dropdown when focus leaves the form entirely.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
          setTimeout(() => setOpen(false), 150);
        }
      }}
    >
      <span className={styles.iconWrap} aria-hidden="true">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
          <circle cx="10" cy="10" r="6.5" stroke="currentColor" strokeWidth="1.6" />
          <line x1="15" y1="15" x2="20" y2="20" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </span>
      <input
        className={styles.input}
        type="text"
        name="q"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        role="combobox"
        aria-expanded={open && suggestions.length > 0}
        aria-controls={dropdownId}
        aria-activedescendant={activeIndex >= 0 ? `${dropdownId}-${activeIndex}` : undefined}
        aria-autocomplete="list"
      />
      <button className={styles.submit} type="submit">
        Search
      </button>
      {open && suggestions.length > 0 && (
        <div
          id={dropdownId}
          className={styles.dropdown}
          role="listbox"
        >
          {suggestions.map((s, i) => (
            <button
              key={`${s.name}-${i}`}
              type="button"
              id={`${dropdownId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              className={styles.suggestion}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => selectSuggestion(s)}
            >
              <span className={styles.suggestionName}>{s.name}</span>
              {s.representativeRarity && (
                <span className={styles.suggestionMeta}>{s.representativeRarity}</span>
              )}
              {s.representativeCollectorNumber && (
                <span className={styles.suggestionMeta}>{s.representativeCollectorNumber}</span>
              )}
              <span className={styles.suggestionCount}>
                {s.variantCount} {s.variantCount === 1 ? 'printing' : 'printings'}
              </span>
            </button>
          ))}
          <div className={styles.helper}>
            Press <kbd>Enter</kbd> to view all matches
          </div>
        </div>
      )}
    </form>
  );
}
