import type { LoggerOptions } from 'pino';

export const REDACTED_LITERAL = '[REDACTED]';
export const REDACTED_PHONE_LITERAL = '[REDACTED_PHONE]';
export const MAX_REDACTION_DEPTH = 8;

export const AUDIT_CONTEXT_SOFT_TARGET_BYTES = 3800;
export const AUDIT_CONTEXT_HARD_MAX_BYTES = 4096;
export const ACTOR_SNAPSHOT_SOFT_TARGET_BYTES = 1900;
export const ACTOR_SNAPSHOT_HARD_MAX_BYTES = 2048;
export const AUDIT_STATE_SOFT_TARGET_BYTES = 16384;

const DANGEROUS_PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * Domain/governance keys that contain substrings like `token` or `code`
 * yet carry non-secret numeric/taxonomy metadata and must NOT be false-positive masked.
 */
const SAFE_KEY_ALLOWLIST_NORMALIZED = new Set([
  'tokencount',
  'millitokens',
  'maxtokens',
  'capacitymillitokens',
  'refilltokens',
  'countrycode',
  'currencycode',
  'policycode',
  'statuscode',
  'resultcode',
  'errorcode',
  'reasoncode',
  'providercode',
  'eventcode',
  'isocode',
]);

/**
 * Exact normalized key names (after stripping `_`, `-`, spaces and lowercasing)
 * that always represent credentials, tokens, secrets, or sensitive payment identifiers.
 */
const SENSITIVE_NORMALIZED_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'currentpassword',
  'newpassword',
  'passwordhash',
  'secret',
  'usersecret',
  'clientsecret',
  'webhooksecret',
  'csrfsecret',
  'csrfsecretprevious',
  'hmacsecret',
  'ratelimithmacsecret',
  'ratelimithmacsecretsecondary',
  'r2secretaccesskey',
  'mpesaconsumersecret',
  'mpesaconsumerkey',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'sessiontoken',
  'claimtoken',
  'csrf',
  'csrftoken',
  'csrfctx',
  'tokenhash',
  'authorization',
  'authheader',
  'cookie',
  'cookies',
  'setcookie',
  'apikey',
  'privatekey',
  'signature',
  'passkey',
  'mpesapasskey',
  'otp',
  'pin',
  'cvv',
  'mpesapassword',
  'securitycredential',
  'phonenumber',
  'msisdn',
  'mpesaphone',
  'initiatedphone',
  'initiatedphonehash',
  'checkoutrequestid',
  'merchantrequestid',
  'xcsrftoken',
  'xcalendarsession',
  'calendarsession',
  'rfsid',
  'elimusession',
  'elimuanonsid',
]);

/**
 * Substring tokens matched when a key is not in SAFE_KEY_ALLOWLIST_NORMALIZED.
 */
const SENSITIVE_SUBSTRINGS = [
  'password',
  'passwd',
  'secret',
  'token',
  'apikey',
  'privatekey',
  'passkey',
  'authorization',
  'cookie',
  'msisdn',
  'phonenumber',
  'checkoutrequestid',
];

const BEARER_OR_BASIC_REGEX = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const COOKIE_PAIR_REGEX =
  /\b(session_token|calendar_session|rf_sid|elimu_anon_sid|elimu_session|csrf_ctx)=([^;\s,&]+)/gi;
