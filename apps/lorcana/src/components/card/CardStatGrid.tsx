import type { LcGamedata } from '@/lib/lorcana/gamedata';
import { LC_CARD_TYPE_LABEL } from '@/lib/lorcana/card-type';
import { LC_INK_LABEL } from '@/lib/lorcana/ink';

// Gameplay-fact panel. Renders whichever fields are present. A
// Character has lore / strength / willpower; an Item / Action / Song
// has none of the combat stats; a Location adds Move cost. The chip
// grid gates on non-null presence so we never render "Willpower: —".

export default function CardStatGrid({
  gamedata,
  classifications,
}: {
  gamedata: LcGamedata;
  classifications: string[];
}) {
  const rows: Array<{ label: string; value: string }> = [];

  if (gamedata.cardType) {
    rows.push({ label: 'Type', value: LC_CARD_TYPE_LABEL[gamedata.cardType] });
  }
  if (gamedata.inks.length > 0) {
    rows.push({
      label: gamedata.inks.length > 1 ? 'Inks' : 'Ink',
      value: gamedata.inks.map((c) => LC_INK_LABEL[c]).join(' / '),
    });
  }
  if (gamedata.inkCost != null) rows.push({ label: 'Ink Cost', value: String(gamedata.inkCost) });
  if (gamedata.inkable != null) {
    rows.push({ label: 'Inkable', value: gamedata.inkable ? 'Yes' : 'No' });
  }
  if (gamedata.lore != null) rows.push({ label: 'Lore', value: String(gamedata.lore) });
  if (gamedata.strength != null) rows.push({ label: 'Strength', value: String(gamedata.strength) });
  if (gamedata.willpower != null) rows.push({ label: 'Willpower', value: String(gamedata.willpower) });
  if (gamedata.moveCost != null) rows.push({ label: 'Move Cost', value: String(gamedata.moveCost) });
  if (gamedata.version) rows.push({ label: 'Version', value: gamedata.version });
  if (classifications.length > 0) {
    rows.push({ label: 'Classifications', value: classifications.join(', ') });
  }

  if (rows.length === 0) return null;

  return (
    <dl
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: 10,
        margin: 0,
        padding: 16,
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: 12,
      }}
    >
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="label-mono" style={{ marginBottom: 3 }}>
            {r.label}
          </dt>
          <dd style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
