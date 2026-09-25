import { ImageResponse } from 'next/og';

// Root open-graph image. Warm ivory background with the OP colour
// crest fading in from the corner and a large gold title. Individual
// pages can override this with their own opengraph-image route.

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
          background: 'linear-gradient(180deg, #FEF8E4 0%, #FBF5E6 100%)',
          display: 'flex',
          flexDirection: 'column',
          padding: 80,
          position: 'relative',
          fontFamily: 'sans-serif',
        }}
      >
        {/* Colour crest */}
        <div
          style={{
            position: 'absolute',
            top: -140,
            right: -80,
            width: 900,
            height: 380,
            background:
              'radial-gradient(circle at 10% 60%, rgba(214,58,58,0.35) 0%, transparent 30%),' +
              'radial-gradient(circle at 26% 55%, rgba(231,182,43,0.45) 0%, transparent 30%),' +
              'radial-gradient(circle at 42% 60%, rgba(50,156,95,0.40) 0%, transparent 30%),' +
              'radial-gradient(circle at 58% 55%, rgba(42,111,208,0.40) 0%, transparent 30%),' +
              'radial-gradient(circle at 74% 60%, rgba(122,69,192,0.35) 0%, transparent 30%),' +
              'radial-gradient(circle at 90% 55%, rgba(42,46,56,0.25) 0%, transparent 30%)',
            display: 'flex',
          }}
        />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 18,
              background:
                'linear-gradient(135deg, #E9B23A 0%, #C88C1A 60%, #E85A2C 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#3B1E00',
              fontSize: 34,
              fontWeight: 800,
              letterSpacing: -1,
            }}
          >
            OP
          </div>
          <div
            style={{
              fontSize: 40,
              fontWeight: 800,
              color: '#071431',
              letterSpacing: -1,
              display: 'flex',
            }}
          >
            OnePiecePrices
            <span
              style={{
                marginLeft: 8,
                color: '#96660F',
                fontSize: 18,
                fontFamily: 'ui-monospace, monospace',
                letterSpacing: 2,
                display: 'flex',
                alignItems: 'flex-end',
                paddingBottom: 8,
              }}
            >
              .io
            </span>
          </div>
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
              color: '#071431',
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
                  'linear-gradient(135deg, #E9B23A 0%, #96660F 60%, #E9B23A 100%)',
                backgroundClip: 'text',
                color: 'transparent',
                display: 'flex',
              }}
            >
              Every treatment.
            </span>
          </div>
          <div
            style={{
              fontSize: 26,
              color: '#5A6683',
              lineHeight: 1.4,
              maxWidth: 900,
              display: 'flex',
            }}
          >
            Live One Piece Card Game prices — parallels, alternate arts, manga rares and secret rares priced individually.
          </div>
        </div>
      </div>
    ),
    { ...size },
  );
}
