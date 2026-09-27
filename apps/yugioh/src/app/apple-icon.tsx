import { ImageResponse } from 'next/og';

// Dynamic 180x180 apple-touch icon rendering the same three-diamond
// emblem as icon.svg. No trademarked Yu-Gi-Oh! logo, Eye of Anubis
// or Millennium symbol. Purple + gold to align with the site theme.

export const runtime = 'edge';
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(135deg, #7C3AED 0%, #4C1D95 100%)',
          borderRadius: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '4px solid #F5C518',
          position: 'relative',
        }}
      >
        <svg
          width="130"
          height="130"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M32 12 L44 24 L32 36 L20 24 Z" fill="#F5C518" />
          <path d="M32 32 L40 40 L32 48 L24 40 Z" fill="#FFF5DE" fillOpacity="0.9" />
          <path d="M32 44 L36 48 L32 52 L28 48 Z" fill="#F5C518" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
