// Small inline SVGs. Geometric, uniform stroke, no stock-icon feel.
// Reused across platform cards, partner cards, footer links.

import type { SVGProps } from 'react';

const defaults: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export function ArrowUpRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function ArrowRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M5 12h14" />
      <path d="M13 5l7 7-7 7" />
    </svg>
  );
}

export function IconSponsor(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M12 3l2.6 5.3 5.9.9-4.3 4.2 1 5.8L12 16.9 6.8 19.2l1-5.8L3.5 9.2l5.9-.9L12 3z" />
    </svg>
  );
}

export function IconRetail(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M4 7h16l-1 11a2 2 0 01-2 2H7a2 2 0 01-2-2L4 7z" />
      <path d="M8 7V5a4 4 0 018 0v2" />
    </svg>
  );
}

export function IconGrading(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <path d="M7 3h10v4H7z" />
      <path d="M9 7v2a3 3 0 006 0V7" />
      <path d="M12 11v4" />
      <path d="M8 21h8l-1-5H9l-1 5z" />
    </svg>
  );
}

export function IconData(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <ellipse cx="12" cy="5" rx="8" ry="2.5" />
      <path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5" />
      <path d="M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" />
    </svg>
  );
}

export function IconCustom(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...defaults} {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
    </svg>
  );
}
