import type { OpGamedata } from '@/lib/onepiece/gamedata';
import { OP_CARD_TYPE_LABEL } from '@/lib/onepiece/card-type';
import { OP_COLOUR_LABEL } from '@/lib/onepiece/colour';

// Gameplay-fact panel. Renders whichever fields are present — a Leader
// has life; Characters have counter and power; Events have neither.
// Kept purely presentational: the caller passes the parsed gamedata.

export default function CardStatGrid({
  gamedata,
  types,
}: {
  gamedata: OpGamedata;
  types: string[];
}) {
  const rows: Array<{ label: string; value: string }> = [];

  if (gamedata.type) rows.push({ label: 'Type', value: OP_CARD_TYPE_LABEL[gamedata.type] });
  if (gamedata.colours.length > 0)
    rows.push({
      label: 'Colour',
      value: gamedata.colours.map((c) => OP_COLOUR_LABEL[c]).join(' / '),
    });
  if (gamedata.cost != null) rows.push({ label: 'Cost', value: String(gamedata.cost) });
  if (gamedata.power != null) rows.push({ label: 'Power', value: String(gamedata.power) });
  if (gamedata.counter != null) rows.push({ label: 'Counter', value: `+${gamedata.counter}` });
  if (gamedata.life != null) rows.push({ label: 'Life', value: String(gamedata.life) });
  if (gamedata.attribute) rows.push({ label: 'Attribute', value: gamedata.attribute });
  if (gamedata.trigger)
    rows.push({ label: 'Trigger', value: gamedata.trigger === 'Yes' ? 'On' : gamedata.trigger });
  if (types.length > 0) rows.push({ label: 'Type / Crew', value: types.join(', ') });
  if (gamedata.language) rows.push({ label: 'Language', value: gamedata.language.toUpperCase() });

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
