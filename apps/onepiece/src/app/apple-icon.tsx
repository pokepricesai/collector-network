import { ImageResponse } from 'next/og';

// Dynamic 180×180 apple-touch icon rendering the same compass-rose
// emblem as icon.svg. Keeping the two in sync avoids either surface
// looking off-brand — home-screen adds and browser tabs pull from
// this file family. No trademarked One Piece imagery is used.

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
          background:
            'linear-gradient(135deg, #DC2626 0%, #7F1D1D 100%)',
          borderRadius: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
        }}
      >
        <svg
          width="140"
          height="140"
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="32" cy="32" r="26" fill="none" stroke="#F5C518" strokeWidth="2.5" />
          <path d="M32 8 L36 30 L32 32 L28 30 Z" fill="#F5C518" />
          <path d="M32 56 L36 34 L32 32 L28 34 Z" fill="#F5C518" />
          <path d="M8 32 L30 36 L32 32 L30 28 Z" fill="#F5C518" />
          <path d="M56 32 L34 36 L32 32 L34 28 Z" fill="#F5C518" />
          <circle cx="32" cy="32" r="3.5" fill="#FFF5DE" />
        </svg>
      </div>
    ),
    { ...size },
  );
}
