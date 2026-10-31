import { CommerceError } from './commerce.interface.js';

export class MpesaAmountPrecisionError extends CommerceError {
  constructor(
    message = 'M-Pesa STK Push requires a positive whole-KES order amount (exact multiple of 100 minor units).',
  ) {
    super(message, 'MPESA_WHOLE_KES_REQUIRED', 400);
    this.name = 'MpesaAmountPrecisionError';
  }
}

const EXACT_KES_DECIMAL_REGEX = /^(?:0|[1-9]\d*)(?:\.(\d{1,2}))?$/;

/**
 * Exact string-only decimal parser converting KES major units (e.g. `"200"`, `"19.99"`, `"250.0"`)
 * into `bigint` minor units (`20000n`, `1999n`, `25000n`) with ZERO IEEE-754 floating-point math.
 *
 * - Strictly accepts `string` input only (never `number`, preventing upstream float precision loss).
 * - Rejects negative values, >2 fractional digits (e.g. `"19.999"`), scientific notation (`"1e2"`),
 *   empty strings, and malformed tokens by returning `null`.
 */
export function parseExactKesToMinor(rawDecimal: string): bigint | null {
  if (typeof rawDecimal !== 'string') {
    return null;
  }

  const trimmed = rawDecimal.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = EXACT_KES_DECIMAL_REGEX.exec(trimmed);
  if (!match) {
    return null;
  }

  const dotIdx = trimmed.indexOf('.');
  const wholeStr = dotIdx === -1 ? trimmed : trimmed.slice(0, dotIdx);
  const fracStr = dotIdx === -1 ? '00' : trimmed.slice(dotIdx + 1).padEnd(2, '0');

  return BigInt(wholeStr) * 100n + BigInt(fracStr);
}

/**
 * Verifies that a minor-unit KES `bigint` is a positive exact multiple of `100n` (whole KES)
 * suitable for Safaricom Daraja Lipa Na M-Pesa Online STK Push (`Amount` integer field).
 * Returns the whole-KES integer as `number` after verifying safe integer bounds.
 */
export function minorToExactWholeKesInt(amountMinor: bigint): number {
  if (typeof amountMinor !== 'bigint' || amountMinor < 100n || amountMinor % 100n !== 0n) {
    throw new MpesaAmountPrecisionError();
  }

  const wholeKes = amountMinor / 100n;
  if (wholeKes > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new MpesaAmountPrecisionError('Order amount exceeds maximum safe Daraja integer range.');
  }

  return Number(wholeKes);
}
