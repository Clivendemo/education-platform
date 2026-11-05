import type { AnalyticsEventInput, CheckoutOrderInput } from './types';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const IDEMPOTENCY_HEADER_NAME = 'Idempotency-Key';
export const IDEMPOTENCY_CONFLICT_ERROR_CODE = 'IDEMPOTENCY_ALREADY_CLAIMED';

export function createIdempotencyKey(): string {
  const key = globalThis.crypto.randomUUID().toLowerCase();
  if (!UUID_V4_REGEX.test(key)) {
    throw new Error('Generated idempotency key did not match RFC 4122 UUID v4 format');
  }
  return key;
}

export function assertValidIdempotencyKey(candidate: string): string {
  const normalized = candidate.trim().toLowerCase();
  if (!UUID_V4_REGEX.test(normalized)) {
    throw new Error('Idempotency key must be a valid RFC 4122 UUID v4');
  }
  return normalized;
}

export interface PreparedAnalyticsRequest {
  readonly path: '/analytics/events';
  readonly method: 'POST';
  readonly headers: Record<string, string>;
  readonly body: AnalyticsEventInput & { idempotencyKey: string };
}

/**
 * AC-04 Contract:
 * Analytics ingestion (`POST /api/v1/analytics/events`) carries `idempotencyKey` strictly inside
 * the JSON payload body and NEVER attaches an `Idempotency-Key` HTTP header.
 */
export function buildAnalyticsEventRequest(
  input: AnalyticsEventInput,
  explicitKey?: string,
  extraHeaders?: Record<string, string>,
): PreparedAnalyticsRequest {
  const idempotencyKey = explicitKey
    ? assertValidIdempotencyKey(explicitKey)
    : createIdempotencyKey();

  const sanitizedHeaders: Record<string, string> = {};
  if (extraHeaders) {
    for (const [headerName, headerValue] of Object.entries(extraHeaders)) {
      if (headerName.toLowerCase() === 'idempotency-key') {
        continue;
      }
      sanitizedHeaders[headerName] = headerValue;
    }
  }

  return {
    path: '/analytics/events',
    method: 'POST',
    headers: sanitizedHeaders,
    body: {
      ...input,
      idempotencyKey,
    },
  };
}

export interface PreparedCommerceCheckoutRequest {
  readonly path: '/checkout';
  readonly method: 'POST';
  readonly idempotencyKey: string;
  readonly headers: Record<string, string>;
  readonly body: CheckoutOrderInput & { idempotencyKey: string };
}

/**
 * AC-05 Contract:
 * Commerce checkout (`POST /api/v1/checkout`) synchronizes the exact same UUID v4 value across
 * both `Idempotency-Key` HTTP header and `body.idempotencyKey`.
 */
export function buildCommerceCheckoutRequest(
  input: CheckoutOrderInput,
  explicitKey?: string,
  extraHeaders?: Record<string, string>,
): PreparedCommerceCheckoutRequest {
  const idempotencyKey = explicitKey
    ? assertValidIdempotencyKey(explicitKey)
    : createIdempotencyKey();

  return {
    path: '/checkout',
    method: 'POST',
    idempotencyKey,
    headers: {
      ...(extraHeaders ?? {}),
      [IDEMPOTENCY_HEADER_NAME]: idempotencyKey,
    },
    body: {
      items: input.items,
      idempotencyKey,
    },
  };
}

export function isNonRetryableIdempotencyConflict(
  status: number,
  errorCode?: string | null,
): boolean {
  return status === 409 || errorCode === IDEMPOTENCY_CONFLICT_ERROR_CODE;
}
