import 'server-only';

// Rule registry. Add new rules here. The engine runs them in the
// order declared; stale resolution scope is the union of their
// `categoriesScanned`.

import type { IntelligenceRule } from '../types';
import { strikingDistanceRule, lowCtrRule, zeroClickRule, decliningRule, gainingRule } from './seo';
import { stalejobRule } from './data_health';
import { revenueMovementRule, trafficWithoutRevenueRule, revenueEfficiencyRule } from './revenue';
import { highValueOpportunityRule, contentPerformanceRule } from './content';
import { siteGrowthRule, siteGrowthReportingRule } from './growth';
import { indexingCoverageRule } from './indexing';
import { releaseReadinessRule } from './releases';

export const INTELLIGENCE_RULES: readonly IntelligenceRule[] = Object.freeze([
  strikingDistanceRule,
  lowCtrRule,
  zeroClickRule,
  decliningRule,
  gainingRule,
  indexingCoverageRule,
  stalejobRule,
  revenueMovementRule,
  revenueEfficiencyRule,
  trafficWithoutRevenueRule,
  highValueOpportunityRule,
  contentPerformanceRule,
  releaseReadinessRule,
  siteGrowthRule,
  siteGrowthReportingRule,
]);
