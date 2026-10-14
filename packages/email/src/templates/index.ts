import type { TemplateKey, TemplateRenderer } from '../types';
import { renderWelcome } from './welcome';
import { renderOnboardingDay2 } from './onboarding-day2';
import { renderOnboardingDay7 } from './onboarding-day7';
import { renderWeeklyDigest } from './weekly-digest';

export const TEMPLATE_RENDERERS: Record<TemplateKey, TemplateRenderer> = {
  welcome: renderWelcome,
  onboarding_day2: renderOnboardingDay2,
  onboarding_day7: renderOnboardingDay7,
  weekly_digest: renderWeeklyDigest,
};

export function renderTemplate(key: TemplateKey, ctx: Parameters<TemplateRenderer>[0]) {
  const fn = TEMPLATE_RENDERERS[key];
  if (!fn) throw new Error(`Unknown template key: ${key}`);
  return fn(ctx);
}

export { renderWelcome, renderOnboardingDay2, renderOnboardingDay7, renderWeeklyDigest };
