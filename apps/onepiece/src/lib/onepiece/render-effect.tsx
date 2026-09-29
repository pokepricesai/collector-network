// Renders card effect / trigger text safely. Source rules_text from
// TCGGraph embeds literal `<br>`, `<br/>` and `<br />` tags to mark
// visual line breaks. React by default renders them as text. This
// helper converts every br into an actual JSX <br /> element without
// injecting arbitrary HTML.
//
// Any other tag in the source is intentionally not honoured — we
// treat it as literal text so a malicious upstream feed cannot inject
// scripts, styles or images. Only "br" is whitelisted.

import type { ReactNode } from 'react';

const BR = /<br\s*\/?\s*>/i;

export function renderEffectText(text: string | null | undefined): ReactNode {
  if (!text) return null;
  const parts = text.split(BR);
  if (parts.length === 1) return parts[0];
  const out: ReactNode[] = [];
  parts.forEach((chunk, i) => {
    if (i > 0) out.push(<br key={`br-${i}`} />);
    if (chunk) out.push(chunk);
  });
  return out;
}
