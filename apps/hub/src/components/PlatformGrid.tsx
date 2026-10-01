import Image from 'next/image';
import { SITES } from '@/lib/sites';

// The five-platform grid. These real approved logos are the dominant
// visual element on the homepage. Each is a direct anchor to the
// corresponding Production site; they open in the same tab per spec.

export default function PlatformGrid() {
  return (
    <div id="platforms" className="platform-grid">
      {SITES.map((s) => (
        <a
          key={s.slug}
          href={s.href}
          rel="noopener"
          className="platform-card"
          aria-label={`${s.name}: ${s.descriptor}`}
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
          </div>
        </a>
      ))}
    </div>
  );
}
