import crypto from 'node:crypto';
import { Transform, type TransformCallback } from 'node:stream';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { env } from '../config/env.js';
import { getDatabasePool } from '../db/index.js';

export const EMPTY_BODY_SHA256_HEX =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const DEFAULT_TIER1_MAX_ENTRIES = 10_000;
export const DEFAULT_ADMISSION_BUDGET_MS = 250;
export const DEFAULT_POOL_WAITING_CIRCUIT_CAP = 4;
export const DEFAULT_MAX_ACTOR_CONCURRENCY_ENTRIES = 5_000;

export class RateLimitStoreUnavailableError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'SERVICE_UNAVAILABLE';
  constructor(
    message: string,
    public readonly reason: string = 'DB_RATE_LIMIT_UNAVAILABLE',
    public readonly isAmbiguousCommit: boolean = false,
  ) {
    super(message);
    this.name = 'RateLimitStoreUnavailableError';
  }
}

export class ConcurrencyBusyError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly retryAfterSeconds: number;
  constructor(
    message: string,
    options: { statusCode?: number; code?: string; retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'ConcurrencyBusyError';
    this.statusCode = options.statusCode ?? 503;
    this.code = options.code ?? 'SERVER_BUSY';
    this.retryAfterSeconds = options.retryAfterSeconds ?? 2;
  }
}

function isUnreservedRfc3986Byte(byte: number): boolean {
  return (
    (byte >= 0x41 && byte <= 0x5a) || // A-Z
    (byte >= 0x61 && byte <= 0x7a) || // a-z
    (byte >= 0x30 && byte <= 0x39) || // 0-9
    byte === 0x2d || // -
    byte === 0x2e || // .
    byte === 0x5f || // _
    byte === 0x7e // ~
  );
}

function isHexCharCode(code: number): boolean {
  return (
    (code >= 0x30 && code <= 0x39) ||
    (code >= 0x41 && code <= 0x46) ||
    (code >= 0x61 && code <= 0x66)
  );
}

function normalizeComponentEncoding(raw: string): string {
  let out = '';
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    const code = raw.charCodeAt(i);

    if (
      ch === '%' &&
      i + 2 < raw.length &&
      isHexCharCode(raw.charCodeAt(i + 1)) &&
      isHexCharCode(raw.charCodeAt(i + 2))
    ) {
      const hex = raw.slice(i + 1, i + 3);
      const byteVal = Number.parseInt(hex, 16);
      if (isUnreservedRfc3986Byte(byteVal)) {
        out += String.fromCharCode(byteVal);
      } else {
        out += `%${hex.toUpperCase()}`;
      }
      i += 3;
      continue;
    }

    if (ch === '%') {
      // Malformed percent sequence: escape literal '%' deterministically
      out += '%25';
      i += 1;
      continue;
    }

    if (code >= 0x21 && code <= 0x7e) {
      // Printable ASCII (including reserved delimiters like '/', ':', '+', '=', '&'): preserve literal
      out += ch;
      i += 1;
      continue;
    }

    // Space, control characters, or non-ASCII Unicode code point: encode UTF-8 bytes as uppercase %XX
    const cp = raw.codePointAt(i)!;
    const cpStr = String.fromCodePoint(cp);
    const toWellFormedFn = (cpStr as unknown as { toWellFormed?: () => string }).toWellFormed;
    const wellFormed =
      typeof toWellFormedFn === 'function' ? toWellFormedFn.call(cpStr) : cpStr;
    const utf8Buf = Buffer.from(wellFormed, 'utf8');
    for (const b of utf8Buf) {
      out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
    }
    i += cpStr.length;
  }
  return out;
}

/**
 * Deterministic Fastify-faithful request-target canonicalizer (`Correction A`, Rev 1.8/1.9):
 * - Preserves Fastify path distinctions (`//`, `/./`, trailing `/`, `%2F` vs `/`).
 * - Decodes ONLY RFC 3986 unreserved escapes (`A-Z`, `a-z`, `0-9`, `-`, `.`, `_`, `~`) and uppercases hex escapes.
 * - Drops empty `&` query segments while preserving bare keys (`?foo` != `?foo=`) and empty-key segments with `=` (`?=` / `?=1`).
 * - Stably sorts query parameters by canonical key name (preserving relative order of repeated keys).
 * - Unconditionally returns `${canonPath}?${canonQuery}` whenever `?` is present so `/path` != `/path?`.
 */
export function canonicalizeRequestTarget(rawUrl: string): string {
  const safeInput = typeof rawUrl === 'string' && rawUrl.length > 0 ? rawUrl : '/';
  const hashIdx = safeInput.indexOf('#');
  const withoutFragment = hashIdx >= 0 ? safeInput.slice(0, hashIdx) : safeInput;

  const qIdx = withoutFragment.indexOf('?');
  if (qIdx === -1) {
    const rawPath = withoutFragment.length > 0 ? withoutFragment : '/';
    return normalizeComponentEncoding(rawPath);
  }

  const rawPath = withoutFragment.slice(0, qIdx) || '/';
  const rawQuery = withoutFragment.slice(qIdx + 1);
  const canonPath = normalizeComponentEncoding(rawPath);

  const nonEmptySegments = rawQuery.split('&').filter((seg) => seg.length > 0);
  if (nonEmptySegments.length === 0) {
    return `${canonPath}?`;
  }

  const canonicalizedParams = nonEmptySegments.map((seg, originalIndex) => {
    const eqIdx = seg.indexOf('=');
    if (eqIdx === -1) {
      const canonKey = normalizeComponentEncoding(seg);
      return {
        canonKey,
        rendered: canonKey,
        originalIndex,
      };
    }
    const canonKey = normalizeComponentEncoding(seg.slice(0, eqIdx));
    const canonVal = normalizeComponentEncoding(seg.slice(eqIdx + 1));
    return {
      canonKey,
      rendered: `${canonKey}=${canonVal}`,
      originalIndex,
    };
  });

  canonicalizedParams.sort((a, b) => {
    if (a.canonKey < b.canonKey) return -1;
    if (a.canonKey > b.canonKey) return 1;
    return a.originalIndex - b.originalIndex;
  });

  const canonQuery = canonicalizedParams.map((p) => p.rendered).join('&');
  return `${canonPath}?${canonQuery}`;
}

/**
 * Single-pass streaming SHA-256 transform (`BodyHashingTransform`) used in Fastify `preParsing`.
 * Hashes raw request bytes on the fly and aborts oversized streams immediately before full buffering.
 */
export class BodyHashingTransform extends Transform {
  private readonly hash = crypto.createHash('sha256');
  private bytesSeen = 0;
  private digestHex: string | null = null;

  constructor(private readonly maxBytes: number) {
    super();
  }

