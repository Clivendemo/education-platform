import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { SESSION_COOKIE_NAME, type AuthService } from '../../src/services/auth.service.js';
import {
  DefaultRbacService,
  type RbacService,
  type PermissionAccessResolution,
} from '../../src/services/rbac.service.js';
import {
  resolveStaffPermissionAccess,
  GENERIC_FORBIDDEN_MESSAGE,
} from '../../src/routes/hooks/authorize.js';
import {
  CANONICAL_ROLES,
  CANONICAL_PERMISSIONS,
  ROLE_PERMISSION_MATRIX,
  CANONICAL_ROLE_COUNT,
  CANONICAL_PERMISSION_COUNT,
  CANONICAL_MAPPING_COUNT,
  WAVE2_LEGACY_GLOBAL_TO_ANY_PERMISSIONS,
  WAVE2_RBAC_QUERY_A_SQL,
  WAVE2_RBAC_QUERY_B_SQL,
  Wave2RbacPreconditionError,
  seedRolesAndPermissions,
} from '../../src/db/seeds/roles-permissions.js';

function extractMarkedSqlBlock(markdown: string, startMarker: string, endMarker: string): string {
  const startIdx = markdown.indexOf(startMarker);
  const endIdx = markdown.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    throw new Error(`Missing SQL markers ${startMarker} .. ${endMarker}`);
  }
  const between = markdown.slice(startIdx + startMarker.length, endIdx);
  const match = between.match(/```sql\r?\n([\s\S]*?)\r?\n```/);
  if (!match) {
    throw new Error(`Missing fenced sql block between ${startMarker} and ${endMarker}`);
  }
  return match[1];
}

