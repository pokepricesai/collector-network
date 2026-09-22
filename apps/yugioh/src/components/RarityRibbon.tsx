import type { CSSProperties } from 'react';
import type { RarityFamily } from '../design/tokens';
import { familyHasSpectral, normaliseRarity } from '../lib/rarity';
import styles from './RarityRibbon.module.css';

interface RarityRibbonProps {
  rarity: string | null | undefined;
  label?: string;
}

const BG_VAR: Record<RarityFamily, string> = {
  common: 'var(--ygo-rarity-common)',
  rare: 'var(--ygo-rarity-rare)',
  super: 'var(--ygo-rarity-super)',
  ultra: 'var(--ygo-rarity-ultra)',
  ultimate: 'var(--ygo-rarity-ultimate)',
  secret: 'var(--ygo-rarity-secret)',
  'prismatic-secret': 'var(--ygo-rarity-secret)',
  ghost: 'var(--ygo-rarity-ghost)',
  collectors: 'var(--ygo-rarity-collectors)',
  'prismatic-collectors': 'var(--ygo-rarity-prismatic-collectors)',
  starlight: '#e8ecff',
  qcsr: 'var(--ygo-rarity-qcsr)',
  gold: 'var(--ygo-rarity-gold)',
  platinum: 'var(--ygo-rarity-platinum)',
  parallel: 'var(--ygo-rarity-parallel)',
  'short-print': 'var(--ygo-rarity-short-print)',
  other: 'var(--ygo-rarity-other)',
};

const INK_VAR: Record<RarityFamily, string> = {
  common: 'var(--ygo-rarity-common-ink)',
  rare: 'var(--ygo-rarity-rare-ink)',
  super: 'var(--ygo-rarity-super-ink)',
  ultra: 'var(--ygo-rarity-ultra-ink)',
  ultimate: 'var(--ygo-rarity-ultimate-ink)',
  secret: 'var(--ygo-rarity-secret-ink)',
  'prismatic-secret': 'var(--ygo-rarity-secret-ink)',
  ghost: 'var(--ygo-rarity-ghost-ink)',
  collectors: 'var(--ygo-rarity-collectors-ink)',
  'prismatic-collectors': 'var(--ygo-rarity-prismatic-collectors-ink)',
  starlight: 'var(--ygo-rarity-starlight-ink)',
  qcsr: 'var(--ygo-rarity-qcsr-ink)',
  gold: 'var(--ygo-rarity-gold-ink)',
  platinum: 'var(--ygo-rarity-platinum-ink)',
  parallel: 'var(--ygo-rarity-parallel-ink)',
  'short-print': 'var(--ygo-rarity-short-print-ink)',
  other: 'var(--ygo-rarity-other-ink)',
};

const SPECTRAL_VAR: Partial<Record<RarityFamily, string>> = {
  secret: 'var(--ygo-rarity-secret-spectral)',
  'prismatic-secret': 'var(--ygo-rarity-prismatic-secret-spectral)',
  starlight: 'var(--ygo-rarity-starlight-glint)',
  qcsr: 'var(--ygo-rarity-qcsr-spectral)',
  'prismatic-collectors': 'var(--ygo-rarity-starlight-glint)',
};

export function RarityRibbon({ rarity, label }: RarityRibbonProps) {
  const family = normaliseRarity(rarity);
  const displayLabel = label ?? rarity?.trim() ?? '';
  if (!displayLabel) return null;
  const spectralBg = SPECTRAL_VAR[family];
  const style = {
    '--rarity-bg': BG_VAR[family],
    '--rarity-ink': INK_VAR[family],
    ...(spectralBg ? { '--rarity-spectral': spectralBg } : {}),
  } as CSSProperties;
  const classes = [styles.ribbon, familyHasSpectral(family) ? styles.spectral : '']
    .filter(Boolean)
    .join(' ');
  return (
    <div
      className={classes}
      style={style}
      role="img"
      aria-label={`Rarity: ${displayLabel}`}
    >
      {displayLabel}
    </div>
  );
}
