import { Fraunces, Inter, JetBrains_Mono } from 'next/font/google';

// Three-role type system per Slice 2 §W and Slice 4 §N:
//   display — Fraunces (sharp variable serif) for card names + headings
//   body    — Inter (variable) for UI
//   mono    — JetBrains Mono for card codes / prices / grades
//
// All three are variable + latin-only + swap. `display: 'swap'` keeps
// FCP fast; subset "latin" keeps payload small.

export const fontDisplay = Fraunces({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  style: ['normal'],
  variable: '--ygo-font-display',
  display: 'swap',
});

export const fontBody = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--ygo-font-body',
  display: 'swap',
});

export const fontMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--ygo-font-mono',
  display: 'swap',
});

export const ygoFontClassName = `${fontDisplay.variable} ${fontBody.variable} ${fontMono.variable}`;
