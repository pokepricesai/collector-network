// Operator-facing display names for the five sites and the common
// job families. Keeps raw slugs (pokemon, gsc.incremental, …) out
// of the primary UI copy — those remain available in evidence /
// details / source panels.

export const SITE_DISPLAY_NAMES: Record<string, string> = {
  pokemon:  'PokePrices',
  mtg:      'MTGPrices',
  ygo:      'YGOPrices',
  onepiece: 'OnePiecePrices',
  lorcana:  'LorcanaPrices',
  network:  'Network',
};

export function siteDisplayName(slug: string | null | undefined, fallback = 'Network'): string {
  if (!slug) return fallback;
  return SITE_DISPLAY_NAMES[slug] ?? slug;
}

// Short label (card header, chip). Same as full name for now but
// a hook for future divergence (e.g. "Poke", "MTG", "YGO" chips).
export function siteShortName(slug: string | null | undefined, fallback = 'Network'): string {
  if (!slug) return fallback;
  return SITE_DISPLAY_NAMES[slug] ?? slug;
}

export const JOB_DISPLAY_NAMES: Record<string, string> = {
  'gsc.incremental':          'GSC incremental sync',
  'gsc.sync':                 'GSC incremental sync',
  'ga4.incremental':          'GA4 incremental sync',
  'ga4.sync':                 'GA4 incremental sync',
  'ga4.country.incremental':  'GA4 country breakdown sync',
  'ga4.country.backfill_90d': 'GA4 country 90-day backfill',
  'sitemap.check':            'Sitemap check',
  'inspection.cycle':         'URL inspection cycle',
  'opportunities.generate':   'SEO opportunity engine',
  'intelligence.refresh':     'Intelligence refresh',
  'content.ideas':            'Content idea routing',
  'intel.links_and_pages':    'Internal-link + page analysis',
  'impact.epn.sync':          'Impact EPN affiliate sync',
  'impact.invoices.sync':     'Impact invoice sync',
  'bq.pokeprices_analysis':   'BigQuery analysis (PokePrices)',
};

export function jobDisplayName(jobName: string): string {
  return JOB_DISPLAY_NAMES[jobName] ?? jobName;
}

// Intelligence item type → short human label. Falls back to a
// title-cased slug when unknown.
export const INTEL_TYPE_LABELS: Record<string, string> = {
  striking_distance:          'Striking distance',
  low_ctr:                    'Low CTR',
  declining:                  'Declining page',
  gaining:                    'Gaining page',
  site_growth_up:             'Site growth',
  site_growth_down:           'Site decline',
  site_reporting_traffic_up:  'Reporting traffic up',
  site_reporting_traffic_down:'Reporting traffic down',
  revenue_up:                 'Revenue up',
  revenue_down:               'Revenue down',
  rpku_up:                    'Revenue efficiency up',
  rpku_down:                  'Revenue efficiency down',
  stale_job:                  'Stale scheduled job',
  stale_job_network:          'Network cron stalled',
  failed_job:                 'Failing job',
  sitemap_fetch_error:        'Sitemap fetch error',
  inspection_sample_warning:  'Inspection sampler warning',
  coverage_deterioration:     'Coverage deteriorating',
  traffic_without_revenue:    'Traffic without revenue',
  high_value_opportunity:     'High-value article idea',
  article_striking_distance:  'Article striking distance',
  article_declining:          'Article declining',
};

export function intelTypeLabel(type: string): string {
  if (INTEL_TYPE_LABELS[type]) return INTEL_TYPE_LABELS[type]!;
  // Fallback: Title Case the snake_case.
  return type.split('_').map((p) => p ? p[0]!.toUpperCase() + p.slice(1) : '').join(' ');
}