const URL_QUERY_SECRET_REGEX =
  /([?&](?:token|access_token|refresh_token|id_token|api_key|apikey|secret|password|signature|sig|X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)([^&#\s]+)/gi;
const POSTGRES_URI_CRED_REGEX = /\b(postgres(?:ql)?:\/\/)([^/\s@]+)@/gi;
const MSISDN_REGEX = /(?<![A-Za-z0-9])(?:\+?254|0)[17]\d{8}(?![A-Za-z0-9])/g;

export function normalizeKeyForRedaction(key: string): string {
  return key.replace(/[\s_-]+/g, '').toLowerCase();
}

export function isSensitiveKeyName(key: string): boolean {
  const normalized = normalizeKeyForRedaction(key);
  if (!normalized) return false;
  if (SAFE_KEY_ALLOWLIST_NORMALIZED.has(normalized)) {
    return false;
  }
  if (SENSITIVE_NORMALIZED_KEYS.has(normalized)) {
    return true;
  }
  return SENSITIVE_SUBSTRINGS.some((sub) => normalized.includes(sub));
}

/**
 * Normalizes arbitrary JS strings into PostgreSQL `jsonb`-safe UTF-8 strings:
 * - Replaces unpaired UTF-16 surrogates via `String.prototype.toWellFormed()`
 * - Strips NUL code points (`\u0000`) which PostgreSQL `jsonb` rejects with SQLSTATE `22P05`
 */
export function normalizePgJsonbString(raw: string): string {
  const toWellFormedFn = (raw as unknown as { toWellFormed?: () => string }).toWellFormed;
  const wellFormed =
    typeof toWellFormedFn === 'function'
      ? toWellFormedFn.call(raw)
      : raw.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
  return wellFormed.replace(/\u0000/g, '');
}

/**
 * Scrubs inline credential patterns (Bearer/Basic headers, session cookies, presigned URL params,
 * PostgreSQL URI credentials, and MSISDNs) from string values and enforces PG jsonb string hygiene.
 */
export function scrubSensitiveString(value: string): string {
  let clean = normalizePgJsonbString(value);
  clean = clean.replace(BEARER_OR_BASIC_REGEX, '$1 [REDACTED]');
  clean = clean.replace(COOKIE_PAIR_REGEX, '$1=[REDACTED]');
  clean = clean.replace(URL_QUERY_SECRET_REGEX, '$1[REDACTED]');
  clean = clean.replace(POSTGRES_URI_CRED_REGEX, '$1[REDACTED]@');
  clean = clean.replace(MSISDN_REGEX, REDACTED_PHONE_LITERAL);
  return clean;
}

/**
 *Truncates a UTF-8 string on clean Unicode code-point boundaries so its UTF-8 byte length
 * does not exceed `maxBytes` (including the suffix when truncated) and never introduces lone surrogates.
 */
export function truncateUtf8Safe(
  input: string,
  maxBytes: number,
  suffix: string = '...[truncated]',
): string {
  const normalized = normalizePgJsonbString(input);
  if (Buffer.byteLength(normalized, 'utf8') <= maxBytes) {
    return normalized;
  }
  const suffixBytes = Buffer.byteLength(suffix, 'utf8');
  if (maxBytes <= suffixBytes) {
    return suffix.slice(0, Math.max(0, maxBytes));
  }
  const budget = maxBytes - suffixBytes;
  let used = 0;
  let out = '';
  for (const codePointChar of normalized) {
    const charBytes = Buffer.byteLength(codePointChar, 'utf8');
    if (used + charBytes > budget) {
      break;
    }
    out += codePointChar;
    used += charBytes;
  }
  return out + suffix;
}

/**
 * Cycle-safe, prototype-safe, depth-bounded recursive normalizer & redactor.
 * - Replaces sensitive key values with `"[REDACTED]"` (preserving key names for audit forensics).
 * - Converts `BigInt`, `Date`, `Buffer`/`Uint8Array`, `Error`, `NaN`/`±Infinity`, and `-0` into normalized JSON values.
 */
export function normalizeAndRedactAuditValue(
  value: unknown,
  depth: number = 0,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (value === null) return null;

  const t = typeof value;
  if (t === 'boolean') return value;
  if (t === 'string') return scrubSensitiveString(value as string);
  if (t === 'bigint') return (value as bigint).toString();
  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) return null;
    if (Object.is(n, -0)) return 0;
    return n;
  }
  if (t === 'undefined' || t === 'function' || t === 'symbol') {
    return undefined;
  }

  if (typeof value === 'object') {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? '[InvalidDate]' : value.toISOString();
    }
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
      return `[Binary:${value.byteLength}B]`;
    }
    if (seen.has(value as object)) {
      return '[Circular]';
    }
    if (depth >= MAX_REDACTION_DEPTH) {
      return '[MaxDepthExceeded]';
    }

    seen.add(value as object);
    try {
      if (value instanceof Error) {
        const errRecord: Record<string, unknown> = {
          name: scrubSensitiveString(value.name || 'Error'),
          message: scrubSensitiveString(value.message || ''),
        };
        const maybeCode = (value as Error & { code?: unknown }).code;
        if (typeof maybeCode === 'string' || typeof maybeCode === 'number') {
          errRecord.code = typeof maybeCode === 'string' ? scrubSensitiveString(maybeCode) : maybeCode;
        }
        return errRecord;
      }

      if (Array.isArray(value)) {
        const outArr: unknown[] = [];
        for (const item of value) {
          const normItem = normalizeAndRedactAuditValue(item, depth + 1, seen);
          outArr.push(normItem === undefined ? null : normItem);
        }
        return outArr;
      }

      const outObj: Record<string, unknown> = {};
      for (const rawKey of Object.keys(value as Record<string, unknown>)) {
        if (DANGEROUS_PROTOTYPE_KEYS.has(rawKey)) {
          continue;
        }
        const safeKey = normalizePgJsonbString(rawKey);
        const propVal = (value as Record<string, unknown>)[rawKey];
        if (propVal === undefined || typeof propVal === 'function' || typeof propVal === 'symbol') {
          continue;
        }
        if (isSensitiveKeyName(safeKey)) {
          outObj[safeKey] = REDACTED_LITERAL;
          continue;
        }
        const normProp = normalizeAndRedactAuditValue(propVal, depth + 1, seen);
        if (normProp !== undefined) {
          outObj[safeKey] = normProp;
        }
      }
      return outObj;
    } finally {
      seen.delete(value as object);
    }
  }

  return String(value);
}