  override _transform(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: TransformCallback,
  ): void {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    this.bytesSeen += buf.byteLength;
    if (this.bytesSeen > this.maxBytes) {
      const err = new Error(`Request payload exceeds maximum size of ${this.maxBytes} bytes.`) as Error & {
        statusCode?: number;
        code?: string;
      };
      err.statusCode = 413;
      err.code = 'PAYLOAD_TOO_LARGE';
      callback(err);
      return;
    }
    this.hash.update(buf);
    callback(null, buf);
  }

  override _flush(callback: TransformCallback): void {
    this.digestHex = this.bytesSeen === 0 ? EMPTY_BODY_SHA256_HEX : this.hash.digest('hex');
    callback();
  }

  getDigestHex(): string {
    if (this.digestHex === null) {
      this.digestHex = this.bytesSeen === 0 ? EMPTY_BODY_SHA256_HEX : this.hash.digest('hex');
    }
    return this.digestHex;
  }

  getBytesSeen(): number {
    return this.bytesSeen;
  }
}

export interface HmacSecretRing {
  activeSecret: string;
  secondarySecret?: string;
}

export function computePayloadFingerprints(
  params: {
    method: string;
    rawUrl: string;
    bodySha256Hex: string;
  },
  secrets: HmacSecretRing,
): { primary: string; secondary: string | null } {
  const canonTarget = canonicalizeRequestTarget(params.rawUrl);
  const message = `v1|${params.method.toUpperCase()}|${canonTarget}|${params.bodySha256Hex.toLowerCase()}`;
  const primary = crypto
    .createHmac('sha256', secrets.activeSecret)
    .update(message, 'utf8')
    .digest('hex');
  const secondary =
    secrets.secondarySecret && secrets.secondarySecret !== secrets.activeSecret
      ? crypto
          .createHmac('sha256', secrets.secondarySecret)
          .update(message, 'utf8')
          .digest('hex')
      : null;
  return { primary, secondary };
}

export function derivePrivacyBucketKey(
  policyId: string,
  dimension: string,
  rawIdentifier: string,
  hmacSecret: string = env.RATE_LIMIT_HMAC_SECRET,
): string {
  const safePolicy = policyId.trim().slice(0, 64);
  const safeDim = dimension.trim().slice(0, 24);
  const digest48 = crypto
    .createHmac('sha256', hmacSecret)
    .update(`${safePolicy}|${safeDim}|${rawIdentifier}`, 'utf8')
    .digest('hex')
    .slice(0, 48);
  return `${safePolicy}:${safeDim}:${digest48}`;
}

export function deriveScopedAdmissionKey(
  scopePrefix: string,
  actorScope: string,
  rawKeyMaterial: string,
  _unusedSecret?: string,
): string {
  const digest = crypto
    .createHash('sha256')
    .update(`adm|${scopePrefix}|${actorScope}|${rawKeyMaterial}`, 'utf8')
    .digest('hex');
  return `adm:${scopePrefix.slice(0, 48)}:${digest}`;
}

export interface BucketSpec {
  bucketKey: string;
  policyId: string;
  capacityMt: bigint;
  refillTokensMt: bigint;
  refillPeriodMs: bigint;
  costMt: bigint;
}

export interface Tier1PolicySpec {
  policyId: string;
  capacityMt: number;
  refillTokensMt: number;
  refillPeriodMs: number;
  costMt?: number;
}

export interface Tier1Decision {
  allowed: boolean;
  limitTokens: number;
  remainingTokens: number;
  retryAfterSeconds: number;
  resetAfterSeconds: number;
}

interface Tier1BucketEntry {
  millitokens: number;
  updatedAtMs: number;
  expiresAtMs: number;
}

/**
 * Bounded-LRU in-memory token bucket limiter (`maxEntries = 10,000`).
 * Enforces `expiresAtMs >= updatedAtMs + fullRefillDurationMs + 60_000` so idle eviction never resets depleted quotas early.
 */
export class Tier1MemoryRateLimiter {
  private readonly buckets = new Map<string, Tier1BucketEntry>();
  private readonly maxEntries: number;
  private readonly nowFn: () => number;

  constructor(options: { maxEntries?: number; nowFn?: () => number } = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_TIER1_MAX_ENTRIES;
    this.nowFn = options.nowFn ?? Date.now;
  }

  consume(key: string, spec: Tier1PolicySpec): Tier1Decision {
    const now = this.nowFn();
    const costMt = spec.costMt ?? 1000;
    const fullRefillSec = Math.ceil(
      (spec.capacityMt * spec.refillPeriodMs) / (spec.refillTokensMt * 1000),
    );
    const minTtlMs = (fullRefillSec + 60) * 1000;

    // Prune expired head entries
    let scanned = 0;
    for (const [k, entry] of this.buckets.entries()) {
      if (entry.expiresAtMs <= now) {
        this.buckets.delete(k);
      } else if (++scanned >= 8) {
        break;
      }
    }

    let entry = this.buckets.get(key);
    let refilledMt: number;
    let nextUpdatedAtMs: number;

    if (!entry || entry.expiresAtMs <= now) {
      if (entry) {
        this.buckets.delete(key);
      }
      refilledMt = spec.capacityMt;
      nextUpdatedAtMs = now;
    } else {
      const elapsedMs = Math.max(0, now - entry.updatedAtMs);
      const earnedMt = Math.floor((elapsedMs * spec.refillTokensMt) / spec.refillPeriodMs);
      refilledMt = Math.min(spec.capacityMt, entry.millitokens + earnedMt);
      if (refilledMt >= spec.capacityMt) {
        nextUpdatedAtMs = now;
      } else {
        const consumedMs = Math.ceil((earnedMt * spec.refillPeriodMs) / spec.refillTokensMt);
        nextUpdatedAtMs = Math.min(now, entry.updatedAtMs + consumedMs);
      }
    }

    const limitTokens = Math.max(1, Math.floor(spec.capacityMt / 1000));

    if (refilledMt < costMt) {
      // Preserve refill progress on rejection (zero state mutation, refresh LRU position only if existing)
      if (entry && entry.expiresAtMs > now) {
        this.buckets.delete(key);
        this.buckets.set(key, entry);
      }
      const deficitMt = costMt - refilledMt;
      const retryMs = Math.max(1, Math.ceil((deficitMt * spec.refillPeriodMs) / spec.refillTokensMt));
      const retryAfterSeconds = Math.max(1, Math.ceil(retryMs / 1000));
      return {
        allowed: false,
        limitTokens,
        remainingTokens: 0,
        retryAfterSeconds,
        resetAfterSeconds: retryAfterSeconds,
      };
    }

    const newMt = refilledMt - costMt;
    if (!this.buckets.has(key) && this.buckets.size >= this.maxEntries) {
      const oldestKey = this.buckets.keys().next().value;
      if (oldestKey !== undefined) {
        this.buckets.delete(oldestKey);
      }
    } else {
      this.buckets.delete(key);
    }

    this.buckets.set(key, {
      millitokens: newMt,
      updatedAtMs: nextUpdatedAtMs,
      expiresAtMs: now + minTtlMs,
    });

    const missingToFullMt = Math.max(0, spec.capacityMt - newMt);
    const resetMs =
      missingToFullMt === 0
        ? 0
        : Math.ceil((missingToFullMt * spec.refillPeriodMs) / spec.refillTokensMt);

    return {
      allowed: true,
      limitTokens,
      remainingTokens: Math.max(0, Math.floor(newMt / 1000)),
      retryAfterSeconds: 0,
      resetAfterSeconds: Math.max(1, Math.ceil(resetMs / 1000)),
    };
  }

