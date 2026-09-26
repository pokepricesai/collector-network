import { SITE_URL } from '@/lib/site-url';

// Site-wide Organization + WebSite schema. Tells Google the site
// identity and canonical name for SERP rendering.

export default function SiteStructuredData() {
  const graph = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#org`,
        name: 'LorcanaPrice',
        alternateName: 'LorcanaPrice.io',
        url: SITE_URL,
        description:
          'LorcanaPrice. Live Disney Lorcana card prices, printings, chase treatments and set catalogue. Independent price aggregator — not affiliated with Disney or Ravensburger.',
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        url: SITE_URL,
        name: 'LorcanaPrice',
        publisher: { '@id': `${SITE_URL}/#org` },
        inLanguage: 'en-US',
        potentialAction: {
          '@type': 'SearchAction',
          target: {
            '@type': 'EntryPoint',
            urlTemplate: `${SITE_URL}/cards/search?q={search_term_string}`,
          },
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(graph) }}
    />
  );
}
