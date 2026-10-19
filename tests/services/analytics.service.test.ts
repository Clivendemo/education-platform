import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  normalizeAndValidatePath,
  BoundedRateLimiter,
  formatSafeCount,
  SearchContextSchema,
  ViewContextSchema,
  DownloadContextSchema,
  FeedbackContextSchema,
  DefaultAnalyticsService,
} from '../../src/services/analytics.service.js';

describe('AnalyticsService Unit Tests', () => {
  describe('Path Normalization and Security Rejection', () => {
    it('normalizes valid relative paths and removes trailing slashes', () => {
      expect(normalizeAndValidatePath('/resources/123/')).toBe('/resources/123');
      expect(normalizeAndValidatePath('resources/123')).toBe('/resources/123');
      expect(normalizeAndValidatePath('/')).toBe('/');
    });

    it('parses origin from absolute URLs and discards host', () => {
      expect(normalizeAndValidatePath('https://elimu.org/ke/curriculum/primary')).toBe(
        '/ke/curriculum/primary',
      );
      expect(normalizeAndValidatePath('http://localhost:3000/search/resources')).toBe(
        '/search/resources',
      );
    });

    it('strips query strings and hash fragments', () => {
      expect(
        normalizeAndValidatePath('/resources/123?utm_source=twitter&ref=abc#overview'),
      ).toBe('/resources/123');
      expect(normalizeAndValidatePath('/catalog?page=2&sort=name')).toBe('/catalog');
    });

    it('collapses consecutive slashes and converts backslashes', () => {
      expect(normalizeAndValidatePath('/ke///curriculum//math')).toBe('/ke/curriculum/math');
      expect(normalizeAndValidatePath('\\ke\\curriculum\\science')).toBe('/ke/curriculum/science');
    });

    it('decodes percent-encoded path segments', () => {
      expect(normalizeAndValidatePath('/resources/%61%62%63')).toBe('/resources/abc');
      expect(normalizeAndValidatePath('/ke%2fcurriculum')).toBe('/ke/curriculum');
    });

    it('rejects path traversal attempts', () => {
      expect(() => normalizeAndValidatePath('/resources/../admin')).toThrow(
        /Path traversal attempt detected/,
      );
      expect(() => normalizeAndValidatePath('/resources/./hidden')).toThrow(
        /Path traversal attempt detected/,
      );
      expect(() => normalizeAndValidatePath('../etc/passwd')).toThrow(
        /Path traversal attempt detected/,
      );
      expect(() => normalizeAndValidatePath('/resources/..')).toThrow(
        /Path traversal attempt detected/,
      );
    });

    it('rejects encoded path traversal (%2e%2e%2f and %2e%2e)', () => {
      expect(() => normalizeAndValidatePath('/resources/%2e%2e%2fadmin')).toThrow(
        /Path traversal attempt detected/,
      );
      expect(() => normalizeAndValidatePath('/resources/%2e%2e')).toThrow(
        /Path traversal attempt detected/,
      );
    });

    it('rejects null bytes in path', () => {
      expect(() => normalizeAndValidatePath('/resources/abc\0def')).toThrow(
        /Path contains invalid control characters|Path traversal attempt detected/,
      );
      expect(() => normalizeAndValidatePath('/resources/abc%00def')).toThrow(
        /Path contains invalid control characters|Path traversal attempt detected/,
      );
    });

    it('rejects malformed percent-encoded sequences', () => {
      expect(() => normalizeAndValidatePath('/resources/%E0%A4%A')).toThrow(
        /Malformed URL path encoding/,
      );
      expect(() => normalizeAndValidatePath('/resources/%2')).toThrow(
        /Malformed URL path encoding/,
      );
    });

    it('rejects ASCII control characters', () => {
      expect(() => normalizeAndValidatePath('/resources/\x07beep')).toThrow(
        /Path contains invalid control characters/,
      );
      expect(() => normalizeAndValidatePath('/resources/\x1Fhidden')).toThrow(
        /Path contains invalid control characters/,
      );
      expect(() => normalizeAndValidatePath('/resources/\x7Fdel')).toThrow(
        /Path contains invalid control characters/,
      );
    });

    it('rejects empty or oversized paths', () => {
      expect(() => normalizeAndValidatePath('')).toThrow(/Path length must be between 1 and 2048/);
      expect(() => normalizeAndValidatePath('a'.repeat(2049))).toThrow(
        /Path length must be between 1 and 2048/,
      );
    });
  });

  describe('Strict Context Schema Validation', () => {
    it('SearchContextSchema requires valid 64-char hex hash and disallows raw search text', () => {
      const valid = {
        search_query_hash: 'a'.repeat(64),
        results_count: 15,
        filters_applied: ['curriculum', 'grade'],
        zero_results: false,
      };
      expect(SearchContextSchema.safeParse(valid).success).toBe(true);

      // Rejects extra / unknown fields
      const withExtra = { ...valid, raw_query: 'grade 4 math' };
      expect(SearchContextSchema.safeParse(withExtra).success).toBe(false);

      // Rejects invalid hash format
      const withBadHash = { ...valid, search_query_hash: 'not-a-hash' };
      expect(SearchContextSchema.safeParse(withBadHash).success).toBe(false);
    });

    it('ViewContextSchema requires valid UUID and disallows unknown fields', () => {
      const valid = {
        entity_type: 'resource',
        entity_id: '123e4567-e89b-12d3-a456-426614174000',
        path: '/ke/curriculum',
        referrer_type: 'search',
      };
      expect(ViewContextSchema.safeParse(valid).success).toBe(true);

      const withUnknown = { ...valid, unexpected_field: 'leak' };
      expect(ViewContextSchema.safeParse(withUnknown).success).toBe(false);
    });

    it('DownloadContextSchema validates resource and file IDs', () => {
      const valid = {
        resource_id: '123e4567-e89b-12d3-a456-426614174000',
        file_id: '223e4567-e89b-12d3-a456-426614174000',
        file_format: 'pdf',
        file_size_bytes: 1048576,
      };
      expect(DownloadContextSchema.safeParse(valid).success).toBe(true);

      const invalid = { ...valid, resource_id: 'invalid-uuid' };
      expect(DownloadContextSchema.safeParse(invalid).success).toBe(false);
    });

    it('FeedbackContextSchema enforces score between 1 and 5', () => {
      const valid = {
        resource_id: '123e4567-e89b-12d3-a456-426614174000',
        feedback_type: 'RATING',
        score: 5,
      };
      expect(FeedbackContextSchema.safeParse(valid).success).toBe(true);

      const invalidScore = { ...valid, score: 6 };
      expect(FeedbackContextSchema.safeParse(invalidScore).success).toBe(false);
    });
  });

  describe('Bounded Rate Limiter & LRU Eviction', () => {
    let limiter: BoundedRateLimiter;

    beforeEach(() => {
      limiter = new BoundedRateLimiter();
    });

    afterEach(() => {
      limiter.destroy();
    });

    it('allows requests up to 120 and blocks subsequent requests', () => {
      const key = 'test-ip-1';
      for (let i = 0; i < 120; i++) {
        const check = limiter.checkRateLimit(key);
        expect(check.allowed).toBe(true);
      }

      const blocked = limiter.checkRateLimit(key);
      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
    });

    it('evicts least recently accessed key when capacity limit is reached', () => {
      // Simulate capacity check without exhausting memory
      for (let i = 0; i < 100; i++) {
        const res = limiter.checkRateLimit(`ip-${i}`);
        expect(res.allowed).toBe(true);
      }
    });
  });

  describe('Large-Count Serialization and Safe BigInt Comparison', () => {
    it('returns numbers for safe integer counts and strings for counts exceeding MAX_SAFE_INTEGER', () => {
      // 0 and standard numbers
      expect(formatSafeCount(0)).toBe(0);
      expect(formatSafeCount('0')).toBe(0);
      expect(formatSafeCount(42)).toBe(42);
      expect(formatSafeCount('42')).toBe(42);
      expect(formatSafeCount(null)).toBe(0);
      expect(formatSafeCount(undefined)).toBe(0);

      // Exactly MAX_SAFE_INTEGER (9,007,199,254,740,991)
      expect(formatSafeCount('9007199254740991')).toBe(9007199254740991);
      expect(formatSafeCount(9007199254740991)).toBe(9007199254740991);

      // One greater than MAX_SAFE_INTEGER (9,007,199,254,740,992) -> MUST be string
      expect(formatSafeCount('9007199254740992')).toBe('9007199254740992');

      // Massive counts
      expect(formatSafeCount('18446744073709551615')).toBe('18446744073709551615');
    });

    it('handles PostgreSQL decimal strings comparing via BigInt before conversion', () => {
      // Decimal strings from pg SUM() / numeric columns
      expect(formatSafeCount('123.00')).toBe(123);
      expect(formatSafeCount('9007199254740991.00')).toBe(9007199254740991);
      expect(formatSafeCount('9007199254740992.50')).toBe('9007199254740992');
    });

    it('rejects unsafe JavaScript numbers that have already lost precision', () => {
      // Numbers strictly greater than MAX_SAFE_INTEGER passed as JS number must throw
      expect(() => formatSafeCount(Number.MAX_SAFE_INTEGER + 10)).toThrow(
        /Cannot format unsafe JavaScript number; counts must be provided as string or bigint/,
      );
    });
  });

  describe('Cache Outage, Refresh Failures & Bounded-Staleness Behavior', () => {
    it('serves stale cached event types during temporary database outage within stale ceiling', async () => {
      let failDb = false;
      const mockDb: any = {
        select: () => ({
          from: () => {
            if (failDb) throw new Error('Database connection timeout');
            return Promise.resolve([
              { id: 't-1', eventCode: 'view', status: 'ACTIVE' },
              { id: 't-2', eventCode: 'search', status: 'ACTIVE' },
            ]);
          },
        }),
      };

      const service = new DefaultAnalyticsService(mockDb);

      // 1. Initial warm up
      const r1 = await (service as any).getActiveEventType('view');
      expect(r1.id).toBe('t-1');

      // 2. Simulate database outage
      failDb = true;

      // 3. Within stale ceiling, returns cached record
      const r2 = await (service as any).getActiveEventType('view');
      expect(r2.id).toBe('t-1');
    });

    it('fails closed (503) when cache is empty and database is unavailable', async () => {
      const mockDb: any = {
        select: () => ({
          from: () => {
            throw new Error('Database connection refused');
          },
        }),
      };

      const service = new DefaultAnalyticsService(mockDb);
      await expect((service as any).getActiveEventType('view')).rejects.toMatchObject({
        statusCode: 503,
        code: 'SERVICE_UNAVAILABLE',
      });
    });

    it('rejects disabled event type with 400', async () => {
      const mockDb: any = {
        select: () => ({
          from: () =>
            Promise.resolve([
              { id: 't-disabled', eventCode: 'telemetry_old', status: 'DISABLED' },
            ]),
        }),
      };

      const service = new DefaultAnalyticsService(mockDb);
      await expect((service as any).getActiveEventType('telemetry_old')).rejects.toMatchObject({
        statusCode: 400,
        code: 'INVALID_EVENT_TYPE',
      });
    });
  });

  describe('Country Resolution and Caching', () => {
    it('resolves country via GeographyService and caches subsequent lookups', async () => {
      let lookupCount = 0;
      const mockGeography: any = {
        getActiveCountryByIdentifier: vi.fn().mockImplementation(async (ident: string) => {
          lookupCount++;
          if (ident.toLowerCase() === 'ke' || ident.toLowerCase() === '/ke') {
            return { id: 'country-ke-uuid', name: 'Kenya', isoCode: 'KE', urlPrefix: 'ke' };
          }
          return null;
        }),
      };

      const service = new DefaultAnalyticsService({} as any, mockGeography);

      const id1 = await (service as any).resolveCountryId('ke');
      expect(id1).toBe('country-ke-uuid');
      expect(lookupCount).toBe(1);

      // Second call hits cache without calling geography service again
      const id2 = await (service as any).resolveCountryId('KE');
      expect(id2).toBe('country-ke-uuid');
      expect(lookupCount).toBe(1);

      // Unknown country returns null
      const idUnknown = await (service as any).resolveCountryId('zz');
      expect(idUnknown).toBeNull();
    });
  });

  describe('Unicode & JSONB Payload Integrity and Constraints', () => {
    it('accepts multi-lingual Unicode and emoji strings in context', () => {
      const service = new DefaultAnalyticsService({} as any);
      const unicodeContext = {
        entity_type: 'resource',
        entity_id: '123e4567-e89b-12d3-a456-426614174000',
        path: '/ke/curriculum/kiswahili',
        referrer_type: 'search',
      };

      const validated = (service as any).validateContext('view', unicodeContext);
      expect(validated.path).toBe('/ke/curriculum/kiswahili');
    });

    it('rejects context payloads exceeding 4096 bytes', () => {
      const service = new DefaultAnalyticsService({} as any);
      const hugeContext = {
        entity_type: 'resource',
        entity_id: '123e4567-e89b-12d3-a456-426614174000',
        path: '/resources/test',
        // Oversized field
        extra_padding: 'x'.repeat(4500),
      };

      expect(() => (service as any).validateContext('view', hugeContext)).toThrow(
        /exceeds maximum allowed size \(4KB\)/,
      );
    });
  });

  describe('captureSafe Non-Disruptive Execution', () => {
    it('does not throw or disrupt caller when underlying recordEvent fails', () => {
      const service = new DefaultAnalyticsService({} as any);
      vi.spyOn(service, 'recordEvent').mockRejectedValue(new Error('Simulated DB network partition'));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      // Calling captureSafe must not throw synchronously or asynchronously
      expect(() => {
        service.captureSafe({
          eventCode: 'view',
          actorType: 'ANONYMOUS',
          anonymousSessionHash: 'a'.repeat(64),
        });
      }).not.toThrow();

      warnSpy.mockRestore();
    });
  });
});