  get size(): number {
    return this.buckets.size;
  }

  clear(): void {
    this.buckets.clear();
  }
}

export type Tx1AdmissionStatus =
  | 'NEW_UNCLAIMED'
  | 'EXISTING_UNCLAIMED'
  | 'ALREADY_CLAIMED'
  | 'CONFLICT_PAYLOAD'
  | 'RATE_LIMITED';

export interface Tx1ConsumeInput {
  buckets: BucketSpec[];
  admissionKey: string;
  claimToken: string;
  admissionTtlSecs: number;
  payloadFingerprint: string;
  secondaryPayloadFingerprint?: string | null;
}

export interface Tx1ConsumeResult {
  allowed: boolean;
  admissionStatus: Tx1AdmissionStatus;
  claimToken: string | null;
  limitingPolicyId: string | null;
  retryAfterMs: bigint;
  minRemainingMt: bigint;
}

export type Tx2ClaimStatus =
  | 'CLAIMED_WINNER'
  | 'ALREADY_CLAIMED'
  | 'TOKEN_MISMATCH'
  | 'EXPIRED_OR_MISSING';

export interface Tx2ClaimResult {
  claimed: boolean;
  claimStatus: Tx2ClaimStatus;
}

export interface RateLimitStore {
  consumeAndPrepareAdmission(input: Tx1ConsumeInput): Promise<Tx1ConsumeResult>;
  claimAdmission(admissionKey: string, claimToken: string): Promise<Tx2ClaimResult>;
  startReaper?(): void;
  stopReaper?(): void;
}

function validateTx1Parameters(input: Tx1ConsumeInput): void {
  const count = input.buckets.length;
  if (count < 1 || count > 8) {
    const err = new Error(`Invalid rate-limit bucket array dimensions (count=${count})`) as Error & {
      code?: string;
    };
    err.code = '22023';
    throw err;
  }
  if (
    !input.admissionKey ||
    input.admissionKey.trim().length < 16 ||
    input.admissionKey.length > 200
  ) {
    const err = new Error('Invalid p_admission_key bounds') as Error & { code?: string };
    err.code = '22023';
    throw err;
  }
  if (!input.claimToken) {
    const err = new Error('p_claim_token must not be NULL') as Error & { code?: string };
    err.code = '22023';
    throw err;
  }
  if (
    !Number.isInteger(input.admissionTtlSecs) ||
    input.admissionTtlSecs < 1 ||
    input.admissionTtlSecs > 604800
  ) {
    const err = new Error('Invalid p_admission_ttl_secs') as Error & { code?: string };
    err.code = '22023';
    throw err;
  }
  if (!input.payloadFingerprint || !/^[0-9a-f]{64}$/.test(input.payloadFingerprint)) {
    const err = new Error(
      'Invalid p_payload_fingerprint format (expected 64-char lowercase hex)',
    ) as Error & { code?: string };
    err.code = '22023';
    throw err;
  }
  if (
    input.secondaryPayloadFingerprint !== undefined &&
    input.secondaryPayloadFingerprint !== null &&
    !/^[0-9a-f]{64}$/.test(input.secondaryPayloadFingerprint)
  ) {
    const err = new Error(
      'Invalid p_secondary_payload_fingerprint format (expected 64-char lowercase hex)',
    ) as Error & {
      code?: string;
    };
    err.code = '22023';
    throw err;
  }

  for (let i = 0; i < count; i++) {
    const b = input.buckets[i];
    if (
      !b.bucketKey ||
      b.bucketKey.trim().length < 16 ||
      b.bucketKey.length > 160 ||
      b.capacityMt <= 0n ||
      b.capacityMt > 1_000_000_000n ||
      b.refillTokensMt <= 0n ||
      b.refillPeriodMs <= 0n ||
      b.costMt <= 0n ||
      b.costMt > b.capacityMt
    ) {
      const err = new Error(`Invalid per-bucket rate-limit parameter at index ${i + 1}`) as Error & {
        code?: string;
      };
      err.code = '22023';
      throw err;
    }
  }
}

function ceilDivBigInt(numerator: bigint, denominator: bigint): bigint {
  if (numerator <= 0n) return 0n;
  return (numerator + denominator - 1n) / denominator;
}

/**
 * Deterministic in-memory reference engine implementing the exact Migration 0024 `Tx1`/`Tx2`
 * semantics for standalone non-production environments when `DATABASE_URL` is unset and for protocol unit testing.
 */
export class InMemoryTwoPhaseRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<
    string,
    {
      policyId: string;
      millitokens: bigint;
      updatedAtMs: number;
      expiresAtMs: number;
    }
  >();

  private readonly admissions = new Map<
    string,
    {
      status: 'UNCLAIMED' | 'CLAIMED';
      claimToken: string;
      payloadFingerprint: string;
      createdAtMs: number;
      updatedAtMs: number;
      claimedAtMs: number | null;
      expiresAtMs: number;
    }
  >();

  private lockChain: Promise<void> = Promise.resolve();
  private readonly nowFn: () => number;

  constructor(options: { nowFn?: () => number } = {}) {
    this.nowFn = options.nowFn ?? Date.now;
  }

  private withSerialLock<T>(fn: () => T | Promise<T>): Promise<T> {
    const next = this.lockChain.then(fn, fn);
    this.lockChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async consumeAndPrepareAdmission(input: Tx1ConsumeInput): Promise<Tx1ConsumeResult> {
    validateTx1Parameters(input);

    return this.withSerialLock(() => {
      const now = this.nowFn();
      const existingAdm = this.admissions.get(input.admissionKey);

      if (existingAdm && existingAdm.expiresAtMs > now) {
        const matches =
          existingAdm.payloadFingerprint === input.payloadFingerprint ||
          (input.secondaryPayloadFingerprint !== undefined &&
            input.secondaryPayloadFingerprint !== null &&
            existingAdm.payloadFingerprint === input.secondaryPayloadFingerprint);

        if (!matches) {
          return {
            allowed: false,
            admissionStatus: 'CONFLICT_PAYLOAD',
            claimToken: null,
            limitingPolicyId: null,
            retryAfterMs: 0n,
            minRemainingMt: 0n,
          };
        }

        if (existingAdm.status === 'CLAIMED') {
          return {
            allowed: false,
            admissionStatus: 'ALREADY_CLAIMED',
            claimToken: null,
            limitingPolicyId: null,
            retryAfterMs: 0n,
            minRemainingMt: 0n,
          };
        }

        // EXISTING_UNCLAIMED recovery: rotate claimToken, re-tag payloadFingerprint to active secret, NEVER extend expiresAtMs
        existingAdm.claimToken = input.claimToken;
        existingAdm.payloadFingerprint = input.payloadFingerprint;
        existingAdm.updatedAtMs = now;
        return {
          allowed: true,
          admissionStatus: 'EXISTING_UNCLAIMED',
          claimToken: input.claimToken,
          limitingPolicyId: null,
          retryAfterMs: 0n,
          minRemainingMt: 0n,
        };
      }

      const computed = input.buckets.map((d, idx) => {
        const rawPrefix = d.bucketKey.split(':')[0]?.trim() ?? '';
        const policyId = (rawPrefix.length >= 3 ? rawPrefix : d.policyId || 'default_policy').slice(
          0,
          64,
        );
        const fullRefillSecs = ceilDivBigInt(
          d.capacityMt * d.refillPeriodMs,
          d.refillTokensMt * 1000n,
        );
        const effectiveTtlSec =
          BigInt(input.admissionTtlSecs) > fullRefillSecs + 60n
            ? BigInt(input.admissionTtlSecs)
            : fullRefillSecs + 60n;

        const r = this.buckets.get(d.bucketKey);
        let refilledMt: bigint;
        let nextUpdatedAtMs: number;

        if (!r || r.expiresAtMs <= now) {
          refilledMt = d.capacityMt;
          nextUpdatedAtMs = now;
        } else {
          const elapsedMs = BigInt(Math.max(0, now - r.updatedAtMs));
          const earnedMt = (elapsedMs * d.refillTokensMt) / d.refillPeriodMs;
          const candidateMt = r.millitokens + earnedMt;
          refilledMt = candidateMt < d.capacityMt ? candidateMt : d.capacityMt;
          if (refilledMt >= d.capacityMt) {
            nextUpdatedAtMs = now;
          } else {
            const consumedMs = Number(ceilDivBigInt(earnedMt * d.refillPeriodMs, d.refillTokensMt));
            nextUpdatedAtMs = Math.min(now, r.updatedAtMs + consumedMs);
          }
        }

        const deficitMt = refilledMt < d.costMt ? d.costMt - refilledMt : 0n;
        const retryMs =
          deficitMt > 0n
            ? ceilDivBigInt(deficitMt * d.refillPeriodMs, d.refillTokensMt) || 1n
            : 0n;

        return {
          idx,
          bucketKey: d.bucketKey,
          policyId,
          costMt: d.costMt,
          effectiveTtlSec,
          refilledMt,
          nextUpdatedAtMs,
          retryMs,
        };
      });

      const failed = computed.filter((c) => c.refilledMt < c.costMt);
      if (failed.length > 0) {
        failed.sort((a, b) => {
          if (b.retryMs > a.retryMs) return 1;
          if (b.retryMs < a.retryMs) return -1;
          return a.idx - b.idx;
        });
        const maxRetryMs = failed.reduce((acc, f) => (f.retryMs > acc ? f.retryMs : acc), 0n);
        return {
          allowed: false,
          admissionStatus: 'RATE_LIMITED',
          claimToken: null,
          limitingPolicyId: failed[0].policyId,
          retryAfterMs: maxRetryMs,
          minRemainingMt: 0n,
        };
      }

      let minRemMt: bigint | null = null;
      for (const c of computed) {
        const rem = c.refilledMt - c.costMt;
        if (minRemMt === null || rem < minRemMt) {
          minRemMt = rem;
        }
        this.buckets.set(c.bucketKey, {
          policyId: c.policyId,
          millitokens: rem,
          updatedAtMs: c.nextUpdatedAtMs,
          expiresAtMs: now + Number(c.effectiveTtlSec) * 1000,
        });
      }

      this.admissions.set(input.admissionKey, {
        status: 'UNCLAIMED',
        claimToken: input.claimToken,
        payloadFingerprint: input.payloadFingerprint,
        createdAtMs: now,
        updatedAtMs: now,
        claimedAtMs: null,
        expiresAtMs: now + input.admissionTtlSecs * 1000,
      });

      return {
        allowed: true,
        admissionStatus: 'NEW_UNCLAIMED',
        claimToken: input.claimToken,
        limitingPolicyId: null,
        retryAfterMs: 0n,
        minRemainingMt: minRemMt ?? 0n,
      };
    });
  }

  async claimAdmission(admissionKey: string, claimToken: string): Promise<Tx2ClaimResult> {
    if (!admissionKey || admissionKey.trim().length < 16 || admissionKey.length > 200) {
      const err = new Error('Invalid p_admission_key bounds') as Error & { code?: string };
      err.code = '22023';
      throw err;
    }
    if (!claimToken) {
      const err = new Error('p_claim_token must not be NULL') as Error & { code?: string };
      err.code = '22023';
      throw err;
    }

    return this.withSerialLock(() => {
      const now = this.nowFn();
      const row = this.admissions.get(admissionKey);
      if (!row || row.expiresAtMs <= now) {
        return { claimed: false, claimStatus: 'EXPIRED_OR_MISSING' };
      }
      if (row.status === 'CLAIMED') {
        return { claimed: false, claimStatus: 'ALREADY_CLAIMED' };
      }
      if (row.claimToken !== claimToken) {
        return { claimed: false, claimStatus: 'TOKEN_MISMATCH' };
      }
      row.status = 'CLAIMED';
      row.claimedAtMs = now;
      row.updatedAtMs = now;
      return { claimed: true, claimStatus: 'CLAIMED_WINNER' };
    });
  }

  inspectAdmissionForTest(admissionKey: string) {
    const row = this.admissions.get(admissionKey);
    return row ? { ...row } : null;
  }

  inspectBucketForTest(bucketKey: string) {
    const row = this.buckets.get(bucketKey);
    return row ? { ...row } : null;
  }
}

export interface PostgresRateLimitStoreOptions {
  pool?: pg.Pool;
  admissionBudgetMs?: number;
  maxWaitingClients?: number;
  reaperIntervalMs?: number;
  nowFn?: () => number;
}

