import type { Metadata } from 'next';
import { SITE_NAME, SITE_URL } from '@/lib/sites';
import ContactForm from './ContactForm';

export const metadata: Metadata = {
  title: `Contact ${SITE_NAME}`,
  description:
    'Contact Collector Network for partnerships, commercial enquiries or general questions.',
  alternates: { canonical: `${SITE_URL}/contact` },
};

export default function ContactPage() {
  return (
    <section className="section">
      <div className="container" style={{ display: 'grid', gap: 28, maxWidth: 720 }}>
        <div style={{ display: 'grid', gap: 12 }}>
          <span className="eyebrow">Contact</span>
          <h1>Contact {SITE_NAME}.</h1>
          <p className="lede">
            For partnerships, commercial enquiries or general questions, get in touch.
            Pick the enquiry type that fits best and we&apos;ll route it to the right place.
          </p>
        </div>
        <div className="form-panel">
          <ContactForm />
        </div>
      </div>
    </section>
  );
}