/**
 * Closed-form conservative upper bound on PostgreSQL `octet_length((v::jsonb)::text)`
 * over normalized JSON values:
 * - Accounts for PG `jsonb_out` `": "` (+2 bytes vs `:`) and `", "` (+2 bytes vs `,`) formatting.
 * - Accounts for PG `numeric_out` fixed-point expansion of IEEE-754 scientific-notation floats
 *   (e.g., `5e-324` is 6 bytes in JS `JSON.stringify` vs 326 bytes in PostgreSQL `jsonb::text`!).
 * - Guaranteed `>= octet_length((v::jsonb)::text)` for every normalized JSON value.
 */
export function estimatePgJsonbTextBytesUpperBound(value: unknown): number {
  if (value === null || value === true) return 4;
  if (value === false) return 5;

  if (typeof value === 'string') {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 4; // Serializes as `null`
    if (Object.is(value, -0) || value === 0) return 1;
    const s = String(value);
    if (!/[eE]/.test(s)) {
      return s.length;
    }
    const match = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
    if (!match) {
      return Buffer.byteLength(s, 'utf8') + 16;
    }
    const sign = match[1] ? 1 : 0;
    const intLen = match[2].length;
    const fracLen = (match[3] ?? '').length;
    const exp = Number.parseInt(match[4], 10);
    if (exp >= 0) {
      return sign + intLen + Math.max(exp, fracLen) + 1;
    }
    return sign + 2 + Math.abs(exp) + intLen + fracLen;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return 2; // "[]"
    let sum = 2 + 2 * (value.length - 1); // "[" + ", " * (n - 1) + "]"
    for (const el of value) {
      sum += estimatePgJsonbTextBytesUpperBound(el === undefined ? null : el);
    }
    return sum;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>);
    if (keys.length === 0) return 2; // "{}"
    let sum = 2 + 2 * (keys.length - 1); // "{" + ", " * (k - 1) + "}"
    for (const k of keys) {
      const v = (value as Record<string, unknown>)[k];
      sum +=
        Buffer.byteLength(JSON.stringify(k), 'utf8') +
        2 + // ": "
        estimatePgJsonbTextBytesUpperBound(v === undefined ? null : v);
    }
    return sum;
  }

  return Buffer.byteLength(JSON.stringify(String(value)), 'utf8');
}

