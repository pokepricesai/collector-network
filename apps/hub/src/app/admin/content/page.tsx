import { ModulePage } from '@/components/admin/ModulePage';

export const dynamic = 'force-dynamic';

export default async function ContentPage() {
  return (
    <ModulePage
      pathname="/admin/content"
      eyebrow="Content"
      title="Content workflow"
      description="Insights, articles, FAQ coverage. Later phases connect article generation + approval flow."
      sections={[
        { title: 'Pipeline',   description: 'Drafts, scheduled, published, archived.' },
        { title: 'Coverage',   description: 'Topic coverage per site, gaps, duplicates.' },
        { title: 'AI drafts',  description: 'Proposed drafts awaiting human review. Routed through the Approvals queue.' },
      ]}
    />
  );
}
