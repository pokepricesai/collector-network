# apps/hub

Collector Network umbrella site. Minimal public-facing surface that
links to the five specialist platforms and explains the network.

Deploys to the `collector-network` Vercel project (Framework: Next.js,
root: apps/hub). The project link lives in `.vercel/project.json`
inside this directory and is gitignored.

Routes:

- `/` homepage with the five platform grid
- `/about`
- `/partner`
- `/contact` (POSTs to `/api/contact`)

Contact backend uses Resend. Required Production env vars:

- `RESEND_API_KEY` (reuse the shared Collector Network workspace key)
- `CONTACT_INBOX` (destination mailbox, e.g. `hello@collector.network`)
- `CONTACT_FROM_ADDRESS` (optional, default `Collector Network <contact@send.collector.network>`)

Without those, the form responds with `contact-not-configured` and the
UI points visitors at direct email.
