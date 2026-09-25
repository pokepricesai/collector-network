import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { AttributeChip, AttributeIcon } from '../../../components/AttributeIcon';
import { CardClassBadge } from '../../../components/CardClassBadge';
import { CardImageFrame } from '../../../components/CardImageFrame';
import { EditionBadge } from '../../../components/EditionBadge';
import { FnlBadge } from '../../../components/FnlBadge';
import { GradedPriceCell } from '../../../components/GradedPriceCell';
import { PrintingFingerprint } from '../../../components/PrintingFingerprint';
import { RarityBadge } from '../../../components/RarityBadge';
import { RarityRibbon } from '../../../components/RarityRibbon';
import { Stat, StatRow } from '../../../components/Stat';
import { Surface } from '../../../components/Surface';
import { DuelDivider } from '../../../components/signature/DuelDivider';
import { RarityRefractorLine } from '../../../components/signature/RarityRefractorLine';
import {
  ATTRIBUTES,
  CARD_CLASSES,
  DISPLAYABLE_GRADES,
  FNL_STATES,
  FNL_STATE_LABELS,
  RARITY_FAMILIES,
  RARITY_FAMILY_LABELS,
} from '../../../design/tokens';
import { YGO_DEV_TOOLS_ENABLED } from '../../../lib/dev-mode';
import styles from './page.module.css';

// Dev-only design lab. Gated on NEXT_PUBLIC_YGO_DEV_TOOLS=1 so the
// route is invisible to search engines and to production users unless
// deliberately turned on. Uses `notFound()` when disabled — Next.js
// serves a 404, no leakage.

export const metadata: Metadata = {
  title: 'YGO design system - dev only',
  robots: { index: false, follow: false, nocache: true },
};

// One representative raw rarity string per family — used to prove that
// normalisation is stable. Anything the DB might legitimately return.
const RARITY_SAMPLES: Array<{ family: string; raw: string }> = [
  { family: 'common', raw: 'Common' },
  { family: 'rare', raw: 'Rare' },
  { family: 'super', raw: 'Super Rare' },
  { family: 'ultra', raw: 'Ultra Rare' },
  { family: 'ultimate', raw: 'Ultimate Rare' },
  { family: 'secret', raw: 'Secret Rare' },
  { family: 'secret', raw: 'Ultra Secret Rare' },
  { family: 'secret', raw: 'Extra Secret Rare' },
  { family: 'prismatic-secret', raw: 'Prismatic Secret Rare' },
  { family: 'ghost', raw: 'Ghost Rare' },
  { family: 'collectors', raw: "Collector's Rare" },
  { family: 'prismatic-collectors', raw: "Prismatic Collector's Rare" },
  { family: 'starlight', raw: 'Starlight Rare' },
  { family: 'qcsr', raw: 'Quarter Century Secret Rare' },
  { family: 'gold', raw: 'Gold Rare' },
  { family: 'gold', raw: 'Premium Gold Rare' },
  { family: 'platinum', raw: 'Platinum Secret Rare' },
  { family: 'parallel', raw: 'Duel Terminal Normal Parallel Rare' },
  { family: 'parallel', raw: "Pharaoh's Rare" },
  { family: 'short-print', raw: 'Short Print' },
  { family: 'other', raw: 'Made-up New Rarity 2027' },
];

const EDITION_SAMPLES = ['1st_edition', 'limited', null];

const CLASS_SAMPLES = CARD_CLASSES.filter((c) => c !== 'unknown');