function compactRecursiveStage1(value: unknown): unknown {
  if (typeof value === 'string') {
    return truncateUtf8Safe(value, 256);
  }
  if (Array.isArray(value)) {
    const maxItems = 16;
    if (value.length <= maxItems) {
      return value.map((item) => compactRecursiveStage1(item));
    }
    const head = value.slice(0, maxItems).map((item) => compactRecursiveStage1(item));
    head.push(`...[+${value.length - maxItems} items]`);
    return head;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      const safeKey = truncateUtf8Safe(key, 64, '...');
      out[safeKey] = compactRecursiveStage1((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

const CONTEXT_PRIORITY_CORE_KEYS = new Set([
  'reason',
  'denialreason',
  'errorcode',
  'failurecode',
  'outcome',
  'permission',
  'requestid',
  'targetid',
  'resourceid',
  'status',
  'policycode',
  '_truncated',
  '_originalestimatedbytes',
]);

/**
 * Sanitizes, normalizes, and deterministically compacts an audit `context` object so that:
 * 1. Sensitive keys/strings are recursively masked with `[REDACTED]`
 * 2. Estimated PostgreSQL `octet_length(context::text)` is `<= 3,800` soft target (`<= 4,096` hard DB CHECK)
 * 3. Never throws `AuditError` on oversized payloads
 */
export function sanitizeAndCompactAuditContext(
  context?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!context || typeof context !== 'object' || Array.isArray(context)) {
    return {};
  }

  const normalized = normalizeAndRedactAuditValue(context) as Record<string, unknown>;
  const initialEstimate = estimatePgJsonbTextBytesUpperBound(normalized);
  if (initialEstimate <= AUDIT_CONTEXT_SOFT_TARGET_BYTES) {
    return normalized;
  }

  // Stage 1: Truncate long strings (>256B) and long arrays (>16 items)
  const stage1 = compactRecursiveStage1(normalized) as Record<string, unknown>;
  stage1._truncated = true;
  stage1._originalEstimatedBytes = initialEstimate;

  if (estimatePgJsonbTextBytesUpperBound(stage1) <= AUDIT_CONTEXT_SOFT_TARGET_BYTES) {
    return stage1;
  }

  // Stage 2: Deterministically drop largest non-core keys first, then largest non-metadata keys
  const candidate = { ...stage1 };
  const removableEntries = Object.keys(candidate)
    .filter((k) => k !== '_truncated' && k !== '_originalEstimatedBytes')
    .map((k) => ({
      key: k,
      isCore: CONTEXT_PRIORITY_CORE_KEYS.has(normalizeKeyForRedaction(k)),
      bytes:
        Buffer.byteLength(JSON.stringify(k), 'utf8') +
        2 +
        estimatePgJsonbTextBytesUpperBound(candidate[k]),
    }))
    .sort((a, b) => {
      if (a.isCore !== b.isCore) return a.isCore ? 1 : -1;
      if (b.bytes !== a.bytes) return b.bytes - a.bytes;
      return a.key.localeCompare(b.key);
    });

  for (const entry of removableEntries) {
    if (estimatePgJsonbTextBytesUpperBound(candidate) <= AUDIT_CONTEXT_SOFT_TARGET_BYTES) {
      break;
    }
    delete candidate[entry.key];
  }

  if (estimatePgJsonbTextBytesUpperBound(candidate) <= AUDIT_CONTEXT_SOFT_TARGET_BYTES) {
    return candidate;
  }

  // Stage 3: Guaranteed small forensic terminal fallback (<< 4,096 hard ceiling)
  return {
    _truncated: true,
    _originalEstimatedBytes: initialEstimate,
    _reason: 'CONTEXT_COMPACTED',
  };
}

/**
 * Sanitizes, normalizes, and deterministically compacts an audit `actorSnapshot` so that
 * PostgreSQL `octet_length(actor_snapshot::text)` is strictly `<= 1,900` (`<= 2,048` hard DB CHECK).
 */
export function sanitizeAndCompactActorSnapshot<
  T extends {
    actorId?: string;
    actorType: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM';
    actorRole?: string;
    emailDomain?: string;
    displayName?: string;
  },
>(
  snapshot?: T | null,
): {
  actorId?: string;
  actorType: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM';
  actorRole?: string;
  emailDomain?: string;
  _truncated?: boolean;
  _originalEstimatedBytes?: number;
} {
  if (!snapshot || typeof snapshot !== 'object') {
    return { actorType: 'SYSTEM' };
  }

  const validActorType: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM' =
    snapshot.actorType === 'AUTHENTICATED' ||
    snapshot.actorType === 'ANONYMOUS' ||
    snapshot.actorType === 'SYSTEM'
      ? snapshot.actorType
      : 'SYSTEM';

  const normalized: {
    actorId?: string;
    actorType: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM';
    actorRole?: string;
    emailDomain?: string;
  } = {
    actorType: validActorType,
  };

  if (typeof snapshot.actorId === 'string') {
    normalized.actorId = scrubSensitiveString(snapshot.actorId);
  }
  if (typeof snapshot.actorRole === 'string') {
    normalized.actorRole = scrubSensitiveString(snapshot.actorRole);
  }
  if (typeof snapshot.emailDomain === 'string') {
    normalized.emailDomain = scrubSensitiveString(snapshot.emailDomain);
  }

  const initialEstimate = estimatePgJsonbTextBytesUpperBound(normalized);
  if (initialEstimate <= ACTOR_SNAPSHOT_SOFT_TARGET_BYTES) {
    return normalized;
  }

  const stage1: {
    actorId?: string;
    actorType: 'AUTHENTICATED' | 'ANONYMOUS' | 'SYSTEM';
    actorRole?: string;
    emailDomain?: string;
    _truncated: boolean;
    _originalEstimatedBytes: number;
  } = {
    actorType: validActorType,
    ...(normalized.actorId !== undefined
      ? { actorId: truncateUtf8Safe(normalized.actorId, 128) }
      : {}),
    ...(normalized.actorRole !== undefined
      ? { actorRole: truncateUtf8Safe(normalized.actorRole, 256) }
      : {}),
    ...(normalized.emailDomain !== undefined
      ? { emailDomain: truncateUtf8Safe(normalized.emailDomain, 128) }
      : {}),
    _truncated: true,
    _originalEstimatedBytes: initialEstimate,
  };

  if (estimatePgJsonbTextBytesUpperBound(stage1) <= ACTOR_SNAPSHOT_SOFT_TARGET_BYTES) {
    return stage1;
  }

  return {
    actorType: validActorType,
    ...(normalized.actorId !== undefined
      ? { actorId: truncateUtf8Safe(normalized.actorId, 64, '') }
      : {}),
    ...(normalized.actorRole !== undefined
      ? { actorRole: truncateUtf8Safe(normalized.actorRole, 64, '') }
      : {}),
    _truncated: true,
    _originalEstimatedBytes: initialEstimate,
  };
}

/**
 * Sanitizes and bounds `beforeState` / `afterState` audit snapshots (`<= 16,384` bytes).
 */
export function sanitizeAndBoundAuditState(
  state?: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (state === null || state === undefined) {
    return null;
  }
  if (typeof state !== 'object' || Array.isArray(state)) {
    return null;
  }
  const normalized = normalizeAndRedactAuditValue(state) as Record<string, unknown>;
  const estimate = estimatePgJsonbTextBytesUpperBound(normalized);
  if (estimate <= AUDIT_STATE_SOFT_TARGET_BYTES) {
    return normalized;
  }
  const compacted = compactRecursiveStage1(normalized) as Record<string, unknown>;
  compacted._truncated = true;
  compacted._originalEstimatedBytes = estimate;
  if (estimatePgJsonbTextBytesUpperBound(compacted) <= AUDIT_STATE_SOFT_TARGET_BYTES) {
    return compacted;
  }
  return {
    _truncated: true,
    _originalEstimatedBytes: estimate,
    _reason: 'STATE_COMPACTED',
  };
}

export const PINO_REDACT_PATHS: string[] = [
  'req.headers.cookie',
  'req.headers.authorization',
  'req.headers["x-csrf-token"]',
  'req.headers["x-calendar-session"]',
  'res.headers["set-cookie"]',
  'res.headers["x-csrf-token"]',
  '*.password',
  '*.currentPassword',
  '*.newPassword',
  '*.passwordHash',
  '*.secret',
  '*.userSecret',
  '*.clientSecret',
  '*.csrfSecret',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.sessionToken',
  '*.csrfToken',
  '*.claimToken',
  '*.token_hash',
  '*.tokenHash',
  '*.authorization',
  '*.cookie',
  '*.apiKey',
  '*.privateKey',
  '*.passkey',
  '*.checkoutRequestId',
  '*.merchantRequestId',
  '*.phoneNumber',
  '*.msisdn',
  '*.initiatedPhoneHash',
];

/**
 * Builds Pino logger configuration enforcing both fast path-based redaction and deep recursive
 * cycle-safe redaction across `logMethod` arguments, `req`, `res`, and `err` serializers.
 */
export function createRedactedLoggerOptions(
  level: string = 'info',
  existingOpts?: LoggerOptions | boolean,
): LoggerOptions | boolean {
  if (existingOpts === false) {
    return false;
  }

  const baseOpts: LoggerOptions =
    typeof existingOpts === 'object' && existingOpts !== null ? existingOpts : {};

  const mergedRedactPaths = Array.from(
    new Set([
      ...PINO_REDACT_PATHS,
      ...(Array.isArray(baseOpts.redact)
        ? baseOpts.redact
        : Array.isArray((baseOpts.redact as { paths?: string[] } | undefined)?.paths)
          ? (baseOpts.redact as { paths: string[] }).paths
          : []),
    ]),
  );

  return {
    ...baseOpts,
    level: baseOpts.level ?? level,
    redact: {
      paths: mergedRedactPaths,
      censor: REDACTED_LITERAL,
    },
    hooks: {
      ...baseOpts.hooks,
      logMethod(inputArgs, method, logLevel) {
        const sanitizedArgs = inputArgs.map((arg) => {
          if (typeof arg === 'string') {
            return scrubSensitiveString(arg);
          }
          if (arg && typeof arg === 'object') {
            return normalizeAndRedactAuditValue(arg);
          }
          return arg;
        }) as Parameters<typeof method>;

        if (baseOpts.hooks?.logMethod) {
          return baseOpts.hooks.logMethod.call(this, sanitizedArgs, method, logLevel);
        }
        return method.apply(this, sanitizedArgs);
      },
    },
    serializers: {
      ...baseOpts.serializers,
      req(req: any) {
        const safeUrl = typeof req?.url === 'string' ? scrubSensitiveString(req.url) : req?.url;
        return {
          method: req?.method,
          url: safeUrl,
          remoteAddress: req?.ip ?? req?.socket?.remoteAddress,
        };
      },
      res(res: any) {
        return {
          statusCode: res?.statusCode,
        };
      },
      err(err: any) {
        if (!err || typeof err !== 'object') return err;
        return {
          type: err.name || 'Error',
          message: typeof err.message === 'string' ? scrubSensitiveString(err.message) : '',
          code: err.code,
          statusCode: err.statusCode,
        };
      },
    },
  };
}
