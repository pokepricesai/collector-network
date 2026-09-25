import Link from 'next/link';

export default function NotFound() {
  return (
    <div style={{ padding: '80px 24px' }}>
      <div
        style={{
          maxWidth: 640,
          margin: '0 auto',
          textAlign: 'center',
          display: 'grid',
          gap: 18,
        }}
      >
        <span className="badge-prestige" style={{ margin: '0 auto' }}>
          404 · Card not found
        </span>
        <h1 style={{ margin: 0, fontSize: 34 }}>
          This treasure isn't on the map — yet
        </h1>
        <p style={{ color: 'var(--text-muted)', margin: 0, fontSize: 16 }}>
          The card, set or page you're looking for doesn't exist. It may not have
          been ingested yet, or the URL may have shifted.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link href="/" className="btn btn-primary">
            Home
          </Link>
          <Link href="/browse" className="btn btn-ghost">
            Browse sets
          </Link>
          <Link href="/cards/search" className="btn btn-ghost">
            Search cards
          </Link>
        </div>
      </div>
    </div>
  );
}
