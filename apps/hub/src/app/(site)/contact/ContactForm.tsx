'use client';

import { useState } from 'react';

type Status = 'idle' | 'sending' | 'sent' | 'error';

const ENQUIRY_TYPES = [
  'Partnership',
  'Sponsorship',
  'Marketplace / retailer',
  'Grading',
  'Data / integration',
  'Press / media',
  'General',
] as const;

export default function ContactForm() {
  const [status, setStatus] = useState<Status>('idle');
  const [message, setMessage] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setStatus('sending');
    setMessage(null);
    try {
      const res = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'send-failed' }));
        throw new Error(body?.error ?? 'send-failed');
      }
      setStatus('sent');
      setMessage('Thanks. We have logged your enquiry and will reply by email.');
      form.reset();
    } catch (err) {
      setStatus('error');
      const msg = err instanceof Error ? err.message : String(err);
      setMessage(
        msg === 'contact-not-configured'
          ? 'Our contact backend is being set up. Please email us directly in the meantime.'
          : 'Something went wrong. Please try again shortly.',
      );
    }
  }

  return (
    <form className="form" onSubmit={handleSubmit}>
      <div className="form-row-2">
        <div className="form-row">
          <label htmlFor="name">Name</label>
          <input id="name" name="name" type="text" required maxLength={120} autoComplete="name" />
        </div>
        <div className="form-row">
          <label htmlFor="company">Company</label>
          <input id="company" name="company" type="text" maxLength={160} autoComplete="organization" />
        </div>
      </div>
      <div className="form-row">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" required maxLength={180} autoComplete="email" />
      </div>
      <div className="form-row">
        <label htmlFor="type">Enquiry type</label>
        <select id="type" name="type" defaultValue="Partnership">
          {ENQUIRY_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label htmlFor="message">Message</label>
        <textarea id="message" name="message" required maxLength={5000} />
      </div>

      {/* Simple honeypot. Real users will not fill a hidden input. */}
      <div style={{ position: 'absolute', left: '-9999px', height: 0, width: 0 }} aria-hidden>
        <label>Leave this field empty
          <input type="text" name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={status === 'sending'}
        >
          {status === 'sending' ? 'Sending' : 'Send enquiry'}
        </button>
        {message && (
          <span
            className="notice"
            style={{
              borderColor:
                status === 'sent' ? '#D4D4D2' :
                status === 'error' ? '#E8CFCF' : 'var(--border)',
              background:
                status === 'sent' ? '#F3F6F2' :
                status === 'error' ? '#FBF4F4' : 'var(--surface-strong)',
            }}
          >
            {message}
          </span>
        )}
      </div>
    </form>
  );
}
