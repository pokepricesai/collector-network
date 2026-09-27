// Render Lorcana rules text with the keyword mechanics visually
// separated. Keywords always appear in the card's own text on the
// physical card (Bodyguard, Challenger +2, Support, Rush, Evasive
// etc.) — surfacing them as chips makes rules parseable at a glance
// without adding editorial content that isn't on the card.

interface Props {
  effectText: string;
  flavourText?: string | null;
}

// Small keyword vocabulary. Only tokens we can reliably split off the
// front of the effect text without ambiguity.
const KEYWORDS = new Set([
  'Bodyguard', 'Challenger', 'Evasive', 'Reckless', 'Resist', 'Rush',
  'Shift', 'Sing Together', 'Singer', 'Support', 'Ward', 'Vanish',
  'Universal Shift', 'Puppy Shift', 'Voiceless',
]);

interface ParsedLine { keyword: string | null; body: string; }

function parseLine(line: string): ParsedLine {
  const trimmed = line.trim();
  // Match "Keyword [modifier]" at the start (case-sensitive per the
  // physical card, but tolerant of extras like "Challenger +2").
  for (const kw of KEYWORDS) {
    if (trimmed.startsWith(kw + ' ') || trimmed === kw) {
      const rest = trimmed.slice(kw.length).trimStart();
      // "Challenger +2 (While challenging, ...)" — pull the modifier.
      const mod = rest.match(/^(\+?\d+|\d+)/);
      if (mod) {
        return { keyword: `${kw} ${mod[0]}`, body: rest.slice(mod[0].length).trimStart() };
      }
      return { keyword: kw, body: rest };
    }
  }
  return { keyword: null, body: trimmed };
}

export default function EffectText({ effectText, flavourText }: Props) {
  const rawLines = effectText.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const lines = rawLines.map(parseLine);

  return (
    <div className="lc-panel">
      <div className="label-mono" style={{ marginBottom: 8 }}>
        Rules text
      </div>
      <div style={{ display: 'grid', gap: 10 }}>
        {lines.map((l, i) => (
          <div key={i} style={{ display: 'grid', gap: 6 }}>
            {l.keyword && (
              <span className="chip chip-amethyst chip-sm" style={{ width: 'fit-content' }}>
                {l.keyword}
              </span>
            )}
            {l.body && (
              <p style={{ margin: 0, lineHeight: 1.55, fontSize: 14 }}>{l.body}</p>
            )}
          </div>
        ))}
      </div>
      {flavourText && (
        <>
          <div className="lc-engraved" aria-hidden style={{ margin: '14px 0 12px' }} />
          <p style={{ margin: 0, color: 'var(--text-muted)', fontStyle: 'italic', fontSize: 13.5, lineHeight: 1.55 }}>
            {flavourText}
          </p>
        </>
      )}
    </div>
  );
}