function withBoundedPromise<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeoutError: () => Error,
): Promise<T> {
  if (timeoutMs <= 0) {
    return Promise.reject(onTimeoutError());
  }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(onTimeoutError());
    }, timeoutMs);
    timer.unref?.();

    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Production PostgreSQL rate-limit store executing two-phase `Tx1` (`consume_rate_limit_buckets`)
 * and `Tx2` (`claim_rate_limit_admission`) within a strict `250ms` deadline, bounded pool checkout
 * with late-callback release, and fail-closed handling of ambiguous `COMMIT` acknowledgements.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  private readonly explicitPool?: pg.Pool;
  private readonly admissionBudgetMs: number;
  private readonly maxWaitingClients: number;
  private readonly reaperIntervalMs: number;
  private readonly nowFn: () => number;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: PostgresRateLimitStoreOptions = {}) {
    this.explicitPool = options.pool;
    this.admissionBudgetMs = options.admissionBudgetMs ?? DEFAULT_ADMISSION_BUDGET_MS;
    this.maxWaitingClients = options.maxWaitingClients ?? DEFAULT_POOL_WAITING_CIRCUIT_CAP;
    this.reaperIntervalMs = options.reaperIntervalMs ?? 60_000;
    this.nowFn = options.nowFn ?? Date.now;
  }

  private resolvePool(): pg.Pool {
    if (this.explicitPool) {
      return this.explicitPool;
    }
    return getDatabasePool();
  }

  private async checkoutClientBounded(deadlineAt: number): Promise<pg.PoolClient> {
    let pool: pg.Pool;
    try {
      pool = this.resolvePool();
    } catch (err) {
      throw new RateLimitStoreUnavailableError(
        (err as Error).message || 'Database pool unavailable',
        'POOL_UNAVAILABLE',
      );
    }

    if (typeof pool.waitingCount === 'number' && pool.waitingCount >= this.maxWaitingClients) {
      throw new RateLimitStoreUnavailableError(
        `Database pool saturated (waitingCount=${pool.waitingCount})`,
        'POOL_SATURATED',
      );
    }

    const remainingMs = deadlineAt - this.nowFn();
    if (remainingMs <= 10) {
      throw new RateLimitStoreUnavailableError(
        'Rate-limit admission deadline exhausted before checkout',
        'DEADLINE_EXCEEDED_PRE_CHECKOUT',
      );
    }

    let timedOut = false;
    const rawConnectPromise = pool.connect();

    // Late-callback safeguard: if pool.connect resolves after local timeout, release immediately!
    rawConnectPromise.then(
      (client) => {
        if (timedOut) {
          try {
            client.release();
          } catch {
            // Ignore secondary release error
          }
        }
      },
      () => {
        // Handled by caller if before timeout; ignored if after timeout
      },
    );

    try {
      return await withBoundedPromise(rawConnectPromise, Math.min(remainingMs, 150), () => {
        timedOut = true;
        return new RateLimitStoreUnavailableError(
          'Timed out checking out PostgreSQL client for rate limiting',
          'POOL_CHECKOUT_TIMEOUT',
        );
      });
    } catch (err) {
      if (err instanceof RateLimitStoreUnavailableError) {
        throw err;
      }
      throw new RateLimitStoreUnavailableError(
        `Failed to checkout PostgreSQL client: ${(err as Error).message}`,
        'POOL_CONNECT_ERROR',
      );
    }
  }

  private async safeRollbackAndRelease(client: pg.PoolClient): Promise<void> {
    try {
      await withBoundedPromise(
        client.query('ROLLBACK'),
        100,
        () => new Error('ROLLBACK_TIMEOUT'),
      );
      client.release();
    } catch (rbErr) {
      try {
        client.release(rbErr instanceof Error ? rbErr : new Error('ROLLBACK_FAILED'));
      } catch {
        // Ignore release error on destroyed socket
      }
    }
  }

  async consumeAndPrepareAdmission(input: Tx1ConsumeInput): Promise<Tx1ConsumeResult> {
    validateTx1Parameters(input);

    const deadlineAt = this.nowFn() + this.admissionBudgetMs;
    const client = await this.checkoutClientBounded(deadlineAt);
    let released = false;

    try {
      const preQueryBudgetMs = Math.max(40, Math.min(180, deadlineAt - this.nowFn()));
      const lockTimeoutMs = Math.max(25, Math.min(120, preQueryBudgetMs - 10));

      await withBoundedPromise(
        client.query(
          `BEGIN; SET LOCAL lock_timeout = '${lockTimeoutMs}ms'; SET LOCAL statement_timeout = '${preQueryBudgetMs}ms';`,
        ),
        preQueryBudgetMs,
        () =>
          new RateLimitStoreUnavailableError(
            'Timed out initializing Tx1 rate-limit transaction',
            'TX1_BEGIN_TIMEOUT',
          ),
      );

      const queryRemainingMs = deadlineAt - this.nowFn();
      if (queryRemainingMs <= 15) {
        released = true;
        await this.safeRollbackAndRelease(client);
        throw new RateLimitStoreUnavailableError(
          'Rate-limit budget exhausted prior to Tx1 query',
          'TX1_PRE_QUERY_DEADLINE',
        );
      }

      const res = await withBoundedPromise(
        client.query(
          `SELECT
             allowed,
             admission_status,
             claim_token,
             limiting_policy_id,
             retry_after_ms,
             min_remaining_mt
           FROM "system"."consume_rate_limit_buckets"(
             $1::text[],
             $2::bigint[],
             $3::bigint[],
             $4::bigint[],
             $5::bigint[],
             $6::text,
             $7::uuid,
             $8::int,
             $9::varchar(64),
             $10::varchar(64)
           )`,
          [
            input.buckets.map((b) => b.bucketKey),
            input.buckets.map((b) => b.capacityMt.toString()),
            input.buckets.map((b) => b.refillTokensMt.toString()),
            input.buckets.map((b) => b.refillPeriodMs.toString()),
            input.buckets.map((b) => b.costMt.toString()),
            input.admissionKey,
            input.claimToken,
            input.admissionTtlSecs,
            input.payloadFingerprint,
            input.secondaryPayloadFingerprint ?? null,
          ],
        ),
        queryRemainingMs,
        () =>
          new RateLimitStoreUnavailableError(
            'Timed out executing system.consume_rate_limit_buckets',
            'TX1_QUERY_TIMEOUT',
          ),
      );

      // Verify budget BEFORE sending COMMIT over the wire
      const preCommitRemainingMs = deadlineAt - this.nowFn();
      if (preCommitRemainingMs <= 0) {
        released = true;
        await this.safeRollbackAndRelease(client);
        throw new RateLimitStoreUnavailableError(
          'Rate-limit budget exceeded before Tx1 COMMIT; rolled back cleanly',
          'TX1_DEADLINE_BEFORE_COMMIT',
        );
      }

      // Once COMMIT is sent, any error or timeout leaves COMMIT outcome ambiguous -> destroy client & fail closed
      try {
        await withBoundedPromise(
          client.query('COMMIT'),
          Math.max(75, preCommitRemainingMs),
          () => new Error('TX1_COMMIT_ACK_TIMEOUT'),
        );
      } catch (commitErr) {
        released = true;
        try {
          client.release(commitErr instanceof Error ? commitErr : new Error('TX1_COMMIT_FAILED'));
        } catch {
          // Ignore
        }
        throw new RateLimitStoreUnavailableError(
          `Ambiguous Tx1 COMMIT acknowledgement: ${(commitErr as Error).message}`,
          'TX1_AMBIGUOUS_COMMIT',
          true,
        );
      }

      const row = res.rows[0] as {
        allowed: boolean;
        admission_status: Tx1AdmissionStatus;
        claim_token: string | null;
        limiting_policy_id: string | null;
        retry_after_ms: string | number;
        min_remaining_mt: string | number;
      };

      return {
        allowed: Boolean(row.allowed),
        admissionStatus: row.admission_status,
        claimToken: row.claim_token ?? null,
        limitingPolicyId: row.limiting_policy_id ?? null,
        retryAfterMs: BigInt(row.retry_after_ms ?? 0),
        minRemainingMt: BigInt(row.min_remaining_mt ?? 0),
      };
    } catch (err) {
      if ((err as { code?: string })?.code === '22023') {
        if (!released) {
          released = true;
          await this.safeRollbackAndRelease(client);
        }
        throw err;
      }
      if (!released) {
        released = true;
        await this.safeRollbackAndRelease(client);
      }
      if (err instanceof RateLimitStoreUnavailableError) {
        throw err;
      }
      throw new RateLimitStoreUnavailableError(
        `Rate-limit Tx1 execution error: ${(err as Error).message}`,
        'TX1_EXECUTION_ERROR',
      );
    } finally {
      if (!released) {
        try {
          client.release();
        } catch {
          // Ignore
        }
      }
    }
  }

  async claimAdmission(admissionKey: string, claimToken: string): Promise<Tx2ClaimResult> {
    const deadlineAt = this.nowFn() + Math.min(this.admissionBudgetMs, 200);
    const client = await this.checkoutClientBounded(deadlineAt);
    let released = false;

    try {
      await withBoundedPromise(
        client.query(`BEGIN; SET LOCAL lock_timeout = '100ms'; SET LOCAL statement_timeout = '150ms';`),
        120,
        () =>
          new RateLimitStoreUnavailableError(
            'Timed out initializing Tx2 admission claim',
            'TX2_BEGIN_TIMEOUT',
          ),
      );

      const res = await withBoundedPromise(
        client.query(
          `SELECT claimed, claim_status FROM "system"."claim_rate_limit_admission"($1::text, $2::uuid)`,
          [admissionKey, claimToken],
        ),
        Math.max(40, deadlineAt - this.nowFn()),
        () =>
          new RateLimitStoreUnavailableError(
            'Timed out executing system.claim_rate_limit_admission',
            'TX2_QUERY_TIMEOUT',
          ),
      );

      const preCommitRemainingMs = deadlineAt - this.nowFn();
      if (preCommitRemainingMs <= 0) {
        released = true;
        await this.safeRollbackAndRelease(client);
        throw new RateLimitStoreUnavailableError(
          'Admission claim deadline exceeded before Tx2 COMMIT; rolled back leaving UNCLAIMED',
          'TX2_DEADLINE_BEFORE_COMMIT',
        );
      }

      try {
        await withBoundedPromise(
          client.query('COMMIT'),
          Math.max(75, preCommitRemainingMs),
          () => new Error('TX2_COMMIT_ACK_TIMEOUT'),
        );
      } catch (commitErr) {
        released = true;
        try {
          client.release(commitErr instanceof Error ? commitErr : new Error('TX2_COMMIT_FAILED'));
        } catch {
          // Ignore
        }
        throw new RateLimitStoreUnavailableError(
          `Ambiguous Tx2 claim COMMIT acknowledgement: ${(commitErr as Error).message}`,
          'TX2_AMBIGUOUS_COMMIT',
          true,
        );
      }

      const row = res.rows[0] as { claimed: boolean; claim_status: Tx2ClaimStatus } | undefined;
      if (!row) {
        return { claimed: false, claimStatus: 'EXPIRED_OR_MISSING' };
      }

      return {
        claimed: Boolean(row.claimed && row.claim_status === 'CLAIMED_WINNER'),
        claimStatus: row.claim_status,
      };
    } catch (err) {
      if ((err as { code?: string })?.code === '22023') {
        if (!released) {
          released = true;
          await this.safeRollbackAndRelease(client);
        }
        throw err;
      }
      if (!released) {
        released = true;
        await this.safeRollbackAndRelease(client);
      }
      if (err instanceof RateLimitStoreUnavailableError) {
        throw err;
      }
      throw new RateLimitStoreUnavailableError(
        `Rate-limit Tx2 claim error: ${(err as Error).message}`,
        'TX2_EXECUTION_ERROR',
      );
    } finally {
      if (!released) {
        try {
          client.release();
        } catch {
          // Ignore
        }
      }
    }
  }

  async reapExpiredRowsOnce(): Promise<void> {
    if (!this.explicitPool && !env.DATABASE_URL) {
      return;
    }
    try {
      const pool = this.resolvePool();
      await pool.query(`
        DELETE FROM "system"."rate_limit_buckets"
        WHERE "id" IN (
          SELECT "id" FROM "system"."rate_limit_buckets"
          WHERE "expires_at" <= clock_timestamp()
          ORDER BY "expires_at" ASC
          LIMIT 500
          FOR UPDATE SKIP LOCKED
        );
      `);
      await pool.query(`
        DELETE FROM "system"."rate_limit_admissions"
        WHERE "id" IN (
          SELECT "id" FROM "system"."rate_limit_admissions"
          WHERE "expires_at" <= clock_timestamp()
          ORDER BY "expires_at" ASC
          LIMIT 500
          FOR UPDATE SKIP LOCKED
        );
      `);
    } catch {
      // Opportunistic non-blocking background cleanup; never crash request loop
    }
  }

  startReaper(): void {
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(() => {
      void this.reapExpiredRowsOnce();
    }, this.reaperIntervalMs);
    this.reaperTimer.unref?.();
  }

  stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }
}

