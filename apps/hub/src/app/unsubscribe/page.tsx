export const dynamic = 'force-dynamic';

export default function UnsubscribePage() {
  return (
    <main style={{ fontFamily: '-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif', padding: '48px 20px', maxWidth: 560, margin: '0 auto', color: '#0b0d13' }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>You've been unsubscribed</h1>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: '#1f2937' }}>
        We won&apos;t send you any more marketing or weekly digest emails from this site.
      </p>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: '#4b5563', marginTop: 16 }}>
        You will still receive transactional emails required for the service (for example, email confirmation and password reset).
      </p>
      <p style={{ fontSize: 14, lineHeight: 1.6, color: '#4b5563', marginTop: 16 }}>
        Changed your mind? Open the site and update your preferences from the Settings page.
      </p>
    </main>
  );
}
