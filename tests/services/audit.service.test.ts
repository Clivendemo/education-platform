import { describe, it, expect } from 'vitest';
import {
  validateAndSanitizeContext,
  validateAndSanitizeActorSnapshot,
  MAX_AUDIT_CONTEXT_BYTES,
  MAX_ACTOR_SNAPSHOT_BYTES,
} from '../../src/services/audit.service.js';
import {
  REDACTED_LITERAL,
  AUDIT_CONTEXT_SOFT_TARGET_BYTES,
  ACTOR_SNAPSHOT_SOFT_TARGET_BYTES,
  estimatePgJsonbTextBytesUpperBound,
} from '../../src/utils/log-redactor.js';

describe('AuditService Unit Tests', () => {
  describe('Context Validation, Recursive Redaction & Deterministic Compaction', () => {
    it('returns empty object when context is undefined', () => {
      expect(validateAndSanitizeContext(undefined)).toEqual({});
    });

    it('retains safe context properties including false-positive allowlist counters', () => {
      const input = {
        resourceId: '123',
        actionType: 'PUBLISH',
        category: 'CBC',
        tokenCount: 42,
        millitokens: 5000,
      };
      const output = validateAndSanitizeContext(input);
      expect(output).toEqual(input);
    });

    it('recursively replaces sensitive auth tokens and credentials with [REDACTED]', () => {
      const input = {
        resourceId: 'abc',
        password: 'my-secret-password',
        sessionToken: 'xyz-token',
        userSecret: 'keep-it-hidden',
        authorization: 'Bearer token-123',
        cookie: 'sessionId=abc',
        refreshToken: 'refresh-999',
        nested: {
          apiKey: 'sk-live-secret',
        },
      };
      const output = validateAndSanitizeContext(input);
      expect(output).toEqual({
        resourceId: 'abc',
        password: REDACTED_LITERAL,
        sessionToken: REDACTED_LITERAL,
        userSecret: REDACTED_LITERAL,
        authorization: REDACTED_LITERAL,
        cookie: REDACTED_LITERAL,
        refreshToken: REDACTED_LITERAL,
        nested: {
          apiKey: REDACTED_LITERAL,
        },
      });
    });

    it('deterministically compacts context payloads exceeding 3,800 bytes without throwing', () => {
      const largePayload = {
        requestId: 'req-oversized-1',
        data: 'x'.repeat(MAX_AUDIT_CONTEXT_BYTES + 20_000),
      };
      const compacted = validateAndSanitizeContext(largePayload);
      expect(compacted._truncated).toBe(true);
      expect(compacted.requestId).toBe('req-oversized-1');
      expect(estimatePgJsonbTextBytesUpperBound(compacted)).toBeLessThanOrEqual(
        AUDIT_CONTEXT_SOFT_TARGET_BYTES,
      );
      expect(Buffer.byteLength(JSON.stringify(compacted), 'utf8')).toBeLessThan(
        MAX_AUDIT_CONTEXT_BYTES,
      );
    });
  });

  describe('Actor Snapshot Validation, Redaction & Deterministic Compaction', () => {
    it('defaults to SYSTEM actor if snapshot is undefined', () => {
      expect(validateAndSanitizeActorSnapshot(undefined)).toEqual({ actorType: 'SYSTEM' });
    });

    it('preserves essential non-PII identity attributes', () => {
      const input = {
        actorId: 'user-uuid-123',
        actorType: 'AUTHENTICATED' as const,
        actorRole: 'system_admin',
        emailDomain: 'elimu.org',
      };
      const output = validateAndSanitizeActorSnapshot(input);
      expect(output).toEqual(input);
    });

    it('deterministically compacts actor snapshots exceeding 1,900 bytes without throwing', () => {
      const oversized = {
        actorId: 'user-uuid',
        actorType: 'AUTHENTICATED' as const,
        actorRole: 'r'.repeat(MAX_ACTOR_SNAPSHOT_BYTES + 5_000),
      };
      const compacted = validateAndSanitizeActorSnapshot(oversized);
      expect(compacted._truncated).toBe(true);
      expect(compacted.actorType).toBe('AUTHENTICATED');
      expect(estimatePgJsonbTextBytesUpperBound(compacted)).toBeLessThanOrEqual(
        ACTOR_SNAPSHOT_SOFT_TARGET_BYTES,
      );
      expect(Buffer.byteLength(JSON.stringify(compacted), 'utf8')).toBeLessThan(
        MAX_ACTOR_SNAPSHOT_BYTES,
      );
    });
  });
});

