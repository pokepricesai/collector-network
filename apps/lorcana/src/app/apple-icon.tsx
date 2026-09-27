// apple-icon.tsx — 180x180 PNG for iOS home-screen bookmarks.
// Draws the same four-point sparkle emblem as icon.svg via
// next/og's ImageResponse. Transparent background allowed by Next.
//
// Kept programmatic (rather than a raster PNG) so a designer can
// swap the palette or shape without a rasterisation step.

import { ImageResponse } from 'next/og';

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'transparent',
        }}
      >
        <svg width="180" height="180" viewBox="0 0 64 64">
          <defs>
            <linearGradient id="ap" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#8B5CF6" />
              <stop offset="1" stopColor="#4C1D95" />
            </linearGradient>
          </defs>
          <path
            fill="url(#ap)"
            d="M32 4 L36 24 L44 22 L38 30 L60 32 L38 34 L44 42 L36 40 L32 60 L28 40 L20 42 L26 34 L4 32 L26 30 L20 22 L28 24 Z"
          />
          <circle cx="32" cy="32" r="4.5" fill="#FFF5E1" fillOpacity="0.92" />
        </svg>
      </div>
    ),
    size,
  );
}
