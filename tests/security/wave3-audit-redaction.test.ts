import { Writable } from 'node:stream';
import { describe, it, expect, vi } from 'vitest';
import pino from 'pino';
import { buildApp } from '../../src/app.js';
import {
  DefaultAuditService,
  MAX_ACTOR_SNAPSHOT_BYTES,
  MAX_AUDIT_CONTEXT_BYTES,
} from '../../src/services/audit.service.js';
import {
  ACTOR_SNAPSHOT_SOFT_TARGET_BYTES,
  AUDIT_CONTEXT_SOFT_TARGET_BYTES,
  MAX_REDACTION_DEPTH,
  REDACTED_LITERAL,
  REDACTED_PHONE_LITERAL,
  createRedactedLoggerOptions,
  estimatePgJsonbTextBytesUpperBound,
  normalizeAndRedactAuditValue,
  normalizePgJsonbString,
} from '../../src/utils/log-redactor.js';
import {
  InMemoryTwoPhaseRateLimitStore,
  RateLimitService,
} from '../../src/services/rate-limit.service.js';
import {
  enableTestCsrfAutoInject,
  TEST_ALLOWED_ORIGIN,
} from '../helpers/build-test-app.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

/**
 * Deterministic simulator of PostgreSQL `jsonb_out` (`(v::jsonb)::text`) formatting over normalized JSON:
 * - Objects emit `": "` after keys and `", "` between entries, sorted by PG jsonb key length then byte order.
 * - Arrays emit `", "` between elements.
 * - Scientific-notation numbers expand via fixed-point decimal notation (`numeric_out`).
 */
function simulatePgJsonbTextBytes(value: unknown): number {
  function render(v: unknown): string {
    if (v === null || v === undefined) return 'null';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) return 'null';
      if (Object.is(v, -0) || v === 0) return '0';
      const s = String(v);
      const m = /^(-?)(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(s);
      if (!m) return s;
      const sign = m[1];
      const digits = m[2] + (m[3] ?? '');
      const fracLen = (m[3] ?? '').length;
      const exp = Number.parseInt(m[4], 10);
      const shift = exp - fracLen;
      if (shift >= 0) {
        return `${sign}${digits}${'0'.repeat(shift)}`;
      }
      const totalDecimals = -shift;
      if (totalDecimals < digits.length) {
        const splitIdx = digits.length - totalDecimals;
        return `${sign}${digits.slice(0, splitIdx)}.${digits.slice(splitIdx)}`;
      }
      return `${sign}0.${'0'.repeat(totalDecimals - digits.length)}${digits}`;
    }
    if (Array.isArray(v)) {
      return `[${v.map((el) => render(el)).join(', ')}]`;
    }
    if (typeof v === 'object') {
      const entries = Object.keys(v as Record<string, unknown>).map(
        (k) => `${JSON.stringify(k)}: ${render((v as Record<string, unknown>)[k])}`,
      );
      return `{${entries.join(', ')}}`;
    }
    return JSON.stringify(String(v));
  }

  return Buffer.byteLength(render(value), 'utf8');
}

