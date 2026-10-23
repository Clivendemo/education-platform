/**
 * Search Query Sanitization, PII Redaction, and POSIX Regex Escaping Utilities
 * Milestone: Prompt 29 (Search Intelligence)
 */

/**
 * Escapes PostgreSQL POSIX regex metacharacters to prevent syntax errors
 * when interpolating user strings into `~* ('\\y' || $escaped)`.
 */
export function escapeRegexMetacharacters(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface SanitizedSearchResult {
  /** Cleaned, whitespace-collapsed string for query matching */
  sanitizedQuery: string;
  /** Sanitized, PII-redacted query for demand aggregation, or null if disqualified */
  normalizedQuery: string | null;
}

/**
 * Sanitizes search input, redacts PII (email, phone, long numbers),
 * and determines whether the query qualifies for search demand telemetry logging.
 *
 * Rules:
 * - Raw length < 2 or > 100 characters -> normalizedQuery is null
 * - Emails redacted to [EMAIL]
 * - Kenyan (+254..., 07..., 01...) and international phone numbers redacted to [PHONE]
 * - 13-19 digit account/ID/card numbers redacted to [NUMBER]
 * - Queries containing solely placeholders or fewer than 2 alphanumeric chars -> normalizedQuery is null
 */
export function sanitizeSearchQuery(rawQuery: string): SanitizedSearchResult {
  if (!rawQuery || typeof rawQuery !== 'string') {
    return { sanitizedQuery: '', normalizedQuery: null };
  }

  const trimmed = rawQuery.trim();
  const collapsed = trimmed.replace(/\s+/g, ' ');

  // Immediate length bounds disqualification for telemetry
  if (collapsed.length < 2 || collapsed.length > 100) {
    return {
      sanitizedQuery: collapsed.toLowerCase(),
      normalizedQuery: null,
    };
  }

  // PII Redaction
  // 1. Emails
  let redacted = collapsed.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi,
    '[EMAIL]',
  );

  // 2. Long number sequences (Credit card, national IDs, bank numbers: 13-19 digits)
  redacted = redacted.replace(/\b(?:\d[ -]*?){13,19}\b/g, '[NUMBER]');

  // 3. Kenyan mobile/landline and international phones
  redacted = redacted.replace(
    /(?:\+254|0)[17]\d{8}\b|\+?\d{1,4}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}\b/g,
    '[PHONE]',
  );

  // Clean whitespace in redacted text
  const cleanedText = redacted.replace(/\s+/g, ' ').trim().toLowerCase();

  // Test whether the query is only placeholders or symbols
  const withoutPlaceholders = cleanedText
    .replace(/\[email\]/g, '')
    .replace(/\[phone\]/g, '')
    .replace(/\[number\]/g, '')
    .replace(/[^a-z0-9]/g, '');

  if (withoutPlaceholders.length < 2) {
    return {
      sanitizedQuery: cleanedText,
      normalizedQuery: null,
    };
  }

  return {
    sanitizedQuery: cleanedText,
    normalizedQuery: cleanedText,
  };
}
