import { describe, it, expect } from 'vitest';
import { buildApp } from '../../src/app.js';
import { SESSION_COOKIE_NAME, type AuthService } from '../../src/services/auth.service.js';
import type { RbacService, PermissionAccessResolution } from '../../src/services/rbac.service.js';
import type { AuditService } from '../../src/services/audit.service.js';
import {
  HomepageDatabaseUnavailableError,
  type HomepageService,
} from '../../src/services/homepage.service.js';
import type { HomepageAdminService } from '../../src/services/homepage-admin.service.js';
import type { HomepageAdminOperationCategory } from '../../src/routes/api/v1/admin-homepage.js';

const USER_ID = '11111111-1111-4111-8111-111111111111';
const COUNTRY_KE = '9341c237-f208-4651-875c-894beb2138ef';
const COUNTRY_UG = '22222222-2222-4222-8222-222222222222';
const CFG_UG_ID = '33333333-3333-4333-8333-333333333333';
const CFG_MISSING_ID = '44444444-4444-4444-8444-444444444444';

function makeMockAuthService(): AuthService {
  return {
    validateSession: async (token: string) => {
      if (token === 'valid-session') {
        return {
          user: {
            id: USER_ID,
            email: 'editor@schoolhub.ke',
            fullName: 'KE Editor',
            status: 'ACTIVE',
          },
          session: { id: 'sess-1' },
        } as any;
      }
      return null;
    },
  } as unknown as AuthService;
}

type AuditFailureMode = 'FM-0' | 'FM-1' | 'FM-2' | 'FM-3a' | 'FM-3b';

