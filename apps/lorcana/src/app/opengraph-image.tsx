import { ImageResponse } from 'next/og';
import { SITE_URL } from '@/lib/site-url';

// Root open-graph image. Warm parchment background with the six-ink
// wheel fading in from the corner and the horizontal wordmark logo at
// the top. Individual pages can override with their own
// opengraph-image route.

export const runtime = 'edge';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default async function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: 'linear-gradient(180deg, #FBF6E7 0%, #F6EFE0 100%)',
          display: 'flex',
          flexDirection: 'column',
          padding: 80,
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Six-ink wheel. Amber, Amethyst, Emerald, Ruby, Sapphire, Steel */}
        <div
          style={{
            position: 'absolute',
            top: -140,
            right: -80,
            width: 900,
            height: 380,
            background:
              'radial-gradient(circle at 10% 60%, rgba(231,168,26,0.40) 0%, transparent 30%),' +
              'radial-gradient(circle at 26% 55%, rgba(122,78,240,0.45) 0%, transparent 30%),' +
              'radial-gradient(circle at 42% 60%, rgba(44,154,101,0.40) 0%, transparent 30%),' +
              'radial-gradient(circle at 58% 55%, rgba(214,58,74,0.40)  0%, transparent 30%),' +
              'radial-gradient(circle at 74% 60%, rgba(46,119,205,0.40) 0%, transparent 30%),' +
              'radial-gradient(circle at 90% 55%, rgba(107,122,148,0.35) 0%, transparent 30%)',
            display: 'flex',
          }}
        />
        <div style={{ display: 'flex' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`${SITE_URL}/logo.png`}
            alt="LorcanaPrices"
            width={480}
            height={160}
            style={{ display: 'block' }}
          />
        </div>

        <div
          style={{
            marginTop: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              color: '#1B1236',
              letterSpacing: -2,
              lineHeight: 1.05,
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <span>Every printing.</span>
            <span
              style={{
                background:
                  'linear-gradient(135deg, #D0AC46 0%, #8E6924 40%, #7A4EF0 100%)',
                backgroundClip: 'text',
                color: 'transparent',
                display: 'flex',
              }}
            >
              Every Enchanted.
            </span>
          </div>
          <div
            style={{
              fontSize: 26,
              color: '#5F5678',
              lineHeight: 1.4,
              maxWidth: 900,
              display: 'flex',
            }}
          >
            Live Disney Lorcana prices. Enchanted, Iconic, Epic and Promo cards priced individually.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
