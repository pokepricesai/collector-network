import { redirect } from 'next/navigation';

// Automation was a near-duplicate of Jobs. Phase 2 consolidation
// routes bookmarks to /admin/jobs which is now the canonical
// job-control page. The URL stays reachable to avoid breaking
// bookmarks; the sidebar entry was removed in Phase 1.

export default function AutomationPage() {
  redirect('/admin/jobs');
}