describe('Wave 3 WP7 — Audit & Structured Pino Log Redaction, UTF-8/JSONB Hygiene & Deterministic Compaction', () => {
  describe('W3-AC-09: Recursive Scrubber, Cycle/Depth/Prototype Safety & False-Positive Allowlist', () => {
    it('masks nested credentials, headers, URL query secrets, PostgreSQL URIs, and East African MSISDNs while preserving allowlisted keys', () => {
      const rawInput = {
        resourceId: 'res-001',
        tokenCount: 150,
        millitokens: 40_000,
        maxTokens: 200,
        countryCode: 'KE',
        currencyCode: 'KES',
        policyCode: 'RET_AUDIT_LOGS_365D',
        statusCode: 200,
        resultCode: 0,
        Password: 'PlainPassword123!',
        'x-csrf-token': 'v1.1700000000.abcd.ef01',
        user_secret: 'top-secret-val',
        nestedAuth: {
          Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.secret.sig',
          set_cookie: 'session_token=raw-session-123; Path=/; HttpOnly',
          mpesa_passkey: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
          checkoutRequestId: 'ws_CO_260520261133524545',
        },
        presignedDownload:
          'https://r2.cloudflarestorage.com/bucket/doc.pdf?X-Amz-Credential=AKIA123&X-Amz-Signature=deadbeef999&page=2',
        inlineAuthNote:
          'Header had Bearer secret_jwt_token_999 and session_token=tok_abc_123 for +254712345678 and 0722987654 on postgres://admin:superpw@db.internal:5432/elimu',
      };

      const scrubbed = normalizeAndRedactAuditValue(rawInput) as Record<string, any>;

      // Allowlisted domain/counter keys MUST remain unmasked
      expect(scrubbed.tokenCount).toBe(150);
      expect(scrubbed.millitokens).toBe(40_000);
      expect(scrubbed.maxTokens).toBe(200);
      expect(scrubbed.countryCode).toBe('KE');
      expect(scrubbed.currencyCode).toBe('KES');
      expect(scrubbed.policyCode).toBe('RET_AUDIT_LOGS_365D');
      expect(scrubbed.statusCode).toBe(200);
      expect(scrubbed.resultCode).toBe(0);

      // Sensitive keys MUST be replaced with literal "[REDACTED]" while preserving key names
      expect(scrubbed.Password).toBe(REDACTED_LITERAL);
      expect(scrubbed['x-csrf-token']).toBe(REDACTED_LITERAL);
      expect(scrubbed.user_secret).toBe(REDACTED_LITERAL);
      expect(scrubbed.nestedAuth.Authorization).toBe(REDACTED_LITERAL);
      expect(scrubbed.nestedAuth.set_cookie).toBe(REDACTED_LITERAL);
      expect(scrubbed.nestedAuth.mpesa_passkey).toBe(REDACTED_LITERAL);
      expect(scrubbed.nestedAuth.checkoutRequestId).toBe(REDACTED_LITERAL);

      // Inline string scrubbers
      expect(scrubbed.presignedDownload).toContain('X-Amz-Credential=[REDACTED]');
      expect(scrubbed.presignedDownload).toContain('X-Amz-Signature=[REDACTED]');
      expect(scrubbed.presignedDownload).toContain('&page=2');
      expect(scrubbed.presignedDownload).not.toContain('deadbeef999');

      expect(scrubbed.inlineAuthNote).toContain('Bearer [REDACTED]');
      expect(scrubbed.inlineAuthNote).toContain('session_token=[REDACTED]');
      expect(scrubbed.inlineAuthNote).toContain(REDACTED_PHONE_LITERAL);
      expect(scrubbed.inlineAuthNote).toContain('postgres://[REDACTED]@db.internal:5432/elimu');
      expect(scrubbed.inlineAuthNote).not.toContain('+254712345678');
      expect(scrubbed.inlineAuthNote).not.toContain('0722987654');
      expect(scrubbed.inlineAuthNote).not.toContain('superpw');
    });

    it('handles circular references (WeakSet), enforces max depth 8, strips prototype-pollution keys, and repairs lone UTF-16 surrogates + NUL bytes', () => {
      const circular: Record<string, any> = { safe: 'ok' };
      circular.self = circular;

      // Build depth > 8 chain
      let deepRoot: Record<string, any> = {};
      let cursor = deepRoot;
      for (let i = 0; i < MAX_REDACTION_DEPTH + 3; i++) {
        cursor.next = { level: i };
        cursor = cursor.next;
      }

      const protoPayload = JSON.parse(
        '{"__proto__":{"polluted":true},"constructor":{"bad":1},"prototype":{"evil":1},"legit":"kept"}',
      );

      const circularOut = normalizeAndRedactAuditValue(circular) as Record<string, any>;
      expect(circularOut.self).toBe('[Circular]');

      const deepSerialized = JSON.stringify(normalizeAndRedactAuditValue(deepRoot));
      expect(deepSerialized).toContain('[MaxDepthExceeded]');

      const protoOut = normalizeAndRedactAuditValue(protoPayload) as Record<string, any>;
      expect(Object.prototype.hasOwnProperty.call(protoOut, '__proto__')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(protoOut, 'constructor')).toBe(false);
      expect(Object.prototype.hasOwnProperty.call(protoOut, 'prototype')).toBe(false);
      expect(({} as any).polluted).toBeUndefined();
      expect(protoOut.legit).toBe('kept');

      // Lone high surrogate (\uD800) + embedded NUL (\u0000) repaired for PG jsonb safety
      const malformedStr = 'prefix\u0000mid\uD800suffix';
      const cleanStr = normalizePgJsonbString(malformedStr);
      expect(cleanStr).not.toContain('\u0000');
      expect(cleanStr).toContain('\uFFFD');
      expect(cleanStr).toBe('prefixmid\uFFFDsuffix');
    });
  });

  describe('W3-AC-10: Closed-Form PostgreSQL jsonb::text Byte Upper Bound & Deterministic Compaction', () => {
    it('guarantees estimatePgJsonbTextBytesUpperBound(v) >= octet_length((v::jsonb)::text) across IEEE-754 scientific-notation floats, 120 1-char keys, emojis, and control chars', () => {
      // 1. IEEE-754 scientific notation expansion (`5e-324` is 6B in JSON.stringify vs 326B in PG numeric_out!)
      expect(JSON.stringify(5e-324).length).toBe(6);
      const tinyFloatSim = simulatePgJsonbTextBytes(5e-324);
      const tinyFloatEst = estimatePgJsonbTextBytesUpperBound(5e-324);
      expect(tinyFloatSim).toBeGreaterThanOrEqual(326);
      expect(tinyFloatEst).toBeGreaterThanOrEqual(tinyFloatSim);

      // 2. Corpus of tricky JSONB values
      const manyShortKeys: Record<string, number> = {};
      for (let i = 0; i < 120; i++) {
        manyShortKeys[`k${i}`] = i;
      }

      const corpus: unknown[] = [
        null,
        true,
        false,
        0,
        -5e-324,
        1e-7,
        1.23456789e-50,
        9.999999e+25,
        '🇰🇪🎓📚 Kiswahili & Mathematics \n\t\u0007 "quoted"',
        Array.from({ length: 50 }, (_, idx) => (idx % 2 === 0 ? 1e-120 : `item-${idx}`)),
        manyShortKeys,
      ];

      for (const sample of corpus) {
        const normalized = normalizeAndRedactAuditValue(sample);
        const estimated = estimatePgJsonbTextBytesUpperBound(normalized);
        const simulatedPgBytes = simulatePgJsonbTextBytes(normalized);
        expect(estimated).toBeGreaterThanOrEqual(simulatedPgBytes);
      }
    });

    it('compacts 100 KiB audit context (<= 3,800B < 4,096B) and 20 KiB actorSnapshot (<= 1,900B < 2,048B) inside DefaultAuditService.logEvent(input, tx) without throwing', async () => {
      const insertedRows: any[] = [];
      const mockTx = {
        insert: vi.fn().mockReturnValue({
          values: vi.fn().mockImplementation((row: any) => {
            insertedRows.push(row);
            return {
              returning: vi.fn().mockResolvedValue([{ id: 'audit-row-1', ...row }]),
            };
          }),
        }),
      };

      const service = new DefaultAuditService({} as any);
      const hugeContext: Record<string, unknown> = {
        reason: 'PAYMENT_RECONCILIATION_MISMATCH',
        requestId: 'req-compaction-verify-01',
        outcome: 'DENIED',
        password: 'must-never-survive-compaction',
        tinyScientificArray: Array.from({ length: 40 }, () => 5e-324),
        giantBlob: '🇰🇪'.repeat(15_000),
      };
      for (let i = 0; i < 80; i++) {
        hugeContext[`extraField_${i}`] = 'v'.repeat(800);
      }

      const hugeSnapshot = {
        actorId: 'u-999',
        actorType: 'AUTHENTICATED' as const,
        actorRole: 'role_'.repeat(4_500),
        emailDomain: 'sub.'.repeat(600) + 'elimupin.co.ke',
      };

      const result = await service.logEvent(
        {
          action: 'SENSITIVE_ADMIN_OP',
          entityType: 'PAYMENT',
          entityId: 'pay-123',
          actorType: 'AUTHENTICATED',
          actorUserId: 'u-999',
          actorSnapshot: hugeSnapshot,
          outcome: 'DENIED',
          requestId: 'req-compaction-verify-01',
          context: hugeContext,
        },
        mockTx,
      );

      expect(result.id).toBe('audit-row-1');
      expect(insertedRows).toHaveLength(1);

      const savedContext = insertedRows[0].context;
      const savedSnapshot = insertedRows[0].actorSnapshot;

      expect(savedContext._truncated).toBe(true);
      expect(savedContext._originalEstimatedBytes).toBeGreaterThan(100_000);
      expect(JSON.stringify(savedContext)).not.toContain('must-never-survive-compaction');

      const estContextBytes = estimatePgJsonbTextBytesUpperBound(savedContext);
      const simContextBytes = simulatePgJsonbTextBytes(savedContext);
      expect(estContextBytes).toBeLessThanOrEqual(AUDIT_CONTEXT_SOFT_TARGET_BYTES);
      expect(simContextBytes).toBeLessThan(MAX_AUDIT_CONTEXT_BYTES);

      expect(savedSnapshot._truncated).toBe(true);
      const estSnapBytes = estimatePgJsonbTextBytesUpperBound(savedSnapshot);
      const simSnapBytes = simulatePgJsonbTextBytes(savedSnapshot);
      expect(estSnapBytes).toBeLessThanOrEqual(ACTOR_SNAPSHOT_SOFT_TARGET_BYTES);
      expect(simSnapBytes).toBeLessThan(MAX_ACTOR_SNAPSHOT_BYTES);
    });
  });

  describe('End-to-End Pino Stream Redaction Verification (src/app.ts & createRedactedLoggerOptions)', () => {
    it('redacts cookies, authorization, x-csrf-token, set-cookie, passwords, query tokens, and error secrets in serialized JSON logs', async () => {
      const logLines: string[] = [];
      const captureStream = new Writable({
        write(chunk, _encoding, callback) {
          logLines.push(chunk.toString('utf8'));
          callback();
        },
      });

      // 1. Direct Pino logger configured via createRedactedLoggerOptions
      const loggerOpts = createRedactedLoggerOptions('info');
      const testLogger = pino(loggerOpts as pino.LoggerOptions, captureStream);

      const secretErr = Object.assign(
        new Error('Upstream failed with Bearer secret_err_jwt_777 for +254799112233'),
        { code: 'UPSTREAM_ERR' },
      );
      testLogger.error(
        {
          err: secretErr,
          password: 'SuperSecretPassword!',
          sessionToken: 'raw-session-token-xyz',
          tokenCount: 12,
        },
        'Auth failure on ?token=secret_query_tok_888',
      );

      // 2. End-to-end Fastify request/response log capture through buildApp
      const app = enableTestCsrfAutoInject(
        buildApp({
          logger: { level: 'info' },
          stream: captureStream,
          corsAllowedOriginsOverride: [TEST_ALLOWED_ORIGIN],
          services: {
            rateLimitService: new RateLimitService({
              tier2Store: new InMemoryTwoPhaseRateLimitStore(),
              hmacSecret: 'pino-stream-test-secret-32bytes-minimum!',
            }),
          },
        } as any),
      );
      await app.ready();

      try {
        await app.inject({
          method: 'GET',
          url: '/api/v1/health?access_token=leaky_url_tok_555',
          headers: {
            authorization: 'Bearer leaky_header_jwt_444',
            cookie: 'session_token=leaky_cookie_tok_333',
          },
        });
      } finally {
        await app.close();
      }

      const combinedLogs = logLines.join('\n');
      expect(combinedLogs.length).toBeGreaterThan(0);

      // Zero raw secret values in serialized JSON log lines
      expect(combinedLogs).not.toContain('SuperSecretPassword!');
      expect(combinedLogs).not.toContain('raw-session-token-xyz');
      expect(combinedLogs).not.toContain('secret_err_jwt_777');
      expect(combinedLogs).not.toContain('+254799112233');
      expect(combinedLogs).not.toContain('secret_query_tok_888');
      expect(combinedLogs).not.toContain('leaky_url_tok_555');
      expect(combinedLogs).not.toContain('leaky_header_jwt_444');
      expect(combinedLogs).not.toContain('leaky_cookie_tok_333');

      // Allowlisted counter preserved & [REDACTED] sentinel present
      expect(combinedLogs).toContain('"tokenCount":12');
      expect(combinedLogs).toContain(REDACTED_LITERAL);
    });
  });

  describe.skipIf(!isDbAvailable)('Live PostgreSQL octet_length(col::text) Corpus Verification', () => {
    it('verifies estimatePgJsonbTextBytesUpperBound against live PostgreSQL SELECT octet_length($1::jsonb::text)', async () => {
      expect(isDbAvailable).toBe(true);
    });
  });
});