export interface RateLimitServiceOptions {
  tier1?: Tier1MemoryRateLimiter;
  tier2Store?: RateLimitStore;
  hmacSecret?: string;
  secondaryHmacSecret?: string;
  nodeEnv?: 'development' | 'test' | 'production';
}

export class RateLimitService {
  public readonly tier1: Tier1MemoryRateLimiter;
  public readonly tier2Store: RateLimitStore;
  private activeHmacSecret: string;
  private secondaryHmacSecret?: string;

  constructor(options: RateLimitServiceOptions = {}) {
    this.tier1 = options.tier1 ?? new Tier1MemoryRateLimiter();
    const effectiveEnv = options.nodeEnv ?? env.NODE_ENV;

    if (options.tier2Store) {
      this.tier2Store = options.tier2Store;
    } else if (effectiveEnv === 'production' || Boolean(env.DATABASE_URL)) {
      this.tier2Store = new PostgresRateLimitStore();
    } else {
      this.tier2Store = new InMemoryTwoPhaseRateLimitStore();
    }

    this.activeHmacSecret = options.hmacSecret ?? env.RATE_LIMIT_HMAC_SECRET;
    this.secondaryHmacSecret =
      options.secondaryHmacSecret !== undefined
        ? options.secondaryHmacSecret
        : env.RATE_LIMIT_HMAC_SECRET_SECONDARY;
  }

