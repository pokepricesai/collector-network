import Link from 'next/link';
import { OP_TREATMENTS, type OpTreatment } from '@/lib/onepiece/treatment';

// Editorial band that explains what makes OP collecting distinct — the
// treatment axis. Static content: gives new visitors an anchor for the
// vocabulary they'll see across the site.

const ORDER: OpTreatment[] = [
  'alt-art',
  'manga-rare',
  'sec',
  'parallel',
  'special-rare',
  'promo',
];

export default function TreatmentsBand() {
  return (
    <section style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div className="label-mono" style={{ color: 'var(--gold-600)' }}>
            One Piece treatments
          </div>
          <h2 style={{ fontSize: 28, margin: '4px 0 0' }}>
            The same card, priced by its treatment
          </h2>
          <p
            style={{
              maxWidth: 720,
              margin: '10px 0 0',
              color: 'var(--text-muted)',
              fontSize: 15,
              lineHeight: 1.6,
            }}
          >
            Card number is a gameplay identifier — not a collector one. Every
            parallel, alternate art, manga rare and secret rare is its own priced
            entity on OnePiecePrices, so a chase card is never buried under its
            base printing.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: 12,
          }}
        >
          {ORDER.map((code) => {
            const t = OP_TREATMENTS[code];
            return (
              <div
                key={code}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  padding: 16,
                  display: 'grid',
                  gap: 10,
                }}
              >
                <span className={`treatment-badge treatment-badge--${code}`}>
                  {t.label}
                </span>
                <p
                  style={{
                    margin: 0,
                    color: 'var(--text-muted)',
                    fontSize: 13.5,
                    lineHeight: 1.55,
                  }}
                >
                  {t.description}
                </p>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 18 }}>
          <Link href="/card-finder" className="btn btn-primary">
            Find cards by treatment
          </Link>
        </div>
      </div>
    </section>
  );
}
