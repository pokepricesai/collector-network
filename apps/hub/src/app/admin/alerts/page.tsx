import { redirect } from 'next/navigation';

// Alerts has been consolidated into the Intelligence Inbox. The
// backend table (network_alerts) still exists for any code that
// writes to it, but the operator-facing surface is now one
// system: /admin/intelligence filtered to risk + warning.
//
// Keeping this file as a redirect so bookmarked links still land
// somewhere useful.

export default function AlertsPage() {
  redirect('/admin/intelligence?status=active');
}
