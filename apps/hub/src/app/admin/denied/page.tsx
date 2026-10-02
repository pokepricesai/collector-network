import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Access denied',
  robots: { index: false, follow: false },
};

export default function DeniedPage() {
  return (
    <div className="admin-auth-root">
      <div className="admin-auth-card">
        <h1>Access denied</h1>
        <p>
          This account is authenticated but not permitted inside the
          Collector Network Operating System.
        </p>
        <div style={{ display: 'flex', gap: 10 }}>
          <form action="/admin/sign-out" method="post">
            <button type="submit" className="admin-signout-btn">Sign out</button>
          </form>
          <Link href="/" className="admin-signout-btn">Return to public site</Link>
        </div>
      </div>
    </div>
  );
}