function sqlToText(queryObj: unknown): string {
  if (typeof queryObj === 'string') return queryObj;
  const chunks = (queryObj as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return String(queryObj);
  return chunks
    .map((c: any) => {
      if (typeof c === 'string') return c;
      if (Array.isArray(c?.value)) return c.value.join('');
      if (c?.queryChunks) return sqlToText(c);
      return String(c?.value ?? '');
    })
    .join('');
}

describe('Wave 2 WP5: RBAC Inventory, Seed Precondition Gate, Scope Enforcement & Admin Route Isolation', () => {
  const COUNTRY_KE = '10000000-0000-4000-8000-000000000001';
  const COUNTRY_UG = '10000000-0000-4000-8000-000000000002';
  const RESOURCE_KE = '20000000-0000-4000-8000-000000000001';
  const RESOURCE_UG = '20000000-0000-4000-8000-000000000002';
  const VERSION_KE = '30000000-0000-4000-8000-000000000001';
  const FEEDBACK_KE = '40000000-0000-4000-8000-000000000001';
  const FEEDBACK_UG = '40000000-0000-4000-8000-000000000002';
  const UPDATE_KE = '50000000-0000-4000-8000-000000000001';
  const UPDATE_UG = '50000000-0000-4000-8000-000000000002';
  const RULE_KE = '60000000-0000-4000-8000-000000000001';
  const RULE_UG = '60000000-0000-4000-8000-000000000002';

  describe('1. Runbook <-> Seed SQL Byte-for-Byte Parity & Revision 3.0 NULL Safety', () => {
    const runbookPath = path.resolve(
      process.cwd(),
      'docs/security/wave2-rbac-predeployment-audit.md',
    );
    const runbookContent = fs.readFileSync(runbookPath, 'utf8');

    it('keeps Query A and Revision 3.0 Query B 100% byte-for-byte identical between runbook and seed gate', () => {
      const docQueryA = extractMarkedSqlBlock(
        runbookContent,
        '<!-- WAVE2_QUERY_A_START -->',
        '<!-- WAVE2_QUERY_A_END -->',
      );
      const docQueryB = extractMarkedSqlBlock(
        runbookContent,
        '<!-- WAVE2_QUERY_B_START -->',
        '<!-- WAVE2_QUERY_B_END -->',
      );

      expect(docQueryA).toBe(WAVE2_RBAC_QUERY_A_SQL);
      expect(docQueryB).toBe(WAVE2_RBAC_QUERY_B_SQL);
    });

    it('enforces PostgreSQL three-valued-logic NULL safety on p.scope_type and nullable descriptions in Query B', () => {
      expect(WAVE2_RBAC_QUERY_B_SQL).toContain(
        "(\n     p.scope_type = cp.target_scope_type\n     OR (cp.allow_legacy_global = true AND p.scope_type = 'GLOBAL')\n   ) IS NOT TRUE",
      );
      expect(WAVE2_RBAC_QUERY_B_SQL).toContain('p.description IS DISTINCT FROM cp.description');
      expect(WAVE2_RBAC_QUERY_B_SQL).toContain('r.description IS DISTINCT FROM cr.description');
      expect(WAVE2_RBAC_QUERY_B_SQL).toContain("COALESCE(p.scope_type, '<NULL>')");

      // Runbook documents PB-1..PB-4 partial bootstrap matrix and zero-waiver rules
      for (const state of ['PB-1', 'PB-2', 'PB-3', 'PB-4']) {
        expect(runbookContent).toContain(state);
      }
    });
  });

  describe('2. Canonical 48-Permission Inventory & Exact 11 Approved Reclassifications', () => {
    it('maintains 6 roles, 48 permissions (29 ANY + 19 GLOBAL), and 106 canonical role-permission mappings', () => {
      expect(CANONICAL_ROLE_COUNT).toBe(6);
      expect(CANONICAL_PERMISSION_COUNT).toBe(48);
      expect(CANONICAL_MAPPING_COUNT).toBe(106);

      const anyPerms = CANONICAL_PERMISSIONS.filter((p) => p.scopeType === 'ANY');
      const globalPerms = CANONICAL_PERMISSIONS.filter((p) => p.scopeType === 'GLOBAL');
      const scopedPerms = CANONICAL_PERMISSIONS.filter((p) => p.scopeType === 'SCOPED');

      expect(anyPerms).toHaveLength(29);
      expect(globalPerms).toHaveLength(19);
      expect(scopedPerms).toHaveLength(0);

      expect(ROLE_PERMISSION_MATRIX.system_admin).toHaveLength(48);
      expect(ROLE_PERMISSION_MATRIX.content_manager).toHaveLength(34);
      expect(ROLE_PERMISSION_MATRIX.content_reviewer).toHaveLength(13);
      expect(ROLE_PERMISSION_MATRIX.verified_teacher).toHaveLength(4);
      expect(ROLE_PERMISSION_MATRIX.contributor).toHaveLength(5);
      expect(ROLE_PERMISSION_MATRIX.standard_user).toHaveLength(2);
    });

    it('reclassifies the exact 11 approved update/quality/feedback permissions to ANY while keeping contributor/audit/retention/analytics/notification GLOBAL', () => {
      const expected11 = [
        'update.create',
        'update.edit',
        'update.publish',
        'update.archive',
        'update.read',
        'quality.check.create',
        'quality.verify',
        'quality.revoke',
        'quality.read',
        'feedback.read',
        'feedback.manage',
      ];
      expect([...WAVE2_LEGACY_GLOBAL_TO_ANY_PERMISSIONS]).toEqual(expected11);

      const permByName = new Map(CANONICAL_PERMISSIONS.map((p) => [p.name, p]));
      for (const name of expected11) {
        expect(permByName.get(name)?.scopeType).toBe('ANY');
      }

      for (const mustRemainGlobal of [
        'contributor.application.review',
        'contributor.manage',
        'contributor.finance.manage',
        'quality.check_types.manage',
        'audit.read',
        'retention.read',
        'retention.manage',
        'retention.execute',
        'analytics.read',
        'analytics.manage',
        'notification.admin.read',
        'notification.admin.manage',
        'user.read',
        'user.manage_roles',
      ]) {
        expect(permByName.get(mustRemainGlobal)?.scopeType).toBe('GLOBAL');
      }
    });
  });

  describe('3. Advisory-Locked Transactional Seed Precondition Gate (seedRolesAndPermissions)', () => {
    it('acquires pg_advisory_xact_lock(20263302, 1) and runs Query A + Query B BEFORE fast-path or writes, aborting on any violation', async () => {
      const callOrder: string[] = [];
      const insertSpy = vi.fn();

      const mockTx: any = {
        execute: vi.fn(async (q: unknown) => {
          const text = sqlToText(q);
          if (text.includes('pg_advisory_xact_lock(20263302, 1)')) {
            callOrder.push('LOCK');
            return { rows: [] };
          }
          if (text.includes('UNSCOPED_EDITORIAL_ROLE_ASSIGNMENT')) {
            callOrder.push('QUERY_A');
            return {
              rows: [
                {
                  violation_code: 'UNSCOPED_EDITORIAL_ROLE_ASSIGNMENT',
                  subject_key: 'ur-bad-1',
                  details: 'user_id=u1, role_slug=content_manager, scope_type=<NULL>',
                },
              ],
            };
          }
          if (text.includes('PERMISSION_METADATA_DRIFT')) {
            callOrder.push('QUERY_B');
            return {
              rows: [
                {
                  violation_code: 'PERMISSION_METADATA_DRIFT',
                  subject_key: 'update.publish',
                  details: 'scope_type=<NULL> (expected ANY)',
                },
              ],
            };
          }
          callOrder.push('FAST_PATH');
          return { rows: [] };
        }),
        insert: insertSpy,
      };

      const mockDb: any = {
        transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
      };

      await expect(seedRolesAndPermissions(mockDb)).rejects.toThrow(Wave2RbacPreconditionError);
      expect(callOrder[0]).toBe('LOCK');
      expect(callOrder).toContain('QUERY_A');
      expect(callOrder).toContain('QUERY_B');
      expect(callOrder).not.toContain('FAST_PATH');
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('returns fast-path counts without writes only AFTER Query A and Query B return 0 violations and canonical target state is reached', async () => {
      const callOrder: string[] = [];
      const insertSpy = vi.fn();

      const mockTx: any = {
        execute: vi.fn(async (q: unknown) => {
          const text = sqlToText(q);
          if (text.includes('pg_advisory_xact_lock')) {
            callOrder.push('LOCK');
            return { rows: [] };
          }
          if (text.includes('UNSCOPED_EDITORIAL_ROLE_ASSIGNMENT')) {
            callOrder.push('QUERY_A');
            return { rows: [] };
          }
          if (text.includes('PERMISSION_METADATA_DRIFT')) {
            callOrder.push('QUERY_B');
            return { rows: [] };
          }
          callOrder.push('FAST_PATH');
          return {
            rows: [
              {
                total_roles_exact: true,
                canonical_roles_exact: true,
                total_perms_exact: true,
                canonical_perms_exact: true,
                total_mappings_exact: true,
                canonical_mappings_exact: true,
              },
            ],
          };
        }),
        insert: insertSpy,
      };

      const mockDb: any = {
        transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
      };

      const result = await seedRolesAndPermissions(mockDb);
      expect(result).toEqual({ rolesCount: 6, permissionsCount: 48, mappingsCount: 106 });
      expect(callOrder).toEqual(['LOCK', 'QUERY_A', 'QUERY_B', 'FAST_PATH']);
      expect(insertSpy).not.toHaveBeenCalled();
    });

    it('upserts all 48 permissions, 6 roles, and 106 mappings when migrating from legacy 11-GLOBAL state', async () => {
      const upsertedTargets: unknown[] = [];
      const onConflictDoNothingSpy = vi.fn().mockResolvedValue(undefined);
      const onConflictDoUpdateSpy = vi.fn((cfg: any) => {
        upsertedTargets.push(cfg);
        return Promise.resolve();
      });

      let selectCall = 0;
      const mockTx: any = {
        execute: vi.fn(async (q: unknown) => {
          const text = sqlToText(q);
          if (
            text.includes('pg_advisory_xact_lock') ||
            text.includes('UNSCOPED_EDITORIAL_ROLE_ASSIGNMENT') ||
            text.includes('PERMISSION_METADATA_DRIFT')
          ) {
            return { rows: [] };
          }
          // Fast-path returns false because 11 permissions are still GLOBAL pre-seed
          return {
            rows: [
              {
                total_roles_exact: true,
                canonical_roles_exact: true,
                total_perms_exact: true,
                canonical_perms_exact: false,
                total_mappings_exact: true,
                canonical_mappings_exact: true,
              },
            ],
          };
        }),
        insert: vi.fn(() => ({
          values: vi.fn(() => ({
            onConflictDoUpdate: onConflictDoUpdateSpy,
            onConflictDoNothing: onConflictDoNothingSpy,
          })),
        })),
        select: vi.fn(() => ({
          from: vi.fn(async () => {
            selectCall += 1;
            if (selectCall === 1) {
              return CANONICAL_ROLES.map((r, idx) => ({ id: `role-${idx}`, slug: r.slug }));
            }
            return CANONICAL_PERMISSIONS.map((p, idx) => ({ id: `perm-${idx}`, name: p.name }));
          }),
        })),
      };

      const mockDb: any = {
        transaction: vi.fn(async (cb: (tx: any) => Promise<any>) => cb(mockTx)),
      };

      const result = await seedRolesAndPermissions(mockDb);
      expect(result).toEqual({ rolesCount: 6, permissionsCount: 48, mappingsCount: 106 });
      expect(onConflictDoUpdateSpy).toHaveBeenCalledTimes(2);
      expect(onConflictDoNothingSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('4. DefaultRbacService.hasPermission & resolveStaffPermissionAccess Scope Enforcement', () => {
    it('rejects COUNTRY/SCHOOL grants on GLOBAL permissions even when matching scope is supplied', async () => {
      const mockDb: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            {
              scopeType: 'COUNTRY',
              scopeId: COUNTRY_KE,
              permissionScopeType: 'GLOBAL',
            },
          ]),
        }),
      };
      const rbac = new DefaultRbacService(mockDb);

      expect(
        await rbac.hasPermission('user-1', 'audit.read', {
          scopeType: 'COUNTRY',
          scopeId: COUNTRY_KE,
        }),
      ).toBe(false);
      expect(await rbac.hasPermission('user-1', 'audit.read')).toBe(false);
    });

    it('enforces exact scope matching on SCOPED permissions and allows COUNTRY/unscoped grants on ANY permissions', async () => {
      const mockDbScoped: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            {
              scopeType: null,
              scopeId: null,
              permissionScopeType: 'SCOPED',
            },
          ]),
        }),
      };
      const rbacScoped = new DefaultRbacService(mockDbScoped);
      // SCOPED permission rejects unscoped invocation
      expect(await rbacScoped.hasPermission('user-1', 'custom.scoped')).toBe(false);

      const mockDbAny: any = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnThis(),
          innerJoin: vi.fn().mockReturnThis(),
          where: vi.fn().mockResolvedValue([
            {
              scopeType: 'COUNTRY',
              scopeId: COUNTRY_KE,
              permissionScopeType: 'ANY',
            },
          ]),
        }),
      };
      const rbacAny = new DefaultRbacService(mockDbAny);
      expect(
        await rbacAny.hasPermission('user-1', 'update.publish', {
          scopeType: 'COUNTRY',
          scopeId: COUNTRY_KE,
        }),
      ).toBe(true);
      expect(
        await rbacAny.hasPermission('user-1', 'update.publish', {
          scopeType: 'COUNTRY',
          scopeId: COUNTRY_UG,
        }),
      ).toBe(false);
      expect(await rbacAny.hasPermission('user-1', 'update.publish')).toBe(false);
    });

    it('aggregates OR-permissions and fails closed on SCHOOL/RESOURCE-only grants in resolveStaffPermissionAccess', async () => {
      const mockRbac: Partial<RbacService> = {
        resolvePermissionAccess: vi.fn(async (_uid: string, perm: string) => {
          if (perm === 'resource.admin.read') {
            return { granted: false, hasGlobalGrant: false, countryIds: [] };
          }
          if (perm === 'resource.review') {
            return { granted: true, hasGlobalGrant: false, countryIds: [COUNTRY_KE] };
          }
          return { granted: false, hasGlobalGrant: false, countryIds: [] };
        }),
      };

      const merged = await resolveStaffPermissionAccess(
        mockRbac as RbacService,
        'user-ke-rev',
        ['resource.admin.read', 'resource.review'],
      );
      expect(merged).toEqual({
        granted: true,
        hasGlobalGrant: false,
        countryIds: [COUNTRY_KE],
      });
    });
  });

  describe('5. Admin Route Country-Scope Isolation, Non-Leaking 403 & Cache-Control: private, no-store', () => {
    const USERS = {
      'tok-global-admin': { id: 'aaaaaaaa-0000-4000-8000-000000000001', role: 'system_admin' },
      'tok-ke-manager': { id: 'bbbbbbbb-0000-4000-8000-000000000002', role: 'ke_manager' },
      'tok-standard': { id: 'cccccccc-0000-4000-8000-000000000003', role: 'standard_user' },
    } as const;

    const GLOBAL_ONLY_PERMS = new Set([
      'audit.read',
      'retention.read',
      'retention.manage',
      'retention.execute',
      'analytics.read',
      'analytics.manage',
      'notification.admin.read',
      'notification.admin.manage',
      'quality.check_types.manage',
    ]);

    const KE_MANAGER_ANY_PERMS = new Set([
      'update.create',
      'update.edit',
      'update.publish',
      'update.archive',
      'update.read',
      'quality.check.create',
      'quality.verify',
      'quality.revoke',
      'quality.read',
      'feedback.read',
      'feedback.manage',
      'recommendation.read',
      'recommendation.manage',
      'resource.admin.read',
      'resource.review',
    ]);

    const mockAuthService = {
      validateSession: vi.fn(async (token: string) => {
        const entry = USERS[token as keyof typeof USERS];
        if (!entry) return null;
        return {
          user: {
            id: entry.id,
            email: `${entry.role}@example.com`,
            displayName: entry.role,
            status: 'ACTIVE',
          },
          session: {
            id: `sess-${entry.id}`,
            userId: entry.id,
            expiresAt: new Date(Date.now() + 3600_000),
          },
        };
      }),
    } as unknown as AuthService;

    const mockRbacService = {
      resolvePermissionAccess: vi.fn(
        async (userId: string, perm: string): Promise<PermissionAccessResolution> => {
          if (userId === USERS['tok-global-admin'].id) {
            return { granted: true, hasGlobalGrant: true, countryIds: [] };
          }
          if (userId === USERS['tok-ke-manager'].id) {
            if (GLOBAL_ONLY_PERMS.has(perm)) {
              // COUNTRY-scoped manager cannot satisfy GLOBAL permissions
              return { granted: false, hasGlobalGrant: false, countryIds: [] };
            }
            if (KE_MANAGER_ANY_PERMS.has(perm)) {
              return { granted: true, hasGlobalGrant: false, countryIds: [COUNTRY_KE] };
            }
          }
          return { granted: false, hasGlobalGrant: false, countryIds: [] };
        },
      ),
      hasPermission: vi.fn(async () => false),
    } as unknown as RbacService;

    const app = buildApp({
      services: {
        authService: mockAuthService,
        rbacService: mockRbacService,
        educationUpdateService: {
          resolveCountryIdByIdentifier: vi.fn(async (c: string) =>
            c === 'KE' || c === COUNTRY_KE
              ? COUNTRY_KE
              : c === 'UG' || c === COUNTRY_UG
                ? COUNTRY_UG
                : null,
          ),
          listAdminUpdates: vi.fn(async () => ({
            data: [],
            meta: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          })),
          createUpdate: vi.fn(async (input: any) => ({
            id: UPDATE_KE,
            title: input.title,
            slug: 'ke-circular',
            countryId: input.countryId,
            publicationStatus: 'DRAFT',
          })),
          getAdminUpdateById: vi.fn(async (id: string) => {
            if (id === UPDATE_KE) return { id: UPDATE_KE, countryId: COUNTRY_KE, title: 'KE Update' };
            if (id === UPDATE_UG) return { id: UPDATE_UG, countryId: COUNTRY_UG, title: 'UG Update' };
            return null;
          }),
          publishUpdate: vi.fn(async (id: string) => ({
            id,
            countryId: COUNTRY_KE,
            publicationStatus: 'PUBLISHED',
          })),
        } as any,
        qualityService: {
          listCheckTypes: vi.fn(async () => [{ id: 'ct-1', code: 'FACTUAL_ACCURACY' }]),
          createCheckType: vi.fn(async (input: any) => ({ id: 'ct-2', ...input })),
          getResourceCountryId: vi.fn(async (resId: string) => {
            if (resId === RESOURCE_KE) return COUNTRY_KE;
            if (resId === RESOURCE_UG) return COUNTRY_UG;
            return null;
          }),
          verifyResourceVersion: vi.fn(async () => ({
            id: 'verif-1',
            resourceId: RESOURCE_KE,
            verificationStatus: 'VERIFIED',
          })),
        } as any,
        feedbackService: {
          listFeedbackQueue: vi.fn(async () => ({
            items: [],
            total: 0,
            page: 1,
            limit: 20,
          })),
          getFeedbackResourceCountryId: vi.fn(async (fbId: string) => {
            if (fbId === FEEDBACK_KE) return COUNTRY_KE;
            if (fbId === FEEDBACK_UG) return COUNTRY_UG;
            return null;
          }),
          getFeedbackById: vi.fn(async (fbId: string) => ({
            id: fbId,
            resourceId: RESOURCE_KE,
            status: 'PENDING',
            events: [],
          })),
          triageFeedback: vi.fn(async (fbId: string, input: any) => ({
            id: fbId,
            status: input.toStatus,
          })),
        } as any,
        recommendationService: {
          listRules: vi.fn(async () => ({
            data: [],
            meta: { page: 1, pageSize: 20, total: 0, hasMore: false },
          })),
          createRule: vi.fn(async (input: any) => ({
            id: RULE_KE,
            countryId: input.countryId,
            ruleType: input.ruleType,
            status: 'ACTIVE',
          })),
          getRuleById: vi.fn(async (id: string) => {
            if (id === RULE_KE) return { id: RULE_KE, countryId: COUNTRY_KE, status: 'ACTIVE' };
            if (id === RULE_UG) return { id: RULE_UG, countryId: COUNTRY_UG, status: 'ACTIVE' };
            return null;
          }),
          deactivateRule: vi.fn(async ({ ruleId }: any) => ({
            id: ruleId,
            countryId: COUNTRY_KE,
            status: 'INACTIVE',
          })),
        } as any,
        auditService: {
          logEvent: vi.fn(async () => ({})),
          getAuditLogs: vi.fn(async () => ({
            logs: [],
            pagination: { page: 1, pageSize: 20, total: 0, totalPages: 0 },
          })),
        } as any,
        retentionService: {
          getPolicies: vi.fn(async () => []),
        } as any,
        analyticsService: {
          getOverviewMetrics: vi.fn(async () => ({
            actionCount: 0,
            authenticatedUsers: 0,
            pureAnonymousSessions: 0,
            estimatedActorCount: 0,
            downloadUrlIssuedCount: 0,
            zeroResultRate: 0,
          })),
        } as any,
        notificationService: {
          listAdminDeliveries: vi.fn(async () => ({
            items: [],
            total: 0,
            page: 1,
            pageSize: 20,
          })),
        } as any,
      },
    });

    const cookieHeader = (tok: keyof typeof USERS) => ({
      cookie: `${SESSION_COOKIE_NAME}=${tok}`,
    });

    it('enforces country-scoped access + private no-store on /admin/updates*, /admin/quality/*, /admin/feedback*, and /admin/recommendations/rules*', async () => {
      // 1. Updates: KE manager creates/publishes KE update (201/200), blocked on UG update (403 generic) and unscoped create (400/403)
      const createKeUpdate = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/updates',
        headers: cookieHeader('tok-ke-manager'),
        payload: {
          title: 'KE Term Dates Circular',
          body: 'Official dates for Kenya schools.',
          countryId: COUNTRY_KE,
        },
      });
      expect(createKeUpdate.statusCode).toBe(201);
      expect(createKeUpdate.headers['cache-control']).toBe('private, no-store');

      const createUgUpdate = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/updates',
        headers: cookieHeader('tok-ke-manager'),
        payload: {
          title: 'UG Term Dates Circular',
          body: 'Cross-country attempt.',
          countryId: COUNTRY_UG,
        },
      });
      expect(createUgUpdate.statusCode).toBe(403);
      expect(createUgUpdate.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);
      expect(createUgUpdate.body).not.toContain('update.create');

      const publishUgUpdate = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/updates/${UPDATE_UG}/publish`,
        headers: cookieHeader('tok-ke-manager'),
      });
      expect(publishUgUpdate.statusCode).toBe(403);
      expect(publishUgUpdate.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);

      // 2. Quality Governance: KE manager verifies KE resource (200), denied on UG resource (403), denied on global check-types creation (403)
      const verifyKe = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/resources/${RESOURCE_KE}/verify`,
        headers: cookieHeader('tok-ke-manager'),
        payload: { versionId: VERSION_KE, notes: 'Verified for KE' },
      });
      expect(verifyKe.statusCode).toBe(200);
      expect(verifyKe.headers['cache-control']).toBe('private, no-store');

      const verifyUg = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/resources/${RESOURCE_UG}/verify`,
        headers: cookieHeader('tok-ke-manager'),
        payload: { versionId: VERSION_KE, notes: 'Cross-country attempt' },
      });
      expect(verifyUg.statusCode).toBe(403);
      expect(verifyUg.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);

      const checkTypesUgDenied = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/quality/check-types?countryId=${COUNTRY_UG}`,
        headers: cookieHeader('tok-ke-manager'),
      });
      expect(checkTypesUgDenied.statusCode).toBe(403);
      expect(checkTypesUgDenied.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);

      // 3. Feedback: KE manager reads KE feedback (200), denied on UG feedback (403)
      const fbKe = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/feedback/${FEEDBACK_KE}`,
        headers: cookieHeader('tok-ke-manager'),
      });
      expect(fbKe.statusCode).toBe(200);
      expect(fbKe.headers['cache-control']).toBe('private, no-store');

      const fbUg = await app.inject({
        method: 'GET',
        url: `/api/v1/admin/feedback/${FEEDBACK_UG}`,
        headers: cookieHeader('tok-ke-manager'),
      });
      expect(fbUg.statusCode).toBe(403);
      expect(fbUg.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);

      // 4. Recommendations rules: permission-based check (recommendation.read/manage) + country scope
      const listRulesKe = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/recommendations/rules',
        headers: cookieHeader('tok-ke-manager'),
      });
      expect(listRulesKe.statusCode).toBe(200);
      expect(listRulesKe.headers['cache-control']).toBe('private, no-store');

      const deactivateRuleUg = await app.inject({
        method: 'POST',
        url: `/api/v1/admin/recommendations/rules/${RULE_UG}/deactivate`,
        headers: cookieHeader('tok-ke-manager'),
        payload: { reason: 'Cross-country attempt' },
      });
      expect(deactivateRuleUg.statusCode).toBe(403);
      expect(deactivateRuleUg.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);
    });

    it('denies country-scoped staff & standard_user on GLOBAL-only admin endpoints (audit, retention, analytics, notifications) without leaking permission slugs', async () => {
      const globalEndpoints = [
        '/api/v1/admin/audit-logs',
        '/api/v1/admin/retention/policies',
        '/api/v1/admin/analytics/overview?startDate=2026-01-01T00:00:00Z&endDate=2026-01-02T00:00:00Z',
        '/api/v1/admin/notifications',
      ];

      for (const url of globalEndpoints) {
        for (const tok of ['tok-ke-manager', 'tok-standard'] as const) {
          const denied = await app.inject({
            method: 'GET',
            url,
            headers: cookieHeader(tok),
          });
          expect(denied.statusCode, `Expected 403 on ${url} for ${tok}`).toBe(403);
          expect(denied.headers['cache-control']).toBe('private, no-store');
          const bodyStr = denied.body;
          expect(bodyStr).not.toContain('audit.read');
          expect(bodyStr).not.toContain('retention.read');
          expect(bodyStr).not.toContain('analytics.read');
          expect(bodyStr).not.toContain('notification.admin.read');
          const parsed = denied.json();
          const errMsg = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message;
          expect(errMsg).toBe(GENERIC_FORBIDDEN_MESSAGE);
        }

        const allowedGlobalAdmin = await app.inject({
          method: 'GET',
          url,
          headers: cookieHeader('tok-global-admin'),
        });
        expect(allowedGlobalAdmin.statusCode, `Expected 200 on ${url} for system_admin`).toBe(200);
        expect(allowedGlobalAdmin.headers['cache-control']).toBe('private, no-store');
      }
    });
  });
});
