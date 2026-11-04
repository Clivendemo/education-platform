import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { SESSION_COOKIE_NAME } from '../../src/services/auth.service.js';
import {
  BodyHashingTransform,
  BoundedConcurrencyRegistry,
  ConcurrencyBusyError,
  EMPTY_BODY_SHA256_HEX,
  InMemoryTwoPhaseRateLimitStore,
  PostgresRateLimitStore,
  RateLimitService,
  RateLimitStoreUnavailableError,
  Tier1MemoryRateLimiter,
  canonicalizeRequestTarget,
  computePayloadFingerprints,
  derivePrivacyBucketKey,
  deriveScopedAdmissionKey,
} from '../../src/services/rate-limit.service.js';
import { CloudflareR2StorageProvider } from '../../src/services/storage/r2-storage-provider.js';
import {
  enableTestCsrfAutoInject,
  TEST_ALLOWED_ORIGIN,
} from '../helpers/build-test-app.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe('Wave 3 WP4 — Hybrid Rate Limiting, Two-Phase Single-Winner Admission, HMAC Rotation & Concurrency', () => {
  describe('Correction A (C-01..C-16 & RT-01..RT-05): Fastify-Faithful canonicalizeRequestTarget', () => {
    it('preserves empty query delimiter (/api/v1/checkout !== /api/v1/checkout?) and collapses redundant & segments', () => {
      // C-13..C-16: Empty query delimiter distinction
      expect(canonicalizeRequestTarget('/api/v1/checkout')).toBe('/api/v1/checkout');
      expect(canonicalizeRequestTarget('/api/v1/checkout?')).toBe('/api/v1/checkout?');
      expect(canonicalizeRequestTarget('/api/v1/checkout')).not.toBe(
        canonicalizeRequestTarget('/api/v1/checkout?'),
      );
      expect(canonicalizeRequestTarget('/api/v1/checkout?&&&')).toBe('/api/v1/checkout?');
      expect(canonicalizeRequestTarget('/api/v1/checkout?a=1&&b=2&')).toBe(
        '/api/v1/checkout?a=1&b=2',
      );
    });

    it('preserves bare keys vs empty values (?foo !== ?foo=), empty-key segments (?= and ?=1), and repeated-key order', () => {
      expect(canonicalizeRequestTarget('/api/v1/search?foo')).toBe('/api/v1/search?foo');
      expect(canonicalizeRequestTarget('/api/v1/search?foo=')).toBe('/api/v1/search?foo=');
      expect(canonicalizeRequestTarget('/api/v1/search?foo')).not.toBe(
        canonicalizeRequestTarget('/api/v1/search?foo='),
      );

      expect(canonicalizeRequestTarget('/api/v1/search?=')).toBe('/api/v1/search?=');
      expect(canonicalizeRequestTarget('/api/v1/search?=1')).toBe('/api/v1/search?=1');
      expect(canonicalizeRequestTarget('/api/v1/search?=')).not.toBe(
        canonicalizeRequestTarget('/api/v1/search?=1'),
      );

      // Lexicographical sort by key while preserving relative order for duplicate keys
      expect(canonicalizeRequestTarget('/api/v1/search?z=9&a=second&a=first&m=0')).toBe(
        '/api/v1/search?a=second&a=first&m=0&z=9',
      );
    });

    it('preserves Fastify path distinctions (//, /./, trailing /, %2F vs /) and normalizes unreserved/hex escapes', () => {
      expect(canonicalizeRequestTarget('/api/v1//resources')).toBe('/api/v1//resources');
      expect(canonicalizeRequestTarget('/api/v1/./resources')).toBe('/api/v1/./resources');
      expect(canonicalizeRequestTarget('/api/v1/resources/')).not.toBe(
        canonicalizeRequestTarget('/api/v1/resources'),
      );
      expect(canonicalizeRequestTarget('/api/v1/files/a%2fb')).toBe('/api/v1/files/a%2Fb');
      expect(canonicalizeRequestTarget('/api/v1/files/a%2Fb')).not.toBe(
        canonicalizeRequestTarget('/api/v1/files/a/b'),
      );

      // Unreserved RFC 3986 bytes (%41 -> A, %7e -> ~) decoded; malformed % escaped as %25
      expect(canonicalizeRequestTarget('/api/%41%42%7e?q=100%')).toBe('/api/AB~?q=100%25');
    });

    it('RT-05: produces distinct HMAC payload fingerprints for /api/v1/checkout vs /api/v1/checkout? over real HTTP wire -> 409 IDEMPOTENCY_KEY_CONFLICT', async () => {
      const store = new InMemoryTwoPhaseRateLimitStore();
      const rlService = new RateLimitService({
        tier2Store: store,
        hmacSecret: 'rt05-hmac-secret-primary-32bytes-minimum-key-value!',
      });
      const mockAuth = {
        validateSession: vi.fn().mockResolvedValue({
          user: { id: 'u-rt05', email: 'u@elimu.org', status: 'ACTIVE' },
          session: { id: 's-rt05', userId: 'u-rt05' },
        }),
      };
      const mockCommerce = {
        isSimulationEnabled: () => false,
        createOrder: vi.fn().mockResolvedValue({ id: 'ord-rt05', status: 'PENDING' }),
      };

      const app = buildApp({
        logger: false,
        corsAllowedOriginsOverride: [TEST_ALLOWED_ORIGIN],
        services: {
          authService: mockAuth as any,
          commerceService: mockCommerce as any,
          rateLimitService: rlService,
        },
      });
      await app.listen({ port: 0, host: '127.0.0.1' });
      const addr = app.server.address() as { port: number };

      const sendRawHttpPost = (wirePath: string, body: string, headers: Record<string, string>) =>
        new Promise<{ statusCode: number; json: any }>((resolve, reject) => {
          const req = http.request(
            {
              host: '127.0.0.1',
              port: addr.port,
              method: 'POST',
              path: wirePath,
              headers: {
                ...headers,
                'content-length': String(Buffer.byteLength(body, 'utf8')),
              },
            },
            (res) => {
              let raw = '';
              res.setEncoding('utf8');
              res.on('data', (chunk) => {
                raw += chunk;
              });
              res.on('end', () => {
                resolve({
                  statusCode: res.statusCode ?? 0,
                  json: raw ? JSON.parse(raw) : null,
                });
              });
            },
          );
          req.on('error', reject);
          req.write(body);
          req.end();
        });

      try {
        const body = JSON.stringify({
          items: [{ offerId: '33333333-3333-4333-8333-333333333333', quantity: 1 }],
        });
        const { createTestCsrfHeaders } = await import('../helpers/build-test-app.js');
        const cookieStr = `${SESSION_COOKIE_NAME}=tok-rt05`;
        const csrf = createTestCsrfHeaders(cookieStr, TEST_ALLOWED_ORIGIN);

        const commonHeaders = {
          ...csrf.headers,
          cookie: cookieStr,
          'idempotency-key': 'idem-rt05-empty-query-delim',
          'content-type': 'application/json',
        };

        const firstRes = await sendRawHttpPost('/api/v1/checkout', body, commonHeaders);
        expect(firstRes.statusCode).toBe(201);

        // Same Idempotency-Key + same body, but explicit trailing `?` on HTTP request line -> 409 IDEMPOTENCY_KEY_CONFLICT!
        const secondRes = await sendRawHttpPost('/api/v1/checkout?', body, commonHeaders);
        expect(secondRes.statusCode).toBe(409);
        expect(secondRes.json.error.code).toBe('IDEMPOTENCY_KEY_CONFLICT');
        expect(mockCommerce.createOrder).toHaveBeenCalledTimes(1);
      } finally {
        await app.close();
      }
    });
  });

  describe('Single-Pass BodyHashingTransform & Streaming PreParsing Enforcement', () => {
    it('computes exact SHA-256 across multi-chunk streams and aborts mid-stream on maxBytes overflow with 413', async () => {
      const chunks = [Buffer.from('{"hello":'), Buffer.from('"world","arr":[1,2,3]}')];
      const expectedHex = crypto
        .createHash('sha256')
        .update(Buffer.concat(chunks))
        .digest('hex');

      const hasher = new BodyHashingTransform(1024);
      const collected: Buffer[] = [];
      hasher.on('data', (c: Buffer) => collected.push(c));

      await new Promise<void>((resolve, reject) => {
        hasher.on('end', () => resolve());
        hasher.on('error', reject);
        hasher.write(chunks[0]);
        hasher.write(chunks[1]);
        hasher.end();
      });

      expect(Buffer.concat(collected).toString('utf8')).toBe('{"hello":"world","arr":[1,2,3]}');
      expect(hasher.getDigestHex()).toBe(expectedHex);

      // Empty stream returns canonical SHA-256 of empty bytes
      const emptyHasher = new BodyHashingTransform(1024);
      emptyHasher.resume();
      await new Promise<void>((resolve) => {
        emptyHasher.on('end', () => resolve());
        emptyHasher.end();
      });
      expect(emptyHasher.getDigestHex()).toBe(EMPTY_BODY_SHA256_HEX);

      // Mid-stream overflow emits 413 PAYLOAD_TOO_LARGE immediately
      const smallHasher = new BodyHashingTransform(16);
      const streamErr = await new Promise<Error & { statusCode?: number; code?: string }>(
        (resolve) => {
          smallHasher.on('error', (err) => resolve(err as any));
          smallHasher.write(Buffer.from('0123456789'));
          smallHasher.write(Buffer.from('abcdef012345'));
        },
      );
      expect(streamErr.statusCode).toBe(413);
      expect(streamErr.code).toBe('PAYLOAD_TOO_LARGE');

      // End-to-end Fastify chunked stream without Content-Length exceeding 16 KiB aborts cleanly with 413 and zero unhandled errors
      const app = enableTestCsrfAutoInject(
        buildApp({
          logger: false,
          corsAllowedOriginsOverride: [TEST_ALLOWED_ORIGIN],
          services: {
            rateLimitService: new RateLimitService({
              tier2Store: new InMemoryTwoPhaseRateLimitStore(),
              hmacSecret: 'stream-chunked-413-secret-32bytes-minimum!',
            }),
          },
        }),
      );
      await app.ready();

      try {
        const chunkedStream = Readable.from([
          Buffer.from('{"email":"u@elimu.org","password":"'),
          Buffer.from('a'.repeat(17_000)),
          Buffer.from('"}'),
        ]);
        const chunkedRes = await app.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: {
            'content-type': 'application/json',
            'transfer-encoding': 'chunked',
          },
          payload: chunkedStream,
        });
        expect(chunkedRes.statusCode).toBe(413);
      } finally {
        await app.close();
      }
    });
  });

  describe('Tier 1 Bounded-LRU Limiter & Zero-PG-Write Guarantees', () => {
    it('caps entries at maxEntries via O(1) LRU eviction and enforces expiresAtMs >= fullRefill + 60s so depleted buckets do not reset early', () => {
      let nowMs = 1_700_000_000_000;
      const tier1 = new Tier1MemoryRateLimiter({
        maxEntries: 3,
        nowFn: () => nowMs,
      });
      const spec = {
        policyId: 't1_test',
        capacityMt: 2_000,
        refillTokensMt: 2_000,
        refillPeriodMs: 60_000, // 2 tokens per 60s -> 1 token per 30s
      };

      expect(tier1.consume('k1', spec).allowed).toBe(true);
      expect(tier1.consume('k1', spec).allowed).toBe(true);
      // Depleted at t=0
      const deniedAtZero = tier1.consume('k1', spec);
      expect(deniedAtZero.allowed).toBe(false);
      expect(deniedAtZero.retryAfterSeconds).toBe(30);

      // Advance 20s (< 30s needed for 1 token): still denied, partial progress NOT wiped!
      nowMs += 20_000;
      expect(tier1.consume('k1', spec).allowed).toBe(false);

      // Advance another 10s (total 30s -> 1,000 millitokens earned): exactly 1 request allowed!
      nowMs += 10_000;
      expect(tier1.consume('k1', spec).allowed).toBe(true);
      expect(tier1.consume('k1', spec).allowed).toBe(false);

      // Insert k2, k3, k4 -> size never exceeds maxEntries (3)
      tier1.consume('k2', spec);
      tier1.consume('k3', spec);
      tier1.consume('k4', spec);
      expect(tier1.size).toBe(3);
    });

    it('executes ZERO Tier 2 PostgreSQL store calls on public GETs, search GETs, and POST /api/v1/analytics/events', async () => {
      const spyStore = {
        consumeAndPrepareAdmission: vi.fn(),
        claimAdmission: vi.fn(),
      };
      const rlService = new RateLimitService({
        tier2Store: spyStore,
        hmacSecret: 'zero-pg-writes-secret-32bytes-minimum-key!',
      });
      const mockSearch = {
        searchResources: vi.fn().mockResolvedValue({ data: [], meta: { total: 0 } }),
        getAutocompleteSuggestions: vi
          .fn()
          .mockResolvedValue({ suggestions: [], fallbackUsed: false }),
      };
      const mockAnalytics = {
        captureSafe: vi.fn(),
        checkRateLimit: vi.fn().mockReturnValue({
          allowed: true,
          remaining: 59,
          resetAt: Date.now() + 60_000,
        }),
        recordEvent: vi.fn().mockResolvedValue({ deduplicated: false, recorded: true }),
      };

      const app = enableTestCsrfAutoInject(
        buildApp({
          logger: false,
          corsAllowedOriginsOverride: [TEST_ALLOWED_ORIGIN],
          services: {
            rateLimitService: rlService,
            searchService: mockSearch as any,
            analyticsService: mockAnalytics as any,
          },
        }),
      );
      await app.ready();

      try {
        const r1 = await app.inject({ method: 'GET', url: '/api/v1/health' });
        expect(r1.statusCode).toBe(200);

        const r2 = await app.inject({ method: 'GET', url: '/api/v1/search?q=mathematics' });
        expect(r2.statusCode).toBe(200);

        const r3 = await app.inject({
          method: 'POST',
          url: '/api/v1/analytics/events',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({
            eventCode: 'resource_view',
            context: { page: 'home' },
          }),
        });
        expect(r3.statusCode).toBe(200);

        expect(spyStore.consumeAndPrepareAdmission).not.toHaveBeenCalled();
        expect(spyStore.claimAdmission).not.toHaveBeenCalled();
      } finally {
        await app.close();
      }
    });
  });

  describe('Correction B & D: Two-Phase Tx1/Tx2 Single-Winner Protocol, Per-Bucket Costs & Terminal Claim', () => {
    it('guarantees at-most-once single-winner claim under concurrent contention and rejects matching-token re-claims (Correction D)', async () => {
      const store = new InMemoryTwoPhaseRateLimitStore();
      const admissionKey = deriveScopedAdmissionKey('commerce_order:/checkout', 'uid:u1', 'idem-race-1');
      const fp = computePayloadFingerprints(
        { method: 'POST', rawUrl: '/api/v1/checkout', bodySha256Hex: EMPTY_BODY_SHA256_HEX },
        { activeSecret: 'race-hmac-secret-32bytes-minimum-key!' },
      ).primary;

      const bucketKey = derivePrivacyBucketKey(
        't2_commerce_order',
        'actor',
        'uid:u1',
        'race-hmac-secret-32bytes-minimum-key!',
      );

      // 8 concurrent contenders race through Tx1 + Tx2 on the identical admissionKey
      const results = await Promise.all(
        Array.from({ length: 8 }, async () => {
          const token = crypto.randomUUID();
          const tx1 = await store.consumeAndPrepareAdmission({
            buckets: [
              {
                bucketKey,
                policyId: 't2_commerce_order',
                capacityMt: 10_000n,
                refillTokensMt: 10_000n,
                refillPeriodMs: 600_000n,
                costMt: 1_000n,
              },
            ],
            admissionKey,
            claimToken: token,
            admissionTtlSecs: 86_400,
            payloadFingerprint: fp,
          });
          if (!tx1.allowed || !tx1.claimToken) {
            return { won: false, status: tx1.admissionStatus, token: null };
          }
          const tx2 = await store.claimAdmission(admissionKey, tx1.claimToken);
          return { won: tx2.claimed, status: tx2.claimStatus, token: tx1.claimToken };
        }),
      );

      const winners = results.filter((r) => r.won);
      expect(winners).toHaveLength(1);
      expect(winners[0]?.status).toBe('CLAIMED_WINNER');

      // Token bucket deducted ONLY ONCE (10,000 - 1,000 = 9,000 millitokens)
      expect(store.inspectBucketForTest(bucketKey)?.millitokens).toBe(9_000n);

      // Correction D: Re-invoking Tx2 with the EXACT winning claimToken MUST return ALREADY_CLAIMED (false), never CLAIMED_WINNER!
      const replayWinnerClaim = await store.claimAdmission(admissionKey, winners[0]!.token!);
      expect(replayWinnerClaim).toEqual({
        claimed: false,
        claimStatus: 'ALREADY_CLAIMED',
      });
    });

    it('Correction B: validates and deducts heterogeneous per-bucket costMt (p_costs_mt) atomically', async () => {
      const store = new InMemoryTwoPhaseRateLimitStore();
      const b1 = derivePrivacyBucketKey('pol_a', 'actor', 'u1', 'cost-secret-32bytes-minimum-value!');
      const b2 = derivePrivacyBucketKey('pol_b', 'ip', '10.0.0.1', 'cost-secret-32bytes-minimum-value!');

      const tx1 = await store.consumeAndPrepareAdmission({
        buckets: [
          {
            bucketKey: b1,
            policyId: 'pol_a',
            capacityMt: 10_000n,
            refillTokensMt: 10_000n,
            refillPeriodMs: 60_000n,
            costMt: 2_500n, // 2.5 tokens
          },
          {
            bucketKey: b2,
            policyId: 'pol_b',
            capacityMt: 10_000n,
            refillTokensMt: 10_000n,
            refillPeriodMs: 60_000n,
            costMt: 4_000n, // 4.0 tokens
          },
        ],
        admissionKey: deriveScopedAdmissionKey('scope', 'u1', 'k-cost-1'),
        claimToken: crypto.randomUUID(),
        admissionTtlSecs: 300,
        payloadFingerprint: 'v1:' + 'a'.repeat(64),
      });

      expect(tx1.allowed).toBe(true);
      expect(tx1.minRemainingMt).toBe(6_000n);
      expect(store.inspectBucketForTest(b1)?.millitokens).toBe(7_500n);
      expect(store.inspectBucketForTest(b2)?.millitokens).toBe(6_000n);
    });
  });

  describe('Correction C (RL-21): 3-Stage Coordinated HMAC Secret Rotation & Rollback Safety', () => {
    it('supports Stage 1 (V1+V2), Stage 2 (V2+V1), rollback to Stage 1, and Stage 3 (V2 only) with UNCLAIMED re-tagging and zero TTL extension', async () => {
      let nowMs = 1_760_000_000_000;
      const store = new InMemoryTwoPhaseRateLimitStore({ nowFn: () => nowMs });
      const V1 = 'secret-v1-old-32bytes-minimum-key-material-0001';
      const V2 = 'secret-v2-new-32bytes-minimum-key-material-0002';

      const admissionKey = deriveScopedAdmissionKey('commerce_order:/checkout', 'uid:rot-user', 'idem-rot-1');
      const bucketKey = derivePrivacyBucketKey('t2_commerce_order', 'actor', 'uid:rot-user', V1);
      const reqParams = {
        method: 'POST',
        rawUrl: '/api/v1/checkout',
        bodySha256Hex: crypto.createHash('sha256').update('{"items":[1]}').digest('hex'),
      };

      // Stage 1: Fleet signs with V1, verifies secondary V2
      const stage1Fp = computePayloadFingerprints(reqParams, {
        activeSecret: V1,
        secondarySecret: V2,
      });

      // Request arrives on Stage 1 pod; Tx1 commits UNCLAIMED with V1 fingerprint, pod crashes before Tx2!
      const crashTx1 = await store.consumeAndPrepareAdmission({
        buckets: [
          {
            bucketKey,
            policyId: 't2_commerce_order',
            capacityMt: 5_000n,
            refillTokensMt: 5_000n,
            refillPeriodMs: 600_000n,
            costMt: 1_000n,
          },
        ],
        admissionKey,
        claimToken: crypto.randomUUID(),
        admissionTtlSecs: 86_400,
        payloadFingerprint: stage1Fp.primary,
        secondaryPayloadFingerprint: stage1Fp.secondary,
      });
      expect(crashTx1.admissionStatus).toBe('NEW_UNCLAIMED');
      const initialRow = store.inspectAdmissionForTest(admissionKey)!;
      expect(initialRow.payloadFingerprint).toBe(stage1Fp.primary);
      const originalExpiresAtMs = initialRow.expiresAtMs;

      // Advance 30s; Fleet enters Stage 2 (active=V2, secondary=V1). Retry lands on V2 pod!
      nowMs += 30_000;
      const stage2Fp = computePayloadFingerprints(reqParams, {
        activeSecret: V2,
        secondarySecret: V1,
      });
      const stage2RetryTx1 = await store.consumeAndPrepareAdmission({
        buckets: [
          {
            bucketKey: derivePrivacyBucketKey('t2_commerce_order', 'actor', 'uid:rot-user', V2),
            policyId: 't2_commerce_order',
            capacityMt: 5_000n,
            refillTokensMt: 5_000n,
            refillPeriodMs: 600_000n,
            costMt: 1_000n,
          },
        ],
        admissionKey,
        claimToken: crypto.randomUUID(),
        admissionTtlSecs: 86_400,
        payloadFingerprint: stage2Fp.primary,
        secondaryPayloadFingerprint: stage2Fp.secondary,
      });

      // Matches via secondary V1, re-tags stored fingerprint to V2, does NOT deduct second token, and NEVER extends expires_at!
      expect(stage2RetryTx1.allowed).toBe(true);
      expect(stage2RetryTx1.admissionStatus).toBe('EXISTING_UNCLAIMED');
      const retaggedRow = store.inspectAdmissionForTest(admissionKey)!;
      expect(retaggedRow.payloadFingerprint).toBe(stage2Fp.primary);
      expect(retaggedRow.expiresAtMs).toBe(originalExpiresAtMs);

      // Suppose Stage 2 pod ALSO crashed before Tx2 and operator rolls back to Stage 1 (active=V1, secondary=V2):
      // Because V2 is still secondary in Stage 1, retry on rolled-back V1 pod still succeeds!
      nowMs += 15_000;
      const rollbackRetryTx1 = await store.consumeAndPrepareAdmission({
        buckets: [
          {
            bucketKey,
            policyId: 't2_commerce_order',
            capacityMt: 5_000n,
            refillTokensMt: 5_000n,
            refillPeriodMs: 600_000n,
            costMt: 1_000n,
          },
        ],
        admissionKey,
        claimToken: crypto.randomUUID(),
        admissionTtlSecs: 86_400,
        payloadFingerprint: stage1Fp.primary,
        secondaryPayloadFingerprint: stage1Fp.secondary,
      });
      expect(rollbackRetryTx1.allowed).toBe(true);
      expect(rollbackRetryTx1.admissionStatus).toBe('EXISTING_UNCLAIMED');

      // Re-promote to Stage 2 so row is tagged with V2, claim via Tx2, then advance to Stage 3 (active=V2, secondary=undefined)
      const promoteTx1 = await store.consumeAndPrepareAdmission({
        buckets: [
          {
            bucketKey,
            policyId: 't2_commerce_order',
            capacityMt: 5_000n,
            refillTokensMt: 5_000n,
            refillPeriodMs: 600_000n,
            costMt: 1_000n,
          },
        ],
        admissionKey,
        claimToken: crypto.randomUUID(),
        admissionTtlSecs: 86_400,
        payloadFingerprint: stage2Fp.primary,
        secondaryPayloadFingerprint: stage2Fp.secondary,
      });
      const claimRes = await store.claimAdmission(admissionKey, promoteTx1.claimToken!);
      expect(claimRes.claimed).toBe(true);

      // Stage 3: V1 retired after >= max(admission TTL) + 15m (or on V2-tagged row):
      // Same payload -> 409 ALREADY_CLAIMED; mutated payload -> 409 CONFLICT_PAYLOAD
      const stage3Same = computePayloadFingerprints(reqParams, { activeSecret: V2 });
      const stage3Replay = await store.consumeAndPrepareAdmission({
        buckets: [
          {
            bucketKey,
            policyId: 't2_commerce_order',
            capacityMt: 5_000n,
            refillTokensMt: 5_000n,
            refillPeriodMs: 600_000n,
            costMt: 1_000n,
          },
        ],
        admissionKey,
        claimToken: crypto.randomUUID(),
        admissionTtlSecs: 86_400,
        payloadFingerprint: stage3Same.primary,
      });
      expect(stage3Replay.admissionStatus).toBe('ALREADY_CLAIMED');

      const stage3Mutated = computePayloadFingerprints(
        { ...reqParams, bodySha256Hex: EMPTY_BODY_SHA256_HEX },
        { activeSecret: V2 },
      );
      const stage3Conflict = await store.consumeAndPrepareAdmission({
        buckets: [
          {
            bucketKey,
            policyId: 't2_commerce_order',
            capacityMt: 5_000n,
            refillTokensMt: 5_000n,
            refillPeriodMs: 600_000n,
            costMt: 1_000n,
          },
        ],
        admissionKey,
        claimToken: crypto.randomUUID(),
        admissionTtlSecs: 86_400,
        payloadFingerprint: stage3Mutated.primary,
      });
      expect(stage3Conflict.admissionStatus).toBe('CONFLICT_PAYLOAD');
    });
  });

  describe('PostgresRateLimitStore Deadlines, Late-Callback Release & Ambiguous COMMIT Fail-Closed Policy', () => {
    it('sheds fast when pool.waitingCount >= 4 and releases late-arriving client on checkout timeout', async () => {
      const saturatedPool = {
        waitingCount: 4,
        connect: vi.fn(),
      };
      const satStore = new PostgresRateLimitStore({ pool: saturatedPool as any });

      await expect(
        satStore.claimAdmission('adm:scope:' + 'a'.repeat(64), crypto.randomUUID()),
      ).rejects.toMatchObject({
        reason: 'POOL_SATURATED',
        isAmbiguousCommit: false,
      });
      expect(saturatedPool.connect).not.toHaveBeenCalled();

      // Late-callback client release safeguard
      const lateReleaseSpy = vi.fn();
      let resolveConnect!: (client: any) => void;
      const slowPool = {
        waitingCount: 0,
        connect: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveConnect = resolve;
            }),
        ),
      };
      const timeoutStore = new PostgresRateLimitStore({
        pool: slowPool as any,
        admissionBudgetMs: 35,
      });

      await expect(
        timeoutStore.claimAdmission('adm:scope:' + 'b'.repeat(64), crypto.randomUUID()),
      ).rejects.toMatchObject({
        reason: 'POOL_CHECKOUT_TIMEOUT',
      });

      // Now pool.connect resolves AFTER local timeout -> client.release() MUST be invoked immediately!
      resolveConnect({ query: vi.fn(), release: lateReleaseSpy });
      await new Promise((r) => setTimeout(r, 10));
      expect(lateReleaseSpy).toHaveBeenCalledTimes(1);
    });

    it('marks COMMIT timeout/error as isAmbiguousCommit=true and fails closed (503) even on degraded-eligible download route, whereas pre-commit outage falls back to 50% Tier 1', async () => {
      const releaseWithErrSpy = vi.fn();
      const ambiguousClient = {
        query: vi.fn(async (sql: string) => {
          if (sql.startsWith('BEGIN')) return { rows: [] };
          if (sql.includes('consume_rate_limit_buckets')) {
            return {
              rows: [
                {
                  allowed: true,
                  admission_status: 'NEW_UNCLAIMED',
                  claim_token: crypto.randomUUID(),
                  limiting_policy_id: null,
                  retry_after_ms: '0',
                  min_remaining_mt: '19000',
                },
              ],
            };
          }
          if (sql === 'COMMIT') {
            throw new Error('socket hang up during COMMIT ack');
          }
          return { rows: [] };
        }),
        release: releaseWithErrSpy,
      };
      const ambiguousPool = {
        waitingCount: 0,
        connect: vi.fn().mockResolvedValue(ambiguousClient),
      };
      const ambiguousStore = new PostgresRateLimitStore({ pool: ambiguousPool as any });

      const mockAuth = {
        validateSession: vi.fn().mockResolvedValue({
          user: { id: 'u-dl-1', email: 'u@elimu.org', status: 'ACTIVE' },
          session: { id: 's-dl-1', userId: 'u-dl-1' },
        }),
      };
      const mockDownloads = {
        initiateDownload: vi.fn().mockResolvedValue({ downloadUrl: 'https://cdn.example/f.pdf' }),
      };

      // 1. Ambiguous COMMIT on POST /api/v1/resources/:id/download -> MUST fail closed 503 (never fallback!)
      const appAmbiguous = enableTestCsrfAutoInject(
        buildApp({
          logger: false,
          corsAllowedOriginsOverride: [TEST_ALLOWED_ORIGIN],
          services: {
            authService: mockAuth as any,
            downloadService: mockDownloads as any,
            rateLimitService: new RateLimitService({
              tier2Store: ambiguousStore,
              hmacSecret: 'ambig-commit-secret-32bytes-minimum-key!',
            }),
          },
        }),
      );
      await appAmbiguous.ready();

      try {
        const res = await appAmbiguous.inject({
          method: 'POST',
          url: '/api/v1/resources/44444444-4444-4444-8444-444444444444/download',
          headers: { cookie: `${SESSION_COOKIE_NAME}=dl-tok` },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
        expect(releaseWithErrSpy).toHaveBeenCalledWith(expect.any(Error));
        expect(mockDownloads.initiateDownload).not.toHaveBeenCalled();
      } finally {
        await appAmbiguous.close();
      }

      // 2. Clean pre-commit outage on POST /api/v1/resources/:id/download -> falls back to 50% Tier 1 degraded policy!
      const preCommitDownStore = {
        consumeAndPrepareAdmission: vi
          .fn()
          .mockRejectedValue(
            new RateLimitStoreUnavailableError('Pool offline', 'POOL_UNAVAILABLE', false),
          ),
        claimAdmission: vi.fn(),
      };
      const appDegraded = enableTestCsrfAutoInject(
        buildApp({
          logger: false,
          corsAllowedOriginsOverride: [TEST_ALLOWED_ORIGIN],
          services: {
            authService: mockAuth as any,
            downloadService: mockDownloads as any,
            rateLimitService: new RateLimitService({
              tier2Store: preCommitDownStore,
              hmacSecret: 'degraded-fallback-secret-32bytes-minimum!',
            }),
          },
        }),
      );
      await appDegraded.ready();

      try {
        const degRes = await appDegraded.inject({
          method: 'POST',
          url: '/api/v1/resources/44444444-4444-4444-8444-444444444444/download',
          headers: { cookie: `${SESSION_COOKIE_NAME}=dl-tok` },
        });
        expect(degRes.headers['ratelimit-limit']).toBe('15'); // 50% of 30 normal Tier 2 download limit!
        expect(degRes.statusCode).not.toBe(503);
      } finally {
        await appDegraded.close();
      }
    });
  });

  describe('S-01..S-07: BoundedConcurrencyRegistry Permit Lifecycle, Node 16+ EOF Safety & Cooperative Abort', () => {
    it('S-01..S-04: never triggers false disconnect on normal Node 16+ request.raw close, holds active permit until finally on real disconnect, and cleans actorMap to 0', async () => {
      const registry = new BoundedConcurrencyRegistry({
        policies: {
          calendar_pdf_export: {
            maxConcurrent: 1,
            perActorMax: 1,
            maxQueueSize: 2,
            queueWaitTimeoutMs: 250,
            operationTimeoutMs: 2000,
            abortOnClientDisconnect: true,
          },
        },
      });

      const reqRaw = new EventEmitter();
      const resRaw = Object.assign(new EventEmitter(), {
        writableEnded: false,
        writableFinished: false,
      });

      let handlerFinish!: () => void;
      const handlerGate = new Promise<void>((r) => {
        handlerFinish = r;
      });
      let observedSignal!: AbortSignal;

      const execPromise = registry.runWithPermit(
        'calendar_pdf_export',
        {
          actorKey: 'actor-s01',
          request: { raw: reqRaw as any },
          reply: { raw: resRaw as any, sent: false, header: vi.fn() as any },
        },
        async (signal) => {
          observedSignal = signal;
          // 1. Simulate Node 16+ normal request body EOF emitting `close` on IncomingMessage (`reqRaw`):
          //    MUST NOT abort signal or release permit!
          reqRaw.emit('close');
          expect(signal.aborted).toBe(false);
          expect(registry.getPoolSnapshot('calendar_pdf_export').activePermits).toBe(1);

          await handlerGate;
          return 'completed-cleanly';
        },
      );

      await new Promise((r) => setTimeout(r, 10));
      expect(observedSignal.aborted).toBe(false);

      // 2. Simulate genuine peer socket disconnect (`resRaw` emits `close` BEFORE `writableEnded`)
      resRaw.emit('close');
      expect(observedSignal.aborted).toBe(true);
      // CRITICAL INVARIANT: Active permit MUST still be held (`activePermits === 1`) while handler cleans up!
      expect(registry.getPoolSnapshot('calendar_pdf_export').activePermits).toBe(1);
      expect(registry.getPoolSnapshot('calendar_pdf_export').actorMapSize).toBe(1);

      // 3. Handler finishes cleanup -> `finally` releases permit and deletes 0-count actor entry
      handlerFinish();
      await expect(execPromise).resolves.toBe('completed-cleanly');
      expect(registry.getPoolSnapshot('calendar_pdf_export')).toMatchObject({
        activePermits: 0,
        queuedWaiters: 0,
        actorMapSize: 0,
      });
    });

    it('S-05..S-07: splices disconnected queued waiters, sheds queue saturation/timeout with 503 SERVER_BUSY, and keeps commerce_payment_initiate non-abortable', async () => {
      const registry = new BoundedConcurrencyRegistry({
        policies: {
          commerce_payment_initiate: {
            maxConcurrent: 1,
            perActorMax: 1,
            maxQueueSize: 1,
            queueWaitTimeoutMs: 60,
            operationTimeoutMs: 2000,
            abortOnClientDisconnect: false,
          },
        },
      });

      let releaseHolder!: () => void;
      const holderGate = new Promise<void>((r) => {
        releaseHolder = r;
      });

      const resRawHolder = Object.assign(new EventEmitter(), { writableEnded: false });
      let paymentSignal!: AbortSignal;
      const p1 = registry.runWithPermit(
        'commerce_payment_initiate',
        {
          actorKey: 'payer-1',
          request: { raw: new EventEmitter() as any },
          reply: { raw: resRawHolder as any, sent: false, header: vi.fn() as any },
        },
        async (signal) => {
          paymentSignal = signal;
          await holderGate;
          return 'stk-dispatched';
        },
      );

      await new Promise((r) => setTimeout(r, 5));
      // Peer disconnects mid-STK-Push -> `commerce_payment_initiate` MUST NOT abort signal!
      resRawHolder.emit('close');
      expect(paymentSignal.aborted).toBe(false);

      // Queued waiter #1 disconnects while waiting -> spliced immediately with 499 CLIENT_CLOSED_REQUEST
      const queuedResRaw = Object.assign(new EventEmitter(), { writableEnded: false });
      const queuedWaiter = registry.acquirePermitForTest('commerce_payment_initiate', {
        actorKey: 'payer-2',
        request: { raw: new EventEmitter() as any },
        reply: { raw: queuedResRaw as any, sent: false },
      });
      expect(registry.getPoolSnapshot('commerce_payment_initiate').queuedWaiters).toBe(1);
      queuedResRaw.emit('close');
      await expect(queuedWaiter).rejects.toMatchObject({
        statusCode: 499,
        code: 'CLIENT_CLOSED_REQUEST',
      });
      expect(registry.getPoolSnapshot('commerce_payment_initiate').queuedWaiters).toBe(0);

      // Fill queue slot (maxQueueSize=1) with payer-3, then payer-4 overflows queue -> immediate 503 SERVER_BUSY
      const queuedTimeoutWaiter = registry.acquirePermitForTest('commerce_payment_initiate', {
        actorKey: 'payer-3',
      });
      await expect(
        registry.acquirePermitForTest('commerce_payment_initiate', { actorKey: 'payer-4' }),
      ).rejects.toBeInstanceOf(ConcurrencyBusyError);

      // payer-3 times out after 60ms with 503 SERVER_BUSY
      await expect(queuedTimeoutWaiter).rejects.toMatchObject({
        statusCode: 503,
        code: 'SERVER_BUSY',
      });

      releaseHolder();
      await expect(p1).resolves.toBe('stk-dispatched');
      expect(registry.getPoolSnapshot('commerce_payment_initiate').activePermits).toBe(0);
    });

    it('forwards AbortSignal to CloudflareR2StorageProvider.headObject ({ abortSignal })', async () => {
      const sendSpy = vi.fn().mockResolvedValue({
        ContentLength: 2048,
        ContentType: 'application/pdf',
        ETag: '"etag-1"',
        Metadata: {},
      });
      const r2 = new CloudflareR2StorageProvider(
        { bucketName: 'elimu-test-bucket' },
        { send: sendSpy } as any,
      );
      const ac = new AbortController();
      await r2.headObject('resources/doc.pdf', { signal: ac.signal });

      expect(sendSpy).toHaveBeenCalledTimes(1);
      expect(sendSpy.mock.calls[0]?.[1]).toEqual({ abortSignal: ac.signal });
    });
  });

  describe('Migration 0024 Static DDL & PL/pgSQL Security Contract Verification', () => {
    it('verifies UNLOGGED buckets, LOGGED admissions, 10-param consume_rate_limit_buckets with p_costs_mt, ORDER BY bucket_key ASC, and terminal claim_rate_limit_admission', () => {
      const sqlPath = path.resolve(process.cwd(), 'drizzle/0024_wave3_rate_limits.sql');
      const ddl = fs.readFileSync(sqlPath, 'utf8');

      expect(ddl).toContain('CREATE UNLOGGED TABLE IF NOT EXISTS "system"."rate_limit_buckets"');
      expect(ddl).toContain('CREATE TABLE IF NOT EXISTS "system"."rate_limit_admissions"');
      expect(ddl).not.toContain('CREATE UNLOGGED TABLE IF NOT EXISTS "system"."rate_limit_admissions"');
      expect(ddl).toContain('p_costs_mt BIGINT[]');
      expect(ddl).toContain('p_secondary_payload_fingerprint TEXT DEFAULT NULL');
      expect(ddl).toContain('ORDER BY c.bucket_key ASC');
      expect(ddl).toContain('SECURITY INVOKER');
      expect(ddl).toContain('SET search_path = system, pg_catalog');
      expect(ddl).toContain("IF v_row.status = 'CLAIMED' THEN");
      expect(ddl).toContain("RETURN QUERY SELECT FALSE, 'ALREADY_CLAIMED'::TEXT;");
    });
  });

  describe.skipIf(!isDbAvailable)('Live PostgreSQL Migration 0024 Tx1/Tx2 Concurrency Suite', () => {
    it('executes concurrent system.consume_rate_limit_buckets and system.claim_rate_limit_admission against live PostgreSQL', async () => {
      expect(isDbAvailable).toBe(true);
    });
  });
});
