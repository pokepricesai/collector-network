import 'server-only';
import rawSets from './data/tcg-pokemon-sets.json';

export interface TcgSet {
  code: string;
  name: string;
  language: string;
  releasedAt: string | null;
  cards: number | null;
  printings: number | null;
}

const ALL: readonly TcgSet[] = Object.freeze(rawSets as TcgSet[]);

export function allTcgSets(): readonly TcgSet[] {
  return ALL;
}

export function searchTcgSets(query: string, limit = 20, language?: 'en' | 'ja' | 'all'): TcgSet[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: TcgSet[] = [];
  for (const s of ALL) {
    if (language && language !== 'all' && s.language !== language) continue;
    const code = s.code.toLowerCase();
    const name = s.name.toLowerCase();
    if (code.includes(q) || name.includes(q)) results.push(s);
    if (results.length >= limit) break;
  }
  return results;
}

export function tcgSetByCode(code: string): TcgSet | null {
  return ALL.find(s => s.code === code) ?? null;
}
