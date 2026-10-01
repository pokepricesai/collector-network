import Image from 'next/image';
import { SITES } from '@/lib/sites';
import { ArrowUpRight } from './icons';

// Five-platform grid. Logos stay dominant; a per-brand accent colour
// is used only for the hover glow and the subtle "Visit site" cue
// that fades in. External links open in a new tab per spec.

export default function PlatformGrid() {
  return (
    <div id="platforms" className="platform-grid">
      {SITES.map((s) => (
        <a
          key={s.slug}
          href={s.href}
          target="_blank"
          rel="noopener noreferrer"
          className="platform-card"
          aria-label={`${s.name}: ${s.descriptor} (opens in new tab)`}
          style={{ ['--accent' as string]: s.accent }}
        >
          <div className="platform-logo">
            <Image
              src={s.logo}
              alt={s.name}
              width={s.width}
              height={s.height}
              priority
              sizes="(max-width: 480px) 85vw, (max-width: 1023px) 40vw, 20vw"
            />
          </div>
          <div className="platform-meta">
            <span className="platform-name">{s.name}</span>
            <span className="platform-desc">{s.descriptor}</span>
            <span className="platform-visit" aria-hidden>
              Visit site <ArrowUpRight />
            </span>
          </div>
        </a>
      ))}
    </div>
  );
}
