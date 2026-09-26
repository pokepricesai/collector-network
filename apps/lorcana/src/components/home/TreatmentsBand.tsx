import Link from 'next/link';

// Editorial band that explains what makes Lorcana collecting distinct.
// The chase axis is rarity (Enchanted / Iconic / Epic / Legendary /
// Promo), overlaid on the foil × nonfoil finish axis. This band gives
// new visitors an anchor for the vocabulary they'll see everywhere.

interface ChaseTile {
  code: string;
  label: string;
  short: string;
  description: string;
}

const CHASE: ChaseTile[] = [
  {
    code: 'enchanted',
    label: 'Enchanted',
    short: 'ENCH',
    description:
      'Bordered alt-art overprint — the signature Lorcana chase. Numbered past the base set, often the top-priced card in every release.',
  },
  {
    code: 'iconic',
    label: 'Iconic',
    short: 'ICON',
    description:
      'The rarest overprint tier introduced in later sets. Reserved for cards Ravensburger considers marquee.',
  },
  {
    code: 'epic',
    label: 'Epic',
    short: 'EPIC',
    description:
      'Extended-illustration Epic-rarity chase — the modern successor to early-set Super Rare treatments.',
  },
  {
    code: 'legendary',
    label: 'Legendary',
    short: 'LEG',
    description:
      "The deck-defining tier that anchors Illumineer's Trove boxes and Set 9+ set-flavour releases.",
  },
  {
    code: 'promo',
    label: 'Promo',
    short: 'PROMO',
    description:
      'Event, tournament, launch and partner exclusives. D23 and Challenge Promo drops live here.',
  },
  {
    code: 'foil',
    label: 'Cold Foil',
    short: 'FOIL',
    description:
      'The shimmering cold-foil finish present on roughly half of every printing. Priced independently of nonfoil.',
  },
];

export default function TreatmentsBand() {
  return (
    <section style={{ padding: '48px 24px' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
        <div style={{ marginBottom: 20 }}>
          <div className="label-mono" style={{ color: 'var(--accent-2)' }}>
            Lorcana chase axis
          </div>
          <h2 style={{ fontSize: 28, margin: '4px 0 0' }}>
            The same card, priced by its chase treatment
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
            Enchanted, Iconic, Epic and promotional printings are each
            their own priced entity on LorcanaPrice, so an Enchanted
            overprint is never buried under its base-rarity sibling.
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: 12,
          }}
        >
          {CHASE.map((t) => (
            <div
              key={t.code}
              style={{
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: 16,
                display: 'grid',
                gap: 10,
              }}
            >
              <span className={`treatment-badge treatment-badge--${t.code}`}>
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
          ))}
        </div>

        <div style={{ marginTop: 18 }}>
          <Link href="/card-finder" className="btn btn-primary">
            Find cards by chase
          </Link>
        </div>
      </div>
    </section>
  );
}
