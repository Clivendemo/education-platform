import { describe, it, expect } from 'vitest';
import {
  RETENTION_TARGET_REGISTRY,
  DefaultRetentionService,
} from '../../src/services/retention.service.js';

describe('RetentionService Unit Tests', () => {
  describe('Retention Target Registry & Allowlist', () => {
    it('defines explicit targets with compile-time constants', () => {
      expect(RETENTION_TARGET_REGISTRY.USER_SESSIONS).toBeDefined();
      expect(RETENTION_TARGET_REGISTRY.ANALYTICS_EVENTS).toBeDefined();
      expect(RETENTION_TARGET_REGISTRY.NOTIFICATION_DELIVERIES).toBeDefined();
      expect(RETENTION_TARGET_REGISTRY.FEEDBACK_REPORTS).toBeDefined();
      expect(RETENTION_TARGET_REGISTRY.AUDIT_LOGS).toBeDefined();
    });

    it('marks executable targets correctly', () => {
      expect(RETENTION_TARGET_REGISTRY.USER_SESSIONS.isExecutable).toBe(true);
      expect(RETENTION_TARGET_REGISTRY.ANALYTICS_EVENTS.isExecutable).toBe(true);
      expect(RETENTION_TARGET_REGISTRY.NOTIFICATION_DELIVERIES.isExecutable).toBe(true);
    });

    it('enforces hard governance barriers on feedback anonymization and audit logs', () => {
      expect(RETENTION_TARGET_REGISTRY.FEEDBACK_REPORTS.isExecutable).toBe(false);
      expect(RETENTION_TARGET_REGISTRY.AUDIT_LOGS.isExecutable).toBe(false);

      expect(() => RETENTION_TARGET_REGISTRY.FEEDBACK_REPORTS.buildPredicateSql('$1')).toThrow(
        /FEEDBACK_REPORTS execution blocked by governance constraint/,
      );
      expect(() => RETENTION_TARGET_REGISTRY.AUDIT_LOGS.buildPredicateSql('$1')).toThrow(
        /AUDIT_LOGS archiving unsupported in this milestone/,
      );
    });

    it('generates valid SQL predicates with provided parameter placeholder', () => {
      const sessionPredicate = RETENTION_TARGET_REGISTRY.USER_SESSIONS.buildPredicateSql('$1');
      expect(sessionPredicate).toBe('expires_at < $1 AND expires_at < now()');

      const analyticsPredicate = RETENTION_TARGET_REGISTRY.ANALYTICS_EVENTS.buildPredicateSql('$1');
      expect(analyticsPredicate).toBe('occurred_at < $1');

      const notifPredicate = RETENTION_TARGET_REGISTRY.NOTIFICATION_DELIVERIES.buildPredicateSql('$1');
      expect(notifPredicate).toBe("status IN ('DELIVERED', 'FAILED') AND created_at < $1");
    });
  });

  describe('Policy Validation Business Rules', () => {
    const mockDb = {} as any;
    const service = new DefaultRetentionService(mockDb);

    it('rejects policy creation with non-positive retention duration', async () => {
      await expect(
        service.createPolicy({
          policyCode: 'TEST_0D',
          name: 'Invalid 0 Day Policy',
          dataCategory: 'USER_SESSIONS',
          targetIdentifier: 'identity.user_sessions',
          referencePoint: 'expires_at',
          retentionDurationDays: 0,
          disposition: 'DELETE',
        }),
      ).rejects.toThrow(/Retention duration must be greater than 0 days/);
    });

    it('rejects policy creation for unknown data categories', async () => {
      await expect(
        service.createPolicy({
          policyCode: 'TEST_UNKNOWN',
          name: 'Unknown Category Policy',
          dataCategory: 'CUSTOM_TABLE',
          targetIdentifier: 'custom.table',
          referencePoint: 'created_at',
          retentionDurationDays: 30,
          disposition: 'DELETE',
        }),
      ).rejects.toThrow(/Data category 'CUSTOM_TABLE' is not recognized/);
    });

    it('enforces 7-year platform minimum (2,555 days) for AUDIT_LOGS retention', async () => {
      await expect(
        service.createPolicy({
          policyCode: 'TEST_AUDIT_365D',
          name: 'Short Audit Retention',
          dataCategory: 'AUDIT_LOGS',
          targetIdentifier: 'governance.audit_logs',
          referencePoint: 'occurred_at',
          retentionDurationDays: 365,
          disposition: 'ARCHIVE',
        }),
      ).rejects.toThrow(/AUDIT_LOGS retention must be at least 2,555 days/);
    });

    it('requires a non-empty changeReason when updating a policy', async () => {
      await expect(
        service.updatePolicy('some-uuid', {
          name: 'Updated Name',
          changeReason: '   ',
        }),
      ).rejects.toThrow(/A mandatory changeReason is required/);
    });
  });
});