function buildInstrumentedHarness(params: {
  access: PermissionAccessResolution;
  failureMode: AuditFailureMode;
  countryExistsResult?: boolean;
}) {
  const counts: Record<HomepageAdminOperationCategory, number> = {
    C1: 0,
    C2: 0,
    C3: 0,
    C4: 0,
    C5: 0,
    C6: 0,
  };
  const auditEvents: any[] = [];

  const rbacService: RbacService = {
    resolvePermissionAccess: async () => params.access,
    getUserRoles: async () => {
      if (
        params.failureMode === 'FM-1' ||
        params.failureMode === 'FM-3a' ||
        params.failureMode === 'FM-3b'
      ) {
        throw new Error('Simulated C4 role snapshot failure');
      }
      return [
        {
          id: 'ur-1',
          userId: USER_ID,
          roleId: 'r-1',
          roleSlug: 'content_manager',
          roleName: 'Content Manager',
          roleType: 'SYSTEM',
          scopeType: 'COUNTRY',
          scopeId: COUNTRY_KE,
          status: 'ACTIVE',
          startsAt: null,
          endsAt: null,
          createdBy: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
    },
    hasPermission: async () => {
      throw new Error('hasPermission fallback must never be called by admin homepage routes');
    },
    getUserPermissions: async () => [],
    assignRole: async () => ({}) as any,
    revokeRole: async () => {},
    listRoles: async () => [],
    listPermissions: async () => [],
    getRoleBySlug: async () => null,
  };

  const auditService: AuditService = {
    logEvent: async (input) => {
      if (
        params.failureMode === 'FM-2' ||
        params.failureMode === 'FM-3a' ||
        params.failureMode === 'FM-3b'
      ) {
        throw new Error('Simulated C5 audit insert failure');
      }
      auditEvents.push(input);
      return input as any;
    },
    getAuditLogs: async () => ({
      logs: [],
      pagination: { page: 1, pageSize: 20, totalCount: 0, totalPages: 0 },
    }),
    getAuditLogById: async () => null,
  };

  const homepageAdminService: HomepageAdminService = {
    getConfigurationScopeTarget: async (id: string) => {
      if (id === CFG_UG_ID) {
        return { id: CFG_UG_ID, countryId: COUNTRY_UG, status: 'DRAFT' };
      }
      return null;
    },
    countryExists: async () => params.countryExistsResult ?? true,
    createDraft: async () => {
      throw new Error('C6 createDraft must not execute on denied requests');
    },
    listConfigurations: async () => {
      throw new Error('C6 listConfigurations must not execute on denied requests');
    },
    getConfigurationDetail: async () => {
      throw new Error('C6 getConfigurationDetail must not execute on denied requests');
    },
    updateDraft: async () => {
      throw new Error('C6 updateDraft must not execute on denied requests');
    },
    previewHomepage: async () => {
      throw new Error('C6 previewHomepage must not execute on denied requests');
    },
    scheduleConfiguration: async () => {
      throw new Error('C6 scheduleConfiguration must not execute on denied requests');
    },
    publishConfiguration: async () => {
      throw new Error('C6 publishConfiguration must not execute on denied requests');
    },
    discardDraft: async () => {
      throw new Error('C6 discardDraft must not execute on denied requests');
    },
    rollbackConfiguration: async () => {
      throw new Error('C6 rollbackConfiguration must not execute on denied requests');
    },
  };

  const app = buildApp({
    logger: false,
    services: {
      authService: makeMockAuthService(),
      rbacService,
      auditService,
      homepageAdminService,
      homepageAdminInstrumentation: {
        onOperation: (cat: HomepageAdminOperationCategory) => {
          counts[cat] += 1;
        },
      },
    },
  });

  if (params.failureMode === 'FM-3b') {
    app.addHook('onRequest', async (req) => {
      req.log.error = () => {
        throw new Error('Simulated secondary structured logger failure');
      };
    });
  }

  return { app, counts, auditEvents };
}

describe('Homepage Route Unit Invariants: Cache-Control no-store & Non-Disclosing Denied Audit Matrix', () => {
  describe('T-CACHE-CONTROL-NO-STORE-UNIT (R17-05 across 2xx/4xx/5xx)', () => {
    it('enforces Cache-Control: no-store on public P1/P2 across 200, 400, 503, and 500', async () => {
      let mode: 'ok' | 'unavailable' | 'crash' = 'ok';
      const homepageService: HomepageService = {
        getPublicHomepage: async () => {
          if (mode === 'unavailable') {
            throw new HomepageDatabaseUnavailableError();
          }
          if (mode === 'crash') {
            throw new Error('Unexpected raw boom');
          }
          return {
            data: {
              country: {
                id: COUNTRY_KE,
                name: 'Kenya',
                isoCode: 'KE',
                urlPrefix: 'ke',
                currencyCode: 'KES',
              },
              source: 'DEFAULT_FALLBACK',
              configuration: null,
              evaluatedAt: '2026-10-29T12:00:00.000Z',
              sections: [],
            },
          };
        },
        renderPreview: async () => ({}) as any,
      };

      const app = buildApp({ logger: false, services: { homepageService } });

      // 200 on P1 and P2
      const p1Ok = await app.inject({ method: 'GET', url: '/api/v1/homepage' });
      expect(p1Ok.statusCode).toBe(200);
      expect(p1Ok.headers['cache-control']).toBe('no-store');

      const p2Ok = await app.inject({
        method: 'GET',
        url: '/api/v1/countries/ke/homepage',
      });
      expect(p2Ok.statusCode).toBe(200);
      expect(p2Ok.headers['cache-control']).toBe('no-store');

      // 400 validation error (whitespace not trimmed)
      const p1Bad = await app.inject({
        method: 'GET',
        url: '/api/v1/homepage?country=%20KE',
      });
      expect(p1Bad.statusCode).toBe(400);
      expect(p1Bad.headers['cache-control']).toBe('no-store');

      // 503 database unavailable
      mode = 'unavailable';
      const p1Unavail = await app.inject({
        method: 'GET',
        url: '/api/v1/homepage',
      });
      expect(p1Unavail.statusCode).toBe(503);
      expect(p1Unavail.headers['cache-control']).toBe('no-store');
      expect(p1Unavail.json().error.code).toBe('HOMEPAGE_DATABASE_UNAVAILABLE');

      // 500 unexpected error
      mode = 'crash';
      const p2Crash = await app.inject({
        method: 'GET',
        url: '/api/v1/countries/ke/homepage',
      });
      expect(p2Crash.statusCode).toBe(500);
      expect(p2Crash.headers['cache-control']).toBe('no-store');

      await app.close();
    });

    it('enforces Cache-Control: private, no-store on admin routes across 401, 400, 403, 404, and 500', async () => {
      const { app } = buildInstrumentedHarness({
        access: { granted: true, hasGlobalGrant: false, countryIds: [COUNTRY_KE] },
        failureMode: 'FM-0',
      });

      const unauth = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/homepage',
      });
      expect(unauth.statusCode).toBe(401);
      expect(unauth.headers['cache-control']).toBe('private, no-store');

      const badEval = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/homepage/preview',
        cookies: { [SESSION_COOKIE_NAME]: 'valid-session' },
        payload: { countryId: COUNTRY_KE, evaluateAt: null },
      });
      expect(badEval.statusCode).toBe(400);
      expect(badEval.headers['cache-control']).toBe('private, no-store');
      expect(badEval.json().error.code).toBe('INVALID_EVALUATION_TIMESTAMP');

      await app.close();
    });
  });

  describe('T-DENIED-AUDIT-FAILURE-NON-DISCLOSURE (C49 / C53 / C55 / C58 / C59)', () => {
    const failureModes: AuditFailureMode[] = [
      'FM-0',
      'FM-1',
      'FM-2',
      'FM-3a',
      'FM-3b',
    ];

    const opaqueRouteCases = [
      {
        name: 'A3 GET configuration detail',
        method: 'GET' as const,
        urlFor: (id: string) => `/api/v1/admin/homepage/configurations/${id}`,
      },
      {
        name: 'A4 PATCH draft',
        method: 'PATCH' as const,
        urlFor: (id: string) => `/api/v1/admin/homepage/drafts/${id}`,
        payload: { title: 'Updated Title' },
      },
      {
        name: 'A5 POST preview with configurationId',
        method: 'POST' as const,
        urlFor: () => '/api/v1/admin/homepage/preview',
        payloadFor: (id: string) => ({ configurationId: id }),
      },
      {
        name: 'A6 POST schedule',
        method: 'POST' as const,
        urlFor: (id: string) =>
          `/api/v1/admin/homepage/configurations/${id}/schedule`,
        payload: {
          action: 'SCHEDULE',
          scheduledStartAt: '2027-01-01T00:00:00.000Z',
        },
      },
      {
        name: 'A7 POST publish',
        method: 'POST' as const,
        urlFor: (id: string) =>
          `/api/v1/admin/homepage/configurations/${id}/publish`,
        payload: {},
      },
      {
        name: 'A8 POST discard',
        method: 'POST' as const,
        urlFor: (id: string) => `/api/v1/admin/homepage/drafts/${id}/discard`,
        payload: { reason: 'Obsolete draft configuration' },
      },
    ];

    const explicitCountryCases = [
      {
        name: 'A1 POST create draft',
        method: 'POST' as const,
        url: '/api/v1/admin/homepage/drafts',
        payload: { countryId: COUNTRY_UG, title: 'UG Draft' },
      },
      {
        name: 'A2 GET list with countryId',
        method: 'GET' as const,
        url: `/api/v1/admin/homepage?countryId=${COUNTRY_UG}`,
      },
      {
        name: 'A5 POST preview with countryId only',
        method: 'POST' as const,
        url: '/api/v1/admin/homepage/preview',
        payload: { countryId: COUNTRY_UG },
      },
      {
        name: 'A9 POST rollback',
        method: 'POST' as const,
        url: '/api/v1/admin/homepage/rollback',
        payload: {
          countryId: COUNTRY_UG,
          targetConfigurationId: CFG_UG_ID,
          reason: 'Restore prior editorial configuration',
        },
      },
    ];

    it('returns identical hidden-resource 404 across nonexistent vs cross-country opaque IDs under all FM-0..FM-3b failure modes with C6=0', async () => {
      for (const routeCase of opaqueRouteCases) {
        for (const fm of failureModes) {
          // 1. Cross-country existing ID -> C1=1, C2=1, C3=0, C4=1, C5=1, C6=0 + 404
          const cross = buildInstrumentedHarness({
            access: {
              granted: true,
              hasGlobalGrant: false,
              countryIds: [COUNTRY_KE],
            },
            failureMode: fm,
          });

          const crossRes = await cross.app.inject({
            method: routeCase.method,
            url: routeCase.urlFor(CFG_UG_ID),
            headers: { 'x-request-id': 'fixed-req-id-opaque' },
            cookies: { [SESSION_COOKIE_NAME]: 'valid-session' },
            payload: routeCase.payloadFor
              ? routeCase.payloadFor(CFG_UG_ID)
              : routeCase.payload,
          });

          expect(crossRes.statusCode).toBe(404);
          expect(crossRes.headers['cache-control']).toBe('private, no-store');
          expect(cross.counts).toEqual({
            C1: 1,
            C2: 1,
            C3: 0,
            C4: 1,
            C5: 1,
            C6: 0,
          });

          // FM-1 proves Stage 1 failure degrades actorRole while still persisting DENIED audit in Stage 2!
          if (fm === 'FM-0') {
            expect(cross.auditEvents).toHaveLength(1);
            expect(cross.auditEvents[0].actorSnapshot.actorRole).toBe(
              'content_manager',
            );
          } else if (fm === 'FM-1') {
            expect(cross.auditEvents).toHaveLength(1);
            expect(cross.auditEvents[0].actorSnapshot.actorRole).toBeUndefined();
          }

          // 2. Nonexistent ID -> C1=1, C2=1, C3=0, C4=0, C5=0, C6=0 + byte-identical 404 body
          const missing = buildInstrumentedHarness({
            access: {
              granted: true,
              hasGlobalGrant: false,
              countryIds: [COUNTRY_KE],
            },
            failureMode: fm,
          });

          const missingRes = await missing.app.inject({
            method: routeCase.method,
            url: routeCase.urlFor(CFG_MISSING_ID),
            headers: { 'x-request-id': 'fixed-req-id-opaque' },
            cookies: { [SESSION_COOKIE_NAME]: 'valid-session' },
            payload: routeCase.payloadFor
              ? routeCase.payloadFor(CFG_MISSING_ID)
              : routeCase.payload,
          });

          expect(missingRes.statusCode).toBe(404);
          expect(missing.counts).toEqual({
            C1: 1,
            C2: 1,
            C3: 0,
            C4: 0,
            C5: 0,
            C6: 0,
          });
          expect(crossRes.body).toBe(missingRes.body);

          await cross.app.close();
          await missing.app.close();
        }
      }
    });

    it('returns non-disclosing 403 FORBIDDEN on explicit-country cross-scope and coarse capability denials across FM-0..FM-3b with C6=0', async () => {
      for (const routeCase of explicitCountryCases) {
        for (const fm of failureModes) {
          const h = buildInstrumentedHarness({
            access: {
              granted: true,
              hasGlobalGrant: false,
              countryIds: [COUNTRY_KE],
            },
            failureMode: fm,
            countryExistsResult: false, // Also verifies unverified UUID degrades countryId to null safely
          });

          const res = await h.app.inject({
            method: routeCase.method,
            url: routeCase.url,
            cookies: { [SESSION_COOKIE_NAME]: 'valid-session' },
            payload: routeCase.payload,
          });

          expect(res.statusCode).toBe(403);
          expect(res.headers['cache-control']).toBe('private, no-store');
          expect(res.json().error.code).toBe('FORBIDDEN');
          expect(h.counts).toEqual({
            C1: 1,
            C2: 0,
            C3: 1,
            C4: 1,
            C5: 1,
            C6: 0,
          });

          if (fm === 'FM-0' || fm === 'FM-1') {
            expect(h.auditEvents[0].countryId).toBeNull();
            expect(h.auditEvents[0].context.requestedCountryId).toBe(COUNTRY_UG);
          }

          await h.app.close();
        }
      }

      // Coarse capability denial (!access.granted): C1=1, C2=0, C3=0, C4=1, C5=1, C6=0
      for (const fm of failureModes) {
        const h = buildInstrumentedHarness({
          access: { granted: false, hasGlobalGrant: false, countryIds: [] },
          failureMode: fm,
        });

        const res = await h.app.inject({
          method: 'GET',
          url: `/api/v1/admin/homepage/configurations/${CFG_UG_ID}`,
          cookies: { [SESSION_COOKIE_NAME]: 'valid-session' },
        });

        expect(res.statusCode).toBe(403);
        expect(h.counts).toEqual({
          C1: 1,
          C2: 0,
          C3: 0,
          C4: 1,
          C5: 1,
          C6: 0,
        });

        await h.app.close();
      }
    });
  });
});
