import { NextResponse, type NextRequest } from 'next/server';

// Minimal contact-enquiry endpoint. Pure proxy to the shared Resend
// transactional sender when it is configured; otherwise responds with
// a known error that the client surfaces so the user can email us
// directly. We never silently drop enquiries.
//
// Secrets are server-side only. Nothing is exposed to the browser.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface Payload {
  name?: string;
  company?: string;
  email?: string;
  type?: string;
  message?: string;
  website?: string;
}

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Strip ASCII control characters (U+0000-U+001F and U+007F) and trim;
// cap at `max` so a submitted field cannot blow the body size.
function sanitise(value: unknown, max = 500): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) continue;
    out += ch;
    if (out.length >= max) break;
  }
  return out.trim();
}

export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as Payload;

  // Honeypot: real users will not fill a hidden input.
  if (payload.website && payload.website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  const name = sanitise(payload.name, 200);
  const email = sanitise(payload.email, 200);
  const company = sanitise(payload.company, 200);
  const type = sanitise(payload.type, 60) || 'General';
  // Message tolerates newlines, which the generic sanitise above
  // drops. Handle it with a looser cleaner.
  const rawMessage = typeof payload.message === 'string' ? payload.message : '';
  const message = rawMessage.replace(/\r/g, '').trim().slice(0, 5000);

  if (!name || !email || !message) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 });
  }

  const apiKey = process.env['RESEND_API_KEY'];
  const toAddress = process.env['CONTACT_INBOX'];
  const fromAddress =
    process.env['CONTACT_FROM_ADDRESS'] ??
    'Collector Network <contact@send.collector.network>';

  if (!apiKey || !toAddress) {
    return NextResponse.json(
      { error: 'contact-not-configured' },
      { status: 503 },
    );
  }

  const subject = `[Collector Network] ${type} enquiry from ${name}`;
  const text = [
    `Name:    ${name}`,
    `Company: ${company || '(not provided)'}`,
    `Email:   ${email}`,
    `Type:    ${type}`,
    '',
    'Message:',
    message,
  ].join('\n');

  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: fromAddress,
        to: [toAddress],
        reply_to: email,
        subject,
        text,
      }),
    });
    if (!res.ok) {
      return NextResponse.json({ error: 'send-failed' }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'send-failed' }, { status: 502 });
  }
}
