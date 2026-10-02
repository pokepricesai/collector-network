import { ModulePage } from '@/components/admin/ModulePage';

export const dynamic = 'force-dynamic';

export default async function RevenuePage() {
  return (
    <ModulePage
      pathname="/admin/revenue"
      eyebrow="Revenue"
      title="Revenue"
      description="Affiliate clicks, affiliate revenue, other income and operating cost. Numbers appear once EPN + manual-cost entry are wired."
      sections={[
        { title: 'Affiliate',     description: 'Per-site click + revenue, source: eBay Partner Network.' },
        { title: 'Other revenue', description: 'Manual-entry income streams.' },
        { title: 'Costs',         description: 'Operating cost allocation per site.' },
        { title: 'Net',           description: 'Derived net profit per site + across the network.' },
      ]}
    />
  );
}
