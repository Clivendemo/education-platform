import { describe, it, expect } from 'vitest';
import {
  validateAndSanitizeContext,
  validateAndSanitizeActorSnapshot,
  MAX_AUDIT_CONTEXT_BYTES,
  MAX_ACTOR_SNAPSHOT_BYTES,
  AuditError,
} from '../../src/services/audit.service.js';

describe('AuditService Unit Tests', () => {
  describe('Context Validation & Sanitization', () => {
    it('returns empty object when context is undefined', () => {
      expect(validateAndSanitizeContext(undefined)).toEqual({});
    });

    it('retains safe context properties', () => {
      const input = { resourceId: '123', actionType: 'PUBLISH', category: 'CBC' };
      const output = validateAndSanitizeContext(input);
      expect(output).toEqual(input);
    });

    it('strips sensitive auth tokens and credentials', () => {
      const input = {
        resourceId: 'abc',
        password: 'my-secret-password',
        sessionToken: 'xyz-token',
        userSecret: 'keep-it-hidden',
        authorization: 'Bearer token-123',
        cookie: 'sessionId=abc',
        refreshToken: 'refresh-999',
      };
      const output = validateAndSanitizeContext(input);
      expect(output).toEqual({ resourceId: 'abc' });
      expect(output).not.toHaveProperty('password');
      expect(output).not.toHaveProperty('sessionToken');
      expect(output).not.toHaveProperty('userSecret');
      expect(output).not.toHaveProperty('authorization');
      expect(output).not.toHaveProperty('cookie');
      expect(output).not.toHaveProperty('refreshToken');
    });

    it('rejects context payloads exceeding 4,096 bytes', () => {
      const largePayload = {
        data: 'x'.repeat(MAX_AUDIT_CONTEXT_BYTES + 50),
      };
      expect(() => validateAndSanitizeContext(largePayload)).toThrow(AuditError);
      expect(() => validateAndSanitizeContext(largePayload)).toThrow(
        /Audit context exceeds maximum permitted byte size of 4096 bytes/,
      );
    });
  });

  describe('Actor Snapshot Validation & Sanitization', () => {
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

    it('rejects actor snapshots exceeding 2,048 bytes', () => {
      const oversized = {
        actorId: 'user-uuid',
        actorType: 'AUTHENTICATED' as const,
        actorRole: 'r'.repeat(MAX_ACTOR_SNAPSHOT_BYTES + 100),
      };
      expect(() => validateAndSanitizeActorSnapshot(oversized)).toThrow(AuditError);
      expect(() => validateAndSanitizeActorSnapshot(oversized)).toThrow(
        /Actor snapshot exceeds maximum permitted byte size of 2048 bytes/,
      );
    });
  });
});
