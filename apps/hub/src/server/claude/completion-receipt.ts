import 'server-only';

// CN-05 OS Phase B — strict validator for the structured JSON that
// Claude Code returns after implementing an action.
//
// Pure function. No DB, no AI, no side effects. Used by the task
// detail Server Action to accept or reject a pasted receipt before
// writing it to network_tasks.metadata.implementation_receipt.
//
// Design notes:
//   * Hand-rolled rather than Zod because the hub doesn't already
//     have a validator dep and adding one just for this shape
//     would be gratuitous (the brief says "no new dependencies").
//   * Required: action_id (must match the task), summary, completed_at.
//   * Everything else is optional-but-structured so the receipt is
//     useful even when the action was a manual-platform step with no
//     commit or deploy SHA.
//   * Strings are size-capped so a huge paste can't blow up metadata.
//   * On failure, returns the first error with a precise JSON path.

export interface ImplementationReceiptInput {
  action_id: string;
  implementation_type?: string;
  completed_at: string;              // ISO timestamp
  repository?: string;
  commit_sha?: string | null;
  production_deployment_sha?: string | null;
  affected_pages_or_features?: string[];
  summary_of_what_changed: string;
  tests_performed?: string[];
  live_verification?: string;
  rollback_route?: string;
  primary_success_metric?: string;
  guardrail_metrics?: string[];
  outstanding_issues?: string | null;
}

export interface ImplementationReceiptStored
  extends ImplementationReceiptInput {
  received_at: string;               // when the server accepted it
  received_version: 'cn05-receipt-v1';
  operator_confirmed_at?: string | null;
  operator_confirmed_by?: string | null;
}

const MAX_STR = 4_000;
const MAX_ARR = 20;
const MAX_ARR_ITEM = 500;

export type ValidationResult =
  | { ok: true; value: ImplementationReceiptInput }
  | { ok: false; error: string; path?: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function cappedString(v: unknown, path: string, max = MAX_STR): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string') return 'TYPE_ERROR' as unknown as string;
  const t = v.trim();
  if (t.length === 0) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function cappedStringArray(v: unknown, path: string): string[] | 'TYPE_ERROR' | null {
  if (v === null || v === undefined) return null;
  if (!Array.isArray(v)) return 'TYPE_ERROR';
  const out: string[] = [];
  for (let i = 0; i < Math.min(v.length, MAX_ARR); i++) {
    const item = v[i];
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t.length > MAX_ARR_ITEM ? t.slice(0, MAX_ARR_ITEM) : t);
  }
  return out;
}

function isIsoTimestamp(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  // Loose ISO 8601 check; Date.parse handles both date-only and full.
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) && v.includes('-');
}

/** Validate a parsed JSON object against the receipt schema.
 *  Receipts that reference a different task's action_id are rejected
 *  at the caller. */
export function validateImplementationReceipt(
  raw: unknown,
  expectedActionId: string,
): ValidationResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Receipt must be a JSON object.' };
  }
  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.action_id)) {
    return { ok: false, error: 'action_id is required and must be a non-empty string.', path: 'action_id' };
  }
  if (obj.action_id !== expectedActionId) {
    return {
      ok: false,
      error: `action_id in receipt (${obj.action_id}) does not match the task ID (${expectedActionId}).`,
      path: 'action_id',
    };
  }
  if (!isIsoTimestamp(obj.completed_at)) {
    return { ok: false, error: 'completed_at must be an ISO-8601 timestamp string.', path: 'completed_at' };
  }
  if (!isNonEmptyString(obj.summary_of_what_changed)) {
    return {
      ok: false,
      error: 'summary_of_what_changed is required and must be a non-empty string.',
      path: 'summary_of_what_changed',
    };
  }

  // Optional fields — strict type-check if present.
  const optionalStrings: Array<keyof ImplementationReceiptInput> = [
    'implementation_type',
    'repository',
    'commit_sha',
    'production_deployment_sha',
    'live_verification',
    'rollback_route',
    'primary_success_metric',
    'outstanding_issues',
  ];
  const output: Record<string, unknown> = {
    action_id: obj.action_id,
    completed_at: new Date(obj.completed_at as string).toISOString(),
    summary_of_what_changed: cappedString(obj.summary_of_what_changed, 'summary_of_what_changed'),
  };
  for (const key of optionalStrings) {
    if (obj[key] === undefined) continue;
    if (obj[key] === null) {
      output[key] = null;
      continue;
    }
    const s = cappedString(obj[key], key);
    if (s === 'TYPE_ERROR') {
      return { ok: false, error: `${key} must be a string, null, or omitted.`, path: key };
    }
    if (s !== null) output[key] = s;
  }

  const optionalArrays: Array<keyof ImplementationReceiptInput> = [
    'affected_pages_or_features',
    'tests_performed',
    'guardrail_metrics',
  ];
  for (const key of optionalArrays) {
    if (obj[key] === undefined) continue;
    const arr = cappedStringArray(obj[key], key);
    if (arr === 'TYPE_ERROR') {
      return { ok: false, error: `${key} must be an array of strings or omitted.`, path: key };
    }
    if (arr && arr.length > 0) output[key] = arr;
  }

  return { ok: true, value: output as unknown as ImplementationReceiptInput };
}

/** Parse a raw string (textarea paste) and validate. */
export function parseAndValidateReceipt(
  raw: string,
  expectedActionId: string,
): ValidationResult {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, error: 'Paste is empty.' };
  // Allow operators to paste a prose intro + JSON — extract the first
  // balanced JSON object. Prevents the whole receipt failing because
  // Claude wrapped it in commentary.
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    return { ok: false, error: 'No JSON object found in the paste.' };
  }
  const candidate = trimmed.slice(start, end + 1);
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` };
  }
  return validateImplementationReceipt(parsed, expectedActionId);
}