export default function DesignSystemPage() {
  if (!YGO_DEV_TOOLS_ENABLED) {
    notFound();
  }
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Yu-Gi-Oh! design system</h1>
        <p className={styles.subtitle}>
          Local design lab. Every primitive shown here is Yu-Gi-Oh!-only
          and lives under <code className={styles.mono}>apps/yugioh/src/</code>.
          Nothing here queries production. Toggle{' '}
          <code className={styles.mono}>NEXT_PUBLIC_YGO_DEV_TOOLS=1</code>{' '}
          to enable this route.
        </p>
      </header>

      <div className={styles.notice}>
        Reminder: no card / homepage / set pages exist yet. This is the
        primitive library only. Copy adjustments and layout composition
        happen in slices 5–7.
      </div>

      {/* Typography ─────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Typography</h2>
        <p>Three-role system: display serif for card names, humanist sans for UI, monospace for codes and numerics.</p>
        <div className={styles.type}>
          <div className={styles.display}>Blue-Eyes White Dragon</div>
          <div className={styles.body}>
            This legendary dragon is a powerful engine of destruction. Virtually
            invincible, very few have faced this awesome creature and lived to
            tell the tale.
          </div>
          <div className={styles.mono}>LOB-001 · 3000 / 2500 · $128.54 USD</div>
        </div>
      </section>

      <DuelDivider />

      {/* Surfaces ─────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Surfaces</h2>
        <p>Six semantic surfaces. Cards sit on <code className={styles.mono}>card</code>; market data on <code className={styles.mono}>market</code>; graded slabs on <code className={styles.mono}>premium</code>.</p>
        <div className={styles.surfaceGrid}>
          {(['base', 'raised', 'card', 'market', 'premium', 'overlay'] as const).map((v) => (
            <Surface key={v} variant={v} className={styles.surfaceCell}>
              {v}
            </Surface>
          ))}
        </div>
      </section>

      <DuelDivider />

      {/* Attributes ─────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Attributes - original iconography</h2>
        <p>Seven original glyphs. Not Konami&rsquo;s icons; distinct silhouettes so accessibility does not rely on colour.</p>
        <div className={styles.stripRow}>
          {ATTRIBUTES.map((a) => (
            <div key={a} className={styles.cell}>
              <AttributeIcon attribute={a} size={40} />
              <AttributeChip attribute={a} />
            </div>
          ))}
        </div>
      </section>

      <DuelDivider />

      {/* Rarity system ─────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Rarity - 17 families, {RARITY_SAMPLES.length} raw values mapped</h2>
        <p>
          Every production rarity string normalises to one of {RARITY_FAMILIES.length}{' '}
          semantic families. Unknown values fall through to <code className={styles.mono}>other</code>.
        </p>
        <div className={styles.grid}>
          {RARITY_SAMPLES.map((sample) => (
            <div key={sample.raw} className={styles.cell}>
              <span className={styles.cellLabel}>
                {sample.raw} → {sample.family}
              </span>
              <RarityBadge rarity={sample.raw} showDot />
              <RarityRefractorLine rarity={sample.raw} />
              <div style={{ fontSize: 10, color: 'var(--ygo-text-quiet)' }}>
                {RARITY_FAMILY_LABELS[sample.family as keyof typeof RARITY_FAMILY_LABELS] ?? sample.family}
              </div>
            </div>
          ))}
        </div>
      </section>

      <DuelDivider />

      {/* Editions ─────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Edition - three-state (honest about NULL)</h2>
        <p>
          Production only stores <code className={styles.mono}>1st_edition</code>{' '}
          and <code className={styles.mono}>limited</code>. Everything else is NULL and is labelled
          &ldquo;Unlimited / Unspecified&rdquo; - never a bare &ldquo;Unlimited&rdquo;.
        </p>
        <div className={styles.stripRow}>
          {EDITION_SAMPLES.map((e, i) => (
            <div key={i} className={styles.cell}>
              <span className={styles.cellLabel}>
                {e === null ? 'NULL' : e}
              </span>
              <EditionBadge edition={e} />
            </div>
          ))}
        </div>
      </section>

      <DuelDivider />

      {/* Card classes ─────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Card class + Spell/Trap</h2>
        <p>Original glyphs for Fusion / Synchro / Xyz / Pendulum / Link / Ritual / Effect / Normal, plus Spell and Trap.</p>
        <div className={styles.stripRow}>
          {CLASS_SAMPLES.map((c) => (
            <CardClassBadge key={c} cardClass={c} />
          ))}
          <CardClassBadge cardClass={null} />
        </div>
      </section>

      <DuelDivider />

      {/* F&L ─────────────────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Forbidden & Limited status</h2>
        <p>Colour + shape (colour alone is never the signal).</p>
        <div className={styles.stripRow}>
          {FNL_STATES.map((s) => (
            <div key={s} className={styles.cell}>
              <span className={styles.cellLabel}>{FNL_STATE_LABELS[s]}</span>
              <FnlBadge state={s} />
            </div>
          ))}
        </div>
      </section>

      <DuelDivider />

      {/* Printing fingerprint ───────────────────────────────── */}
      <section className={styles.section}>
        <h2>Printing fingerprint (signature element)</h2>
        <p>
          Compact identifier that combines set-code + rarity + edition + language.
          Designed so a collector can memorise the exact printing they own.
        </p>
        <div className={styles.stripRow}>
          <PrintingFingerprint
            collectorNumber="LOB-001"
            rarity="Ultra Rare"
            edition="1st_edition"
            language="en"
          />
          <PrintingFingerprint
            collectorNumber="LOB-001"
            rarity="Ultra Rare"
            edition={null}
            language="en"
          />
          <PrintingFingerprint
            collectorNumber="BLMM-EN001"
            rarity="Secret Rare"
            edition="1st_edition"
            language="en"
          />
          <PrintingFingerprint
            collectorNumber="25YC-ENP01"
            rarity="Rare"
            edition="limited"
            language="en"
          />
          <PrintingFingerprint
            collectorNumber="RA05-EN001"
            rarity="Prismatic Collector's Rare"
            edition="1st_edition"
            language="en"
          />
        </div>
      </section>

      <DuelDivider />

      {/* Numeric stats ───────────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Numeric stats</h2>
        <p>Tabular-numeric monospace treatment. ATK / DEF / Level / Rank / Link Rating / Pendulum Scale.</p>
        <Surface variant="card">
          <StatRow>
            <Stat label="ATK" value={3000} kind="atk" size="lg" />
            <Stat label="DEF" value={2500} kind="def" size="lg" />
            <Stat label="Level" value={8} kind="level" />
          </StatRow>
        </Surface>
        <div style={{ height: 8 }} />
        <Surface variant="card">
          <StatRow>
            <Stat label="ATK" value={2300} kind="atk" size="lg" />
            <Stat label="DEF" value={null} kind="def" size="lg" />
            <Stat label="Link" value={3} kind="link" />
            <Stat label="↖ ↑ ↗" value="markers" kind="link" size="sm" />
          </StatRow>
        </Surface>
      </section>

      <DuelDivider />

      {/* Card image + ribbon ────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Card image treatment</h2>
        <p>
          Placeholder + rarity-aware hover glow. Card images are the visual
          focus; the frame is a subtle premium border. Rarity ribbon is
          overlaid for the &ldquo;pull-from-pack&rdquo; feel on high rarities.
        </p>
        <div className={styles.stripRow}>
          {(
            [
              { rarity: 'Common', label: 'Common' },
              { rarity: 'Ultra Rare', label: 'Ultra' },
              { rarity: 'Secret Rare', label: 'Secret' },
              { rarity: 'Ghost Rare', label: 'Ghost' },
              { rarity: 'Starlight Rare', label: 'Starlight' },
              { rarity: 'Quarter Century Secret Rare', label: 'QCSR' },
              { rarity: "Prismatic Collector's Rare", label: 'Prismatic Collector' },
            ] as const
          ).map(({ rarity, label }) => (
            <div key={rarity} style={{ position: 'relative', width: 160 }}>
              <CardImageFrame src={null} alt="Sample card" rarity={rarity} maxWidth={160} />
              <RarityRibbon rarity={rarity} label={label} />
            </div>
          ))}
        </div>
      </section>

      <DuelDivider />

      {/* Grading primitives ─────────────────────────────────── */}
      <section className={styles.section}>
        <h2>Graded value cells</h2>
        <p>
          Grader + grade + price + optional volume. Grade 10 gets gold; 9.5 gets
          platinum; step down from there. Refuses to render <code className={styles.mono}>ungraded</code> /{' '}
          <code className={styles.mono}>raw</code>.
        </p>
        <Surface variant="premium">
          <div className={styles.stripRow}>
            {(['psa', 'bgs', 'cgc', 'sgc', 'any'] as const).map((grader) =>
              DISPLAYABLE_GRADES.map((g) => (
                <GradedPriceCell
                  key={`${grader}-${g}`}
                  grader={grader}
                  grade={g}
                  price={
                    grader === 'psa' && g === '10'
                      ? 5450
                      : grader === 'bgs' && g === '10'
                      ? 7085
                      : grader === 'cgc' && g === '10'
                      ? 4377.35
                      : grader === 'sgc' && g === '10'
                      ? 3270
                      : grader === 'any' && g === '9.5'
                      ? 886.62
                      : grader === 'any' && g === '9'
                      ? 640
                      : grader === 'any' && g === '8'
                      ? 265
                      : grader === 'any' && g === '7'
                      ? 166.77
                      : null
                  }
                  currency="USD"
                  cardSalesVolume={g === '10' ? 279 : undefined}
                />
              )),
            )}
          </div>
        </Surface>

        <div style={{ height: 16 }} />

        <p style={{ color: 'var(--ygo-status-limited-ink)' }}>
          Attempted render of <code className={styles.mono}>grader=&quot;raw&quot;</code> below (should be blank):
        </p>
        <div className={styles.stripRow}>
          <GradedPriceCell grader="raw" grade="ungraded" price={75} currency="USD" />
          <GradedPriceCell grader="psa" grade="ungraded" price={75} currency="USD" />
        </div>
      </section>

      <DuelDivider label="End of primitives" />

      <div style={{ height: 96 }} />
    </main>
  );
}