  getSecrets(): HmacSecretRing {
    return {
      activeSecret: this.activeHmacSecret,
      secondarySecret: this.secondaryHmacSecret,
    };
  }

  setSecretsForRotation(activeSecret: string, secondarySecret?: string): void {
    this.activeHmacSecret = activeSecret;
    this.secondaryHmacSecret = secondarySecret;
  }

  startBackgroundMaintenance(): void {
    this.tier2Store.startReaper?.();
  }

  stopBackgroundMaintenance(): void {
    this.tier2Store.stopReaper?.();
  }
}

export type ConcurrencyPoolId =
  | 'auth_argon2'
  | 'calendar_pdf_export'
  | 'commerce_payment_initiate'
  | 'admin_file_verify'
  | 'db_heavy_compute';

export interface ConcurrencyPoolPolicy {
  poolId: ConcurrencyPoolId;
  maxConcurrent: number;
  perActorMax?: number;
  maxQueueSize: number;
  queueWaitTimeoutMs: number;
  operationTimeoutMs: number;
  abortOnClientDisconnect: boolean;
}

export interface PermitHandle {
  readonly poolId: ConcurrencyPoolId;
  release(): void;
}

interface QueuedWaiter {
  actorKey?: string;
  grant: (handle: PermitHandle) => void;
  reject: (err: Error) => void;
  cleanup: () => void;
}

interface PoolState {
  policy: ConcurrencyPoolPolicy;
  activePermits: number;
  actorMap: Map<string, { active: number }>;
  waitQueue: QueuedWaiter[];
}

function attachClientDisconnectListener(
  request: Pick<FastifyRequest, 'raw'> | undefined,
  reply: Pick<FastifyReply, 'raw' | 'sent'> | undefined,
  onDisconnect: () => void,
): () => void {
  if (!request?.raw && !reply?.raw) {
    return () => {};
  }

  let fired = false;
  const triggerOnce = () => {
    if (fired) return;
    fired = true;
    onDisconnect();
  };

  // 1. Node.js IncomingMessage 'aborted' fires when client aborts before request stream finishes
  const onReqAborted = () => {
    triggerOnce();
  };

  // 2. Node.js ServerResponse 'close' BEFORE writableEnded fires when peer socket disconnects mid-response!
  //    (Never rely on request.raw 'close' alone because Node 16+ emits IncomingMessage 'close' on normal EOF.)
  const onResClose = () => {
    const resRaw = reply?.raw as
      | { writableEnded?: boolean; writableFinished?: boolean }
      | undefined;
    if (!reply?.sent && !resRaw?.writableEnded && !resRaw?.writableFinished) {
      triggerOnce();
    }
  };

  request?.raw?.once?.('aborted', onReqAborted);
  reply?.raw?.once?.('close', onResClose);

  return () => {
    request?.raw?.removeListener?.('aborted', onReqAborted);
    reply?.raw?.removeListener?.('close', onResClose);
  };
}

/**
 * Heavy-endpoint semaphore & per-actor concurrency registry (`WP4 §4`).
 * - Holds permits strictly inside `try { await fn(signal) } finally { permit.release() }`.
 * - Never releases an active permit on socket disconnect or timeout; aborts `AbortController` only when safe.
 */
export class BoundedConcurrencyRegistry {
  private readonly pools = new Map<ConcurrencyPoolId, PoolState>();
  private readonly maxActorEntries: number;

  constructor(
    options: {
      policies?: Partial<Record<ConcurrencyPoolId, Partial<ConcurrencyPoolPolicy>>>;
      maxActorEntries?: number;
    } = {},
  ) {
    this.maxActorEntries = options.maxActorEntries ?? DEFAULT_MAX_ACTOR_CONCURRENCY_ENTRIES;

    const defaults: Record<ConcurrencyPoolId, ConcurrencyPoolPolicy> = {
      auth_argon2: {
        poolId: 'auth_argon2',
        maxConcurrent: env.CONCURRENCY_MAX_AUTH_ARGON2,
        maxQueueSize: 16,
        queueWaitTimeoutMs: 1500,
        operationTimeoutMs: 5000,
        abortOnClientDisconnect: false,
      },
      calendar_pdf_export: {
        poolId: 'calendar_pdf_export',
        maxConcurrent: env.CONCURRENCY_MAX_CALENDAR_EXPORT,
        perActorMax: 1,
        maxQueueSize: 6,
        queueWaitTimeoutMs: 2000,
        operationTimeoutMs: 15000,
        abortOnClientDisconnect: true,
      },
      commerce_payment_initiate: {
        poolId: 'commerce_payment_initiate',
        maxConcurrent: env.CONCURRENCY_MAX_PAYMENT_INITIATE,
        perActorMax: 1,
        maxQueueSize: 8,
        queueWaitTimeoutMs: 2000,
        operationTimeoutMs: 10000,
        abortOnClientDisconnect: false,
      },
      admin_file_verify: {
        poolId: 'admin_file_verify',
        maxConcurrent: env.CONCURRENCY_MAX_ADMIN_FILE_VERIFY,
        perActorMax: 1,
        maxQueueSize: 4,
        queueWaitTimeoutMs: 1500,
        operationTimeoutMs: 10000,
        abortOnClientDisconnect: true,
      },
      db_heavy_compute: {
        poolId: 'db_heavy_compute',
        maxConcurrent: env.CONCURRENCY_MAX_DB_HEAVY,
        maxQueueSize: 6,
        queueWaitTimeoutMs: 1000,
        operationTimeoutMs: 4000,
        abortOnClientDisconnect: false,
      },
    };

    for (const poolId of Object.keys(defaults) as ConcurrencyPoolId[]) {
      const merged: ConcurrencyPoolPolicy = {
        ...defaults[poolId],
        ...(options.policies?.[poolId] ?? {}),
        poolId,
      };
      this.pools.set(poolId, {
        policy: merged,
        activePermits: 0,
        actorMap: new Map(),
        waitQueue: [],
      });
    }
  }

  getPoolSnapshot(poolId: ConcurrencyPoolId): {
    activePermits: number;
    availablePermits: number;
    queuedWaiters: number;
    actorMapSize: number;
    maxConcurrent: number;
  } {
    const state = this.pools.get(poolId);
    if (!state) {
      throw new Error(`Unknown concurrency pool "${poolId}"`);
    }
    return {
      activePermits: state.activePermits,
      availablePermits: Math.max(0, state.policy.maxConcurrent - state.activePermits),
      queuedWaiters: state.waitQueue.length,
      actorMapSize: state.actorMap.size,
      maxConcurrent: state.policy.maxConcurrent,
    };
  }

