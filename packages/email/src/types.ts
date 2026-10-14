import type { Brand, BrandSiteCode } from './brand-registry';

export type TemplateKey =
  | 'welcome'
  | 'onboarding_day2'
  | 'onboarding_day7'
  | 'weekly_digest';

export type EmailCategory =
  | 'transactional'
  | 'onboarding'
  | 'weekly_report';

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

export interface TemplateContext {
  brand: Brand;
  recipientEmail: string;
  unsubscribeUrl: string;
  manageUrl: string;
  variables: Record<string, unknown>;
}

export type TemplateRenderer = (ctx: TemplateContext) => RenderedEmail;

export interface QueueItem {
  id: string;
  user_id: string | null;
  recipient_email: string;
  site_code: BrandSiteCode;
  template_key: TemplateKey;
  category: EmailCategory;
  variables: Record<string, unknown>;
  idempotency_key: string;
  send_after: string;
  status: 'pending' | 'sending' | 'sent' | 'failed' | 'skipped' | 'suppressed';
  attempts: number;
  last_error: string | null;
}
