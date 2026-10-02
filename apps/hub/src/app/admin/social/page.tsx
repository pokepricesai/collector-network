import { ModulePage } from '@/components/admin/ModulePage';

export const dynamic = 'force-dynamic';

export default async function SocialPage() {
  return (
    <ModulePage
      pathname="/admin/social"
      eyebrow="Social"
      title="Social"
      description="X activity and scheduled posts per site. External API not connected in Phase 0."
      sections={[
        { title: 'X account health',   description: 'Followers, engagement, outbound.' },
        { title: 'Scheduled posts',    description: 'Queued drafts routed through Approvals.' },
      ]}
    />
  );
}
