import { MpesaPhoneValidationError } from '../commerce.interface.js';

/**
 * Validates and normalizes Kenyan mobile phone numbers to Safaricom Daraja format.
 *
 * Supported user representations:
 * - Local 10-digit: 07XXXXXXXX or 01XXXXXXXX
 * - Local 9-digit: 7XXXXXXXX or 1XXXXXXXX
 * - International: 2547XXXXXXXX or 2541XXXXXXXX
 * - With plus: +2547XXXXXXXX or +2541XXXXXXXX
 * - With formatting: "0712 345 678", "+254 (712) 345-678"
 *
 * Output format:
 * - Exactly 12 digits: 2547XXXXXXXX or 2541XXXXXXXX
 *
 * Rejects:
 * - Landlines (e.g. 020XXXXXXX)
 * - Non-Kenyan numbers (e.g. +1..., +255...)
 * - Invalid prefixes (e.g. 08..., 09...)
 * - Short or excessive lengths
 */
export function normalizeMpesaPhoneNumber(rawPhone: string): string {
  if (!rawPhone || typeof rawPhone !== 'string') {
    throw new MpesaPhoneValidationError('Phone number is required');
  }

  // Strip all whitespace, hyphens, dots, parentheses, and leading plus
  const cleaned = rawPhone.replace(/[\s\-\.\(\)\+]/g, '').trim();

  let normalized = cleaned;

  // Handle +254 (0)7... or +254 01... where user included both 254 and leading 0
  if (/^2540[71]\d{8}$/.test(normalized)) {
    normalized = `254${normalized.slice(4)}`;
  }
  // Local 10 digits starting with 07 or 01: replace 0 with 254
  else if (/^0[71]\d{8}$/.test(normalized)) {
    normalized = `254${normalized.slice(1)}`;
  }
  // Local 9 digits starting with 7 or 1: prepend 254
  else if (/^[71]\d{8}$/.test(normalized)) {
    normalized = `254${normalized}`;
  }
  // Already in 254 format: keep if valid
  else if (/^254[71]\d{8}$/.test(normalized)) {
    // Already normalized
  } else {
    throw new MpesaPhoneValidationError(
      `Invalid Kenyan M-Pesa phone number "${rawPhone}". Must be a valid mobile number starting with 07, 01, or 254.`,
    );
  }

  // Final verification: exactly 12 digits starting with 254 followed by 7 or 1
  if (!/^254[71]\d{8}$/.test(normalized)) {
    throw new MpesaPhoneValidationError(
      `Invalid Kenyan M-Pesa phone number "${rawPhone}". Expected format 2547XXXXXXXX or 2541XXXXXXXX.`,
    );
  }

  return normalized;
}

/**
 * Returns true if the phone number can be successfully normalized to a valid Kenyan mobile number.
 */
export function isValidMpesaPhoneNumber(phone: string): boolean {
  try {
    normalizeMpesaPhoneNumber(phone);
    return true;
  } catch {
    return false;
  }
}