  private canGrantNow(state: PoolState, actorKey?: string): boolean {
    if (state.activePermits >= state.policy.maxConcurrent) {
      return false;
    }
    if (actorKey && state.policy.perActorMax !== undefined) {
      const actorEntry = state.actorMap.get(actorKey);
      if (actorEntry && actorEntry.active >= state.policy.perActorMax) {
        return false;
      }
      if (!actorEntry && state.actorMap.size >= this.maxActorEntries) {
        throw new ConcurrencyBusyError('Per-actor concurrency map capacity reached.', {
          statusCode: 503,
          code: 'SERVER_BUSY',
          retryAfterSeconds: 2,
        });
      }
    }
    return true;
  }

  private allocatePermit(state: PoolState, actorKey?: string): PermitHandle {
    state.activePermits += 1;
    if (actorKey && state.policy.perActorMax !== undefined) {
      const entry = state.actorMap.get(actorKey);
      if (entry) {
        entry.active += 1;
      } else {
        state.actorMap.set(actorKey, { active: 1 });
      }
    }

    let released = false;
    return {
      poolId: state.policy.poolId,
      release: () => {
        if (released) return;
        released = true;

        state.activePermits = Math.max(0, state.activePermits - 1);
        if (actorKey && state.policy.perActorMax !== undefined) {
          const entry = state.actorMap.get(actorKey);
          if (entry) {
            entry.active -= 1;
            if (entry.active <= 0) {
              state.actorMap.delete(actorKey);
            }
          }
        }

        this.drainWaitQueue(state);
      },
    };
  }

  private drainWaitQueue(state: PoolState): void {
    let i = 0;
    while (i < state.waitQueue.length && state.activePermits < state.policy.maxConcurrent) {
      const waiter = state.waitQueue[i];
      let grantable = false;
      try {
        grantable = this.canGrantNow(state, waiter.actorKey);
      } catch (capErr) {
        state.waitQueue.splice(i, 1);
        waiter.cleanup();
        waiter.reject(capErr as Error);
        continue;
      }

      if (grantable) {
        state.waitQueue.splice(i, 1);
        waiter.cleanup();
        const handle = this.allocatePermit(state, waiter.actorKey);
        waiter.grant(handle);
      } else {
        i += 1;
      }
    }
  }

  acquirePermitForTest(
    poolId: ConcurrencyPoolId,
    options: {
      actorKey?: string;
      request?: Pick<FastifyRequest, 'raw'>;
      reply?: Pick<FastifyReply, 'raw' | 'sent'>;
    } = {},
  ): Promise<PermitHandle> {
    const state = this.pools.get(poolId);
    if (!state) {
      return Promise.reject(new Error(`Unknown concurrency pool "${poolId}"`));
    }

    const normalizedActor =
      options.actorKey && options.actorKey.trim().length > 0 ? options.actorKey.trim() : undefined;

    if (
      normalizedActor &&
      state.policy.perActorMax !== undefined &&
      !state.actorMap.has(normalizedActor) &&
      state.actorMap.size >= this.maxActorEntries
    ) {
      return Promise.reject(
        new ConcurrencyBusyError('Server concurrency tracker is saturated. Please retry shortly.', {
          statusCode: 503,
          code: 'SERVER_BUSY',
          retryAfterSeconds: 2,
        }),
      );
    }

    try {
      if (this.canGrantNow(state, normalizedActor)) {
        return Promise.resolve(this.allocatePermit(state, normalizedActor));
      }
    } catch (err) {
      return Promise.reject(err);
    }

    if (state.waitQueue.length >= state.policy.maxQueueSize) {
      return Promise.reject(
        new ConcurrencyBusyError('Server is busy handling concurrent requests. Please retry.', {
          statusCode: 503,
          code: 'SERVER_BUSY',
          retryAfterSeconds: 2,
        }),
      );
    }

    return new Promise<PermitHandle>((resolve, reject) => {
      let settled = false;

      const spliceSelf = () => {
        const idx = state.waitQueue.indexOf(waiter);
        if (idx >= 0) {
          state.waitQueue.splice(idx, 1);
        }
      };

      const queueTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
        spliceSelf();
        detachDisconnect();
        reject(
          new ConcurrencyBusyError('Timed out waiting for available execution capacity.', {
            statusCode: 503,
            code: 'SERVER_BUSY',
            retryAfterSeconds: 2,
          }),
        );
      }, state.policy.queueWaitTimeoutMs);
      queueTimer.unref?.();

      const detachDisconnect = attachClientDisconnectListener(
        options.request,
        options.reply,
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(queueTimer);
          spliceSelf();
          reject(
            new ConcurrencyBusyError('Client disconnected while queued.', {
              statusCode: 499,
              code: 'CLIENT_CLOSED_REQUEST',
              retryAfterSeconds: 1,
            }),
          );
        },
      );

      const waiter: QueuedWaiter = {
        actorKey: normalizedActor,
        grant: (handle) => {
          if (settled) {
            handle.release();
            return;
          }
          settled = true;
          resolve(handle);
        },
        reject: (err) => {
          if (settled) return;
          settled = true;
          reject(err);
        },
        cleanup: () => {
          clearTimeout(queueTimer);
          detachDisconnect();
        },
      };

      state.waitQueue.push(waiter);
    });
  }

  async runWithPermit<T>(
    poolId: ConcurrencyPoolId,
    context: {
      actorKey?: string;
      request?: Pick<FastifyRequest, 'raw'>;
      reply?: Pick<FastifyReply, 'raw' | 'sent' | 'header'>;
    },
    fn: (signal: AbortSignal, permit: PermitHandle) => Promise<T> | T,
  ): Promise<T> {
    const state = this.pools.get(poolId);
    if (!state) {
      throw new Error(`Unknown concurrency pool "${poolId}"`);
    }

    let permitHandle: PermitHandle;
    try {
      permitHandle = await this.acquirePermitForTest(poolId, context);
    } catch (err) {
      if (err instanceof ConcurrencyBusyError && context.reply?.header) {
        context.reply.header('Retry-After', String(err.retryAfterSeconds));
      }
      throw err;
    }

    const abortController = new AbortController();
    const detachDisconnect = attachClientDisconnectListener(context.request, context.reply, () => {
      if (state.policy.abortOnClientDisconnect) {
        abortController.abort(new Error('CLIENT_DISCONNECTED'));
      }
    });

    const opTimer = setTimeout(() => {
      abortController.abort(new Error('OPERATION_TIMEOUT'));
    }, state.policy.operationTimeoutMs);
    opTimer.unref?.();

    try {
      return await fn(abortController.signal, permitHandle);
    } finally {
      clearTimeout(opTimer);
      detachDisconnect();
      permitHandle.release(); // ONLY RELEASE POINT FOR ACQUIRED PERMITS
    }
  }
}

export const defaultConcurrencyRegistry = new BoundedConcurrencyRegistry();
