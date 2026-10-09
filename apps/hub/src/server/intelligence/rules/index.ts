import 'server-only';

// Rule registry. Add new rules here. The engine runs them in the
// order declared; stale resolution scope is the union of their
// `categoriesScanned`.

import type { IntelligenceRule } from '../types';
import { strikingDistanceRule, lowCtrRule, decliningRule, gainingRule } from './seo';
import { stalejobRule } from './data_health';
import { revenueMovementRule, trafficWithoutRevenueRule, revenueEfficiencyRule } from './revenue';
import { highValueOpportunityRule, contentPerformanceRule } from './content';
import { siteGrowthRule, siteGrowthReportingRule } from './growth';
import { indexingCoverageRule } from './indexing';

export const INTELLIGENCE_RULES: readonly IntelligenceRule[] = Object.freeze([
  strikingDistanceRule,
  lowCtrRule,
  decliningRule,
  gainingRule,
  indexingCoverageRule,
  stalejobRule,
  revenueMovementRule,
  revenueEfficiencyRule,
  trafficWithoutRevenueRule,
  highValueOpportunityRule,
  contentPerformanceRule,
  siteGrowthRule,
  siteGrowthReportingRule,
]);
