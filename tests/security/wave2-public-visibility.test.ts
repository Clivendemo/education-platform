import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import { SESSION_COOKIE_NAME, type AuthService } from '../../src/services/auth.service.js';
import type { RbacService, PermissionAccessResolution } from '../../src/services/rbac.service.js';
import { GENERIC_FORBIDDEN_MESSAGE } from '../../src/routes/hooks/authorize.js';
import type {
  ResourceService,
  ResourceDetailResult,
  ResourceVersionResult,
  ResourceTypeResult,
} from '../../src/services/resource.service.js';
import type {
  CurriculumService,
  CurriculumResult,
  CurriculumVersionResult,
  TopicResult,
} from '../../src/services/curriculum.service.js';
import {
  RecommendationCacheService,
  type CachedRecommendationTuple,
} from '../../src/services/recommendations/recommendation-cache.service.js';
import {
  DefaultRecommendationService,
  type RecommendationCardDto,
} from '../../src/services/recommendations/recommendation.service.js';

describe('Wave 2 WP2: Public Visibility Lockdown, Synchronous Cache Recomputation & Migration 0023', () => {
  const COUNTRY_KE = '10000000-0000-4000-8000-000000000001';
  const COUNTRY_UG = '10000000-0000-4000-8000-000000000002';
  const COUNTRY_INACTIVE = '10000000-0000-4000-8000-000000000003';

  const RES_PUB = '20000000-0000-4000-8000-000000000001';
  const RES_DRAFT_KE = '20000000-0000-4000-8000-000000000002';
  const RES_DRAFT_UG = '20000000-0000-4000-8000-000000000003';
  const RES_FUTURE_KE = '20000000-0000-4000-8000-000000000004';
  const RES_INACTIVE_COUNTRY = '20000000-0000-4000-8000-000000000005';
  const RES_INACTIVE_TYPE = '20000000-0000-4000-8000-000000000006';

  const VER_PUB = '30000000-0000-4000-8000-000000000001';
  const VER_DRAFT_KE = '30000000-0000-4000-8000-000000000002';
  const VER_DRAFT_UG = '30000000-0000-4000-8000-000000000003';
  const VER_FUTURE_KE = '30000000-0000-4000-8000-000000000004';

  const CUR_ACTIVE = '40000000-0000-4000-8000-000000000001';
  const CUR_INACTIVE_KE = '40000000-0000-4000-8000-000000000002';
  const CUR_INACTIVE_UG = '40000000-0000-4000-8000-000000000003';
  const CV_CURRENT = '50000000-0000-4000-8000-000000000001';
  const CV_DRAFT_KE = '50000000-0000-4000-8000-000000000002';
  const CV_DRAFT_UG = '50000000-0000-4000-8000-000000000003';
  const SUBJ_KE = '60000000-0000-4000-8000-000000000001';
  const SUBJ_UG = '60000000-0000-4000-8000-000000000002';

  const USERS = {
    'tok-global-admin': { id: 'aaaaaaaa-1111-4000-8000-000000000001', role: 'system_admin' },
    'tok-ke-reviewer': { id: 'bbbbbbbb-1111-4000-8000-000000000002', role: 'ke_reviewer' },
    'tok-standard': { id: 'cccccccc-1111-4000-8000-000000000003', role: 'standard_user' },
  } as const;

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
        if (userId === USERS['tok-ke-reviewer'].id) {
          if (perm === 'resource.admin.read' || perm === 'resource.review') {
            return { granted: true, hasGlobalGrant: false, countryIds: [COUNTRY_KE] };
          }
          // taxonomy.manage is GLOBAL -> false for country-scoped reviewer
          return { granted: false, hasGlobalGrant: false, countryIds: [] };
        }
        return { granted: false, hasGlobalGrant: false, countryIds: [] };
      },
    ),
    hasPermission: vi.fn(async () => false),
  } as unknown as RbacService;

  const pastIso = '2026-01-15T10:00:00.000Z';
  const futureIso = '2099-01-01T00:00:00.000Z';

  const makeVersion = (
    id: string,
    resourceId: string,
    status: string,
    publishedAt: string | null,
  ): ResourceVersionResult => ({
    id,
    resourceId,
    versionNumber: 1,
    versionLabel: 'v1.0',
    title: `Version ${id}`,
    description: null,
    changeSummary: null,
    status,
    qualityLabel: 'STANDARD',
    publishedAt,
    createdAt: pastIso,
    updatedAt: pastIso,
  });

  const makeResource = (
    id: string,
    opts: {
      countryId?: string;
      countryStatus?: string;
      typeStatus?: string;
      status?: string;
      latestVersion?: ResourceVersionResult | null;
    } = {},
  ): ResourceDetailResult => ({
    id,
    country: {
      id: opts.countryId ?? COUNTRY_KE,
      name: 'Country',
      isoCode: 'KE',
      status: opts.countryStatus ?? 'ACTIVE',
    },
    resourceType: {
      id: 'rt-1',
      code: 'PAST_PAPER',
      name: 'Past Paper',
      slug: 'past-papers',
      pillar: 'PAST_PAPERS',
      status: opts.typeStatus ?? 'ACTIVE',
    },
    school: null,
    curriculum: {
      curriculumId: null,
      curriculumVersionId: null,
      educationLevelId: null,
      gradeId: null,
      pathwayId: null,
      subjectId: null,
      topicId: null,
    },
    title: `Resource ${id}`,
    slug: `res-${id}`,
    description: null,
    status: opts.status ?? 'PUBLISHED',
    qualityLabel: 'STANDARD',
    sourceName: null,
    sourceReference: null,
    academicYear: 2026,
    term: 1,
    createdAt: pastIso,
    updatedAt: pastIso,
    latestVersion:
      opts.latestVersion !== undefined
        ? opts.latestVersion
        : makeVersion(VER_PUB, id, 'PUBLISHED', pastIso),
  });

  const resourceStore = new Map<string, ResourceDetailResult>([
    [RES_PUB, makeResource(RES_PUB)],
    [
      RES_DRAFT_KE,
      makeResource(RES_DRAFT_KE, {
        countryId: COUNTRY_KE,
        status: 'DRAFT',
        latestVersion: makeVersion(VER_DRAFT_KE, RES_DRAFT_KE, 'DRAFT', null),
      }),
    ],
    [
      RES_DRAFT_UG,
      makeResource(RES_DRAFT_UG, {
        countryId: COUNTRY_UG,
        status: 'DRAFT',
        latestVersion: makeVersion(VER_DRAFT_UG, RES_DRAFT_UG, 'DRAFT', null),
      }),
    ],
    [
      RES_FUTURE_KE,
      makeResource(RES_FUTURE_KE, {
        countryId: COUNTRY_KE,
        status: 'PUBLISHED',
        latestVersion: makeVersion(VER_FUTURE_KE, RES_FUTURE_KE, 'PUBLISHED', futureIso),
      }),
    ],
    [
      RES_INACTIVE_COUNTRY,
      makeResource(RES_INACTIVE_COUNTRY, {
        countryId: COUNTRY_INACTIVE,
        countryStatus: 'INACTIVE',
        status: 'PUBLISHED',
      }),
    ],
    [
      RES_INACTIVE_TYPE,
      makeResource(RES_INACTIVE_TYPE, {
        countryId: COUNTRY_KE,
        typeStatus: 'INACTIVE',
        status: 'PUBLISHED',
      }),
    ],
  ]);

  const versionStore = new Map<string, ResourceVersionResult>([
    [VER_PUB, makeVersion(VER_PUB, RES_PUB, 'PUBLISHED', pastIso)],
    [VER_DRAFT_KE, makeVersion(VER_DRAFT_KE, RES_DRAFT_KE, 'DRAFT', null)],
    [VER_DRAFT_UG, makeVersion(VER_DRAFT_UG, RES_DRAFT_UG, 'DRAFT', null)],
    [VER_FUTURE_KE, makeVersion(VER_FUTURE_KE, RES_FUTURE_KE, 'PUBLISHED', futureIso)],
  ]);

  const mockResourceService: ResourceService = {
    listResourceTypes: vi.fn(async ({ includeInactive } = {}) => {
      const active: ResourceTypeResult = {
        id: 'rt-1',
        code: 'PAST_PAPER',
        name: 'Past Papers',
        slug: 'past-papers',
        pillar: 'PAST_PAPERS',
        description: null,
        status: 'ACTIVE',
        sequenceOrder: 1,
        createdAt: pastIso,
        updatedAt: pastIso,
      };
      const inactive: ResourceTypeResult = {
        ...active,
        id: 'rt-2',
        code: 'RETIRED_TYPE',
        slug: 'retired-type',
        status: 'INACTIVE',
      };
      return includeInactive ? [active, inactive] : [active];
    }),
    listResources: vi.fn(async (params) => {
      const items = Array.from(resourceStore.values()).filter((r) => {
        if (params.status && r.status !== params.status) return false;
        if (params.publicOnly && r.status !== 'PUBLISHED') return false;
        if (params.allowedCountryIds && !params.allowedCountryIds.includes(r.country.id)) {
          return false;
        }
        return true;
      });
      return {
        data: items,
        meta: { page: 1, pageSize: 20, total: items.length, hasMore: false },
      };
    }),
    getResourceById: vi.fn(async (id, opts) => {
      const found = resourceStore.get(id) ?? null;
      if (!found) return null;
      if (opts?.publicOnly && found.status !== 'PUBLISHED') return null;
      return found;
    }),
    listResourceVersions: vi.fn(async (resourceId, opts) => {
      const all = Array.from(versionStore.values()).filter((v) => v.resourceId === resourceId);
      return opts?.includeUnpublished ? all : all.filter((v) => v.status === 'PUBLISHED');
    }),
    getResourceVersionById: vi.fn(async (id) => versionStore.get(id) ?? null),
    createResourceVersion: vi.fn(),
    updateResourceVersion: vi.fn(),
  };

  const curriculaMap = new Map<string, CurriculumResult>([
    [
      CUR_ACTIVE,
      {
        id: CUR_ACTIVE,
        name: 'CBC Kenya',
        slug: 'cbc',
        code: 'CBC',
        description: null,
        status: 'ACTIVE',
        country: { id: COUNTRY_KE, name: 'Kenya', isoCode: 'KE', status: 'ACTIVE' },
        createdAt: pastIso,
        updatedAt: pastIso,
      },
    ],
    [
      CUR_INACTIVE_KE,
      {
        id: CUR_INACTIVE_KE,
        name: 'Legacy 8-4-4',
        slug: '844',
        code: '844',
        description: null,
        status: 'INACTIVE',
        country: { id: COUNTRY_KE, name: 'Kenya', isoCode: 'KE', status: 'ACTIVE' },
        createdAt: pastIso,
        updatedAt: pastIso,
      },
    ],
    [
      CUR_INACTIVE_UG,
      {
        id: CUR_INACTIVE_UG,
        name: 'Legacy UG',
        slug: 'ug-legacy',
        code: 'UGL',
        description: null,
        status: 'INACTIVE',
        country: { id: COUNTRY_UG, name: 'Uganda', isoCode: 'UG', status: 'ACTIVE' },
        createdAt: pastIso,
        updatedAt: pastIso,
      },
    ],
  ]);

  const cvMap = new Map<string, CurriculumVersionResult>([
    [
      CV_CURRENT,
      {
        id: CV_CURRENT,
        curriculumId: CUR_ACTIVE,
        countryId: COUNTRY_KE,
        versionName: 'CBC 2024',
        versionCode: 'CBC-2024',
        slug: 'cbc-2024',
        effectiveFrom: '2024-01-01',
        effectiveTo: null,
        status: 'CURRENT',
        description: null,
        createdAt: pastIso,
        updatedAt: pastIso,
      },
    ],
    [
      CV_DRAFT_KE,
      {
        id: CV_DRAFT_KE,
        curriculumId: CUR_ACTIVE,
        countryId: COUNTRY_KE,
        versionName: 'CBC 2028 Draft',
        versionCode: 'CBC-2028-DRAFT',
        slug: 'cbc-2028-draft',
        effectiveFrom: null,
        effectiveTo: null,
        status: 'DRAFT',
        description: null,
        createdAt: pastIso,
        updatedAt: pastIso,
      },
    ],
    [
      CV_DRAFT_UG,
      {
        id: CV_DRAFT_UG,
        curriculumId: CUR_INACTIVE_UG,
        countryId: COUNTRY_UG,
        versionName: 'UG Draft',
        versionCode: 'UG-DRAFT',
        slug: 'ug-draft',
        effectiveFrom: null,
        effectiveTo: null,
        status: 'DRAFT',
        description: null,
        createdAt: pastIso,
        updatedAt: pastIso,
      },
    ],
  ]);

  const mockCurriculumService: CurriculumService = {
    listCurricula: vi.fn(async (params) => {
      const items = Array.from(curriculaMap.values()).filter((c) => {
        if (params.status && c.status !== params.status) return false;
        if (params.allowedCountryIds && !params.allowedCountryIds.includes(c.country.id)) {
          return false;
        }
        return true;
      });
      return {
        data: items,
        meta: { page: 1, pageSize: 20, total: items.length, hasMore: false },
      };
    }),
    getCurriculumById: vi.fn(async (id, opts) => {
      const c = curriculaMap.get(id) ?? null;
      if (!c) return null;
      if (!opts?.includeInactive && c.status !== 'ACTIVE') return null;
      return c;
    }),
    listCurriculumVersions: vi.fn(async (curriculumId, opts) => {
      const list = Array.from(cvMap.values()).filter((v) => v.curriculumId === curriculumId);
      return opts?.includeInactive
        ? list
        : list.filter((v) => v.status === 'CURRENT' || v.status === 'PLANNED');
    }),
    getCurriculumVersionById: vi.fn(async (id, opts) => {
      const v = cvMap.get(id) ?? null;
      if (!v) return null;
      if (!opts?.includeInactive && v.status !== 'CURRENT' && v.status !== 'PLANNED') return null;
      return v;
    }),
    listEducationLevels: vi.fn(async () => []),
    listGrades: vi.fn(async () => []),
    listPathways: vi.fn(async () => []),
    listSubjects: vi.fn(async () => []),
    listTopics: vi.fn(async (_subjectId, opts): Promise<TopicResult[]> =>
      opts?.includeInactive
        ? [
            {
              id: 'top-inact',
              curriculumVersionId: CV_CURRENT,
              subjectId: SUBJ_KE,
              parentId: null,
              name: 'Retired Topic',
              slug: 'retired-topic',
              code: 'RT',
              description: null,
              sequenceOrder: 1,
              status: 'INACTIVE',
              createdAt: pastIso,
              updatedAt: pastIso,
            },
          ]
        : [],
    ),
    getSubjectCountryId: vi.fn(async (subjectId) => {
      if (subjectId === SUBJ_KE) return COUNTRY_KE;
      if (subjectId === SUBJ_UG) return COUNTRY_UG;
      return null;
    }),
  };

  const app = buildApp({
    services: {
      authService: mockAuthService,
      rbacService: mockRbacService,
      resourceService: mockResourceService,
      curriculumService: mockCurriculumService,
      publicationService: {
        getPublicationHistory: vi.fn(async () => [
          {
            id: 'ev-1',
            resourceId: RES_PUB,
            resourceVersionId: VER_PUB,
            eventType: 'PUBLISHED',
            fromStatus: 'APPROVED',
            toStatus: 'PUBLISHED',
            reason: 'Internal reviewer note',
            actorUserId: USERS['tok-ke-reviewer'].id,
            createdAt: pastIso,
          },
        ]),
      } as any,
      auditService: {
        logEvent: vi.fn(async () => ({})),
      } as any,
    },
  });

  const cookieHeader = (tok: keyof typeof USERS) => ({
    cookie: `${SESSION_COOKIE_NAME}=${tok}`,
  });

  describe('1. Resource & Version Public Visibility Lockdown', () => {
    it('gates GET /api/v1/resource-types?includeInactive=true and GET /api/v1/resources?status=DRAFT behind staff RBAC + private no-store', async () => {
      // Anonymous -> 401
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/resource-types?includeInactive=true' }))
          .statusCode,
      ).toBe(401);
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/resources?status=DRAFT' })).statusCode,
      ).toBe(401);

      // standard_user -> 403 generic
      const stdTypes = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-types?includeInactive=true',
        headers: cookieHeader('tok-standard'),
      });
      expect(stdTypes.statusCode).toBe(403);
      expect(stdTypes.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);

      const stdDrafts = await app.inject({
        method: 'GET',
        url: '/api/v1/resources?status=DRAFT',
        headers: cookieHeader('tok-standard'),
      });
      expect(stdDrafts.statusCode).toBe(403);

      // KE reviewer -> 200 with Cache-Control: private, no-store and narrowed to KE drafts only
      const keDrafts = await app.inject({
        method: 'GET',
        url: '/api/v1/resources?status=DRAFT',
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(keDrafts.statusCode).toBe(200);
      expect(keDrafts.headers['cache-control']).toBe('private, no-store');
      expect(keDrafts.json().data.map((r: any) => r.id)).toEqual([RES_DRAFT_KE]);
    });

    it('hides draft, future-dated, inactive-country, and inactive-type resources on GET /api/v1/resources/:id (404 public, 200 in-scope staff)', async () => {
      for (const hiddenId of [
        RES_DRAFT_KE,
        RES_FUTURE_KE,
        RES_INACTIVE_COUNTRY,
        RES_INACTIVE_TYPE,
      ]) {
        const anonRes = await app.inject({ method: 'GET', url: `/api/v1/resources/${hiddenId}` });
        expect(anonRes.statusCode, `Anon must get 404 on ${hiddenId}`).toBe(404);

        const stdRes = await app.inject({
          method: 'GET',
          url: `/api/v1/resources/${hiddenId}`,
          headers: cookieHeader('tok-standard'),
        });
        expect(stdRes.statusCode, `standard_user must get 404 on ${hiddenId}`).toBe(404);
      }

      // KE reviewer can inspect KE draft & KE future-dated resource with private no-store, but gets 404 on UG draft
      const keStaffDraft = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${RES_DRAFT_KE}`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(keStaffDraft.statusCode).toBe(200);
      expect(keStaffDraft.headers['cache-control']).toBe('private, no-store');

      const keStaffUgDraft = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${RES_DRAFT_UG}`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(keStaffUgDraft.statusCode).toBe(404);
    });

    it('locks down GET /api/v1/resources/:id/versions?includeUnpublished=true and GET /api/v1/resource-versions/:id', async () => {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/resources/${RES_PUB}/versions?includeUnpublished=true`,
          })
        ).statusCode,
      ).toBe(401);

      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/resources/${RES_PUB}/versions?includeUnpublished=true`,
            headers: cookieHeader('tok-standard'),
          })
        ).statusCode,
      ).toBe(403);

      // Direct version lookup of draft or future-dated version returns 404 to public/standard_user
      for (const verId of [VER_DRAFT_KE, VER_FUTURE_KE]) {
        expect(
          (await app.inject({ method: 'GET', url: `/api/v1/resource-versions/${verId}` }))
            .statusCode,
        ).toBe(404);
        expect(
          (
            await app.inject({
              method: 'GET',
              url: `/api/v1/resource-versions/${verId}`,
              headers: cookieHeader('tok-standard'),
            })
          ).statusCode,
        ).toBe(404);
      }

      // In-scope KE reviewer gets 200 + private, no-store on KE draft version, 404 on UG draft version
      const staffKeVer = await app.inject({
        method: 'GET',
        url: `/api/v1/resource-versions/${VER_DRAFT_KE}`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(staffKeVer.statusCode).toBe(200);
      expect(staffKeVer.headers['cache-control']).toBe('private, no-store');

      const staffUgVer = await app.inject({
        method: 'GET',
        url: `/api/v1/resource-versions/${VER_DRAFT_UG}`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(staffUgVer.statusCode).toBe(404);
    });
  });

  describe('2. Internal Publication Events Lockdown (GET /api/v1/resources/:id/events)', () => {
    it('blocks anonymous (401), standard_user (403), and out-of-country staff (403), while permitting in-country staff with private no-store', async () => {
      const anon = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${RES_PUB}/events`,
      });
      expect(anon.statusCode).toBe(401);

      const std = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${RES_PUB}/events`,
        headers: cookieHeader('tok-standard'),
      });
      expect(std.statusCode).toBe(403);
      expect(std.json().error.message).toBe(GENERIC_FORBIDDEN_MESSAGE);
      expect(std.body).not.toContain('resource.admin.read');

      const outOfCountry = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${RES_DRAFT_UG}/events`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(outOfCountry.statusCode).toBe(403);

      const inCountry = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${RES_PUB}/events`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(inCountry.statusCode).toBe(200);
      expect(inCountry.headers['cache-control']).toBe('private, no-store');
      expect(inCountry.json().data).toHaveLength(1);
    });
  });

  describe('3. Curriculum & Taxonomy Public Visibility Lockdown', () => {
    it('gates status=INACTIVE, includeInactive=true, and DRAFT curriculum versions behind staff RBAC + country scope', async () => {
      expect(
        (await app.inject({ method: 'GET', url: '/api/v1/curricula?status=INACTIVE' })).statusCode,
      ).toBe(401);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/v1/curricula?status=INACTIVE',
            headers: cookieHeader('tok-standard'),
          })
        ).statusCode,
      ).toBe(403);

      // KE reviewer listing INACTIVE curricula sees only KE inactive curriculum + private no-store
      const keInactiveCurricula = await app.inject({
        method: 'GET',
        url: '/api/v1/curricula?status=INACTIVE',
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(keInactiveCurricula.statusCode).toBe(200);
      expect(keInactiveCurricula.headers['cache-control']).toBe('private, no-store');
      expect(keInactiveCurricula.json().data.map((c: any) => c.id)).toEqual([CUR_INACTIVE_KE]);

      // DRAFT curriculum version levels: 404 to public/standard_user, 200 + private no-store to KE reviewer on KE draft, 404 on UG draft
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/curriculum-versions/${CV_DRAFT_KE}/levels`,
          })
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await app.inject({
            method: 'GET',
            url: `/api/v1/curriculum-versions/${CV_DRAFT_KE}/levels`,
            headers: cookieHeader('tok-standard'),
          })
        ).statusCode,
      ).toBe(404);

      const keDraftLevels = await app.inject({
        method: 'GET',
        url: `/api/v1/curriculum-versions/${CV_DRAFT_KE}/levels`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(keDraftLevels.statusCode).toBe(200);
      expect(keDraftLevels.headers['cache-control']).toBe('private, no-store');

      const ugDraftLevels = await app.inject({
        method: 'GET',
        url: `/api/v1/curriculum-versions/${CV_DRAFT_UG}/levels`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(ugDraftLevels.statusCode).toBe(404);

      // Topics includeInactive=true: KE reviewer allowed on KE subject, 403 on UG subject
      const keTopics = await app.inject({
        method: 'GET',
        url: `/api/v1/subjects/${SUBJ_KE}/topics?includeInactive=true`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(keTopics.statusCode).toBe(200);
      expect(keTopics.headers['cache-control']).toBe('private, no-store');

      const ugTopics = await app.inject({
        method: 'GET',
        url: `/api/v1/subjects/${SUBJ_UG}/topics?includeInactive=true`,
        headers: cookieHeader('tok-ke-reviewer'),
      });
      expect(ugTopics.statusCode).toBe(403);
    });
  });

  describe('4. Synchronous Recommendation Cache Recomputation & File Quarantine Invalidation', () => {
    const SOURCE_ID = '70000000-0000-4000-8000-000000000000';
    const makeCard = (idx: number): RecommendationCardDto => {
      const resId = `70000000-0000-4000-8000-${String(idx).padStart(12, '0')}`;
      const verId = `80000000-0000-4000-8000-${String(idx).padStart(12, '0')}`;
      return {
        id: resId,
        title: `Candidate ${idx}`,
        slug: `cand-${idx}`,
        description: null,
        qualityLabel: 'STANDARD',
        quality: {
          effectiveTier: 'STANDARD',
          label: 'Standard',
          displayMark: null,
          isVerified: false,
          isPremium: false,
          verifiedAt: null,
        },
        resourceType: {
          id: 'rt-1',
          code: 'PAST_PAPER',
          name: 'Past Paper',
          slug: 'past-papers',
          pillar: 'PAST_PAPERS',
        },
        country: {
          id: COUNTRY_KE,
          name: 'Kenya',
          isoCode: 'KE',
          urlPrefix: 'ke',
        },
        curriculum: null,
        grade: null,
        subject: null,
        topic: null,
        publishedVersion: {
          id: verId,
          versionNumber: 1,
          versionLabel: 'v1.0',
          publishedAt: pastIso,
        },
      };
    };

    it('evaluates full cached pool (no effectiveLimit + 4 pre-slice truncation) and returns cache hit when >= effectiveLimit survive', async () => {
      const cache = new RecommendationCacheService({ ttlMs: 300_000 });
      const cards = Array.from({ length: 12 }, (_, i) => makeCard(i + 1));
      const tuples: CachedRecommendationTuple<RecommendationCardDto>[] = cards.map((c, i) => ({
        resourceId: c.id,
        isPinned: false,
        ruleScopeRank: null,
        priority: null,
        algorithmicScore: 80 - i,
        card: c,
      }));

      cache.set(`rec:res:${SOURCE_ID}:related-resources`, tuples, {
        countryId: COUNTRY_KE,
        sourceResourceId: SOURCE_ID,
        candidateIds: cards.map((c) => c.id),
      });

      // Items 1..6 were quarantined/unpublished; items 7..12 (6 items) are still live!
      // Under the old `effectiveLimit + 4 = 10` pre-slice bug, only items 7..10 (4 items) would have been returned!
      const mockDb: any = {
        execute: vi.fn(async () => ({
          rows: [
            {
              resource_id: SOURCE_ID,
              version_id: 'ver-src',
              country_id: COUNTRY_KE,
              country_iso_code: 'KE',
              country_url_prefix: 'ke',
            },
            ...cards.slice(6).map((c) => ({
              resource_id: c.id,
              version_id: c.publishedVersion.id,
              country_id: COUNTRY_KE,
              country_iso_code: 'KE',
              country_url_prefix: 'ke',
            })),
          ],
        })),
      };

      const recService = new DefaultRecommendationService(mockDb, undefined, undefined, cache);
      const res = await recService.getResourceRecommendations({
        sourceResourceId: SOURCE_ID,
        surface: 'related-resources',
        limit: 6,
      });

      expect(res._diagnostics?.cacheHit).toBe(true);
      expect(res.data).toHaveLength(6);
      expect(res.data.map((c) => c.id)).toEqual(cards.slice(6, 12).map((c) => c.id));
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
    });

    it('synchronously falls through to scoring dataset & overwrites cache when live-gate evictions drop cached results below effectiveLimit', async () => {
      const cache = new RecommendationCacheService({ ttlMs: 300_000 });
      const staleCards = Array.from({ length: 8 }, (_, i) => makeCard(i + 1));
      cache.set(
        `rec:res:${SOURCE_ID}:related-resources`,
        staleCards.map((c, i) => ({
          resourceId: c.id,
          isPinned: false,
          ruleScopeRank: null,
          priority: null,
          algorithmicScore: 70 - i,
          card: c,
        })),
        {
          countryId: COUNTRY_KE,
          sourceResourceId: SOURCE_ID,
          candidateIds: staleCards.map((c) => c.id),
        },
      );

      // Only 3 of the 8 cached items survive (< limit 6), triggering synchronous recomputation which discovers 6 fresh items (101..106)
      const freshCards = Array.from({ length: 6 }, (_, i) => makeCard(101 + i));
      let callIdx = 0;
      const mockDb: any = {
        execute: vi.fn(async () => {
          callIdx += 1;
          if (callIdx === 1) {
            return {
              rows: [
                {
                  resource_id: SOURCE_ID,
                  version_id: 'ver-src',
                  country_id: COUNTRY_KE,
                  country_iso_code: 'KE',
                  country_url_prefix: 'ke',
                },
                ...staleCards.slice(0, 3).map((c) => ({
                  resource_id: c.id,
                  version_id: c.publishedVersion.id,
                  country_id: COUNTRY_KE,
                  country_iso_code: 'KE',
                  country_url_prefix: 'ke',
                })),
              ],
            };
          }
          // Call 2: fn_get_resource_scoring_dataset fresh dataset
          return {
            rows: [
              {
                resource_id: SOURCE_ID,
                country_id: COUNTRY_KE,
                country_name: 'Kenya',
                country_iso_code: 'KE',
                country_url_prefix: 'ke',
                grade_id: 'grade-1',
                subject_id: 'subj-1',
                topic_id: 'top-1',
                topic_active: true,
                topic_parent_id: null,
                topic_parent_active: false,
                pillar: 'PAST_PAPERS',
                candidate_items: freshCards.map((fc) => ({
                  resourceId: fc.id,
                  displayTitle: fc.title,
                  slug: fc.slug,
                  displayDescription: null,
                  versionId: fc.publishedVersion.id,
                  versionNumber: 1,
                  versionLabel: 'v1.0',
                  typeId: 'rt-1',
                  typeCode: 'PAST_PAPER',
                  typeName: 'Past Paper',
                  typeSlug: 'past-papers',
                  curriculumId: null,
                  curriculumCode: null,
                  curriculumName: null,
                  gradeId: 'grade-1',
                  gradeCode: 'G1',
                  gradeName: 'Grade 1',
                  subjectId: 'subj-1',
                  subjectCode: 'MAT',
                  subjectName: 'Math',
                  topicId: 'top-1',
                  topicCode: 'ALG',
                  topicName: 'Algebra',
                  topicActive: true,
                  topicParentId: null,
                  topicParentActive: false,
                  pillar: 'PAST_PAPERS',
                  resourceQualityLabel: 'STANDARD',
                  versionQualityLabel: 'STANDARD',
                  hasActiveVersionVerification: false,
                  verificationId: null,
                  verifiedAt: null,
                  publishedAt: pastIso,
                  distinctCoIdentityCount: 0,
                })),
                rule_items: [],
              },
            ],
          };
        }),
      };

      const recService = new DefaultRecommendationService(mockDb, undefined, undefined, cache);
      const res = await recService.getResourceRecommendations({
        sourceResourceId: SOURCE_ID,
        surface: 'related-resources',
        limit: 6,
        evalNow: new Date('2026-06-01T00:00:00.000Z'),
      });

      expect(res._diagnostics?.cacheHit).toBe(false);
      expect(res.data).toHaveLength(6);
      expect(res.data.map((c) => c.id)).toEqual(freshCards.map((c) => c.id));
      expect(mockDb.execute).toHaveBeenCalledTimes(2);

      // Verify cache was overwritten with the newly recomputed fresh tuples
      const overwritten = cache.get(`rec:res:${SOURCE_ID}:related-resources`);
      expect(overwritten?.map((t) => t.resourceId)).toEqual(freshCards.map((c) => c.id));
    });

    it('evicts cached recommendation entries immediately on files.resource_files invalidation payload (scope = file)', () => {
      const cache = new RecommendationCacheService({ ttlMs: 300_000 });
      const card = makeCard(1);
      const key = `rec:res:${SOURCE_ID}:related-resources`;
      cache.set(
        key,
        [
          {
            resourceId: card.id,
            isPinned: false,
            ruleScopeRank: null,
            priority: null,
            algorithmicScore: 55,
            card,
          },
        ],
        {
          countryId: COUNTRY_KE,
          sourceResourceId: SOURCE_ID,
          candidateIds: [card.id],
        },
      );

      expect(cache.get(key)).not.toBeNull();
      cache.handleInvalidationEvent({
        scope: 'file',
        op: 'UPDATE_OLD',
        country_id: COUNTRY_KE,
        source_resource_id: card.id,
        target_resource_id: card.id,
      });
      expect(cache.get(key)).toBeNull();
    });
  });

  describe('5. Migration 0023 & Drizzle Journal Structural Verification', () => {
    it('registers 0023_wave2_visibility_and_rbac_hardening as idx 23 and hardens homepage, recommendation scoring, and file invalidation triggers', () => {
      const journalPath = path.resolve(process.cwd(), 'drizzle/meta/_journal.json');
      const journal = JSON.parse(fs.readFileSync(journalPath, 'utf8'));
      expect(journal.entries).toHaveLength(24);
      const entry23 = journal.entries[23];
      expect(entry23.idx).toBe(23);
      expect(entry23.tag).toBe('0023_wave2_visibility_and_rbac_hardening');

      const migPath = path.resolve(
        process.cwd(),
        'drizzle/0023_wave2_visibility_and_rbac_hardening.sql',
      );
      const migSql = fs.readFileSync(migPath, 'utf8');

      expect(migSql).toContain('CREATE OR REPLACE FUNCTION "content"."fn_evaluate_homepage_entity_eligibility"');
      expect(migSql).toContain("rf.malware_scan_status NOT IN ('INFECTED', 'SCAN_ERROR')");
      expect(migSql).toContain("rf.object_key NOT LIKE 'quarantine/%'");
      expect(migSql).toContain('CREATE OR REPLACE FUNCTION "content"."fn_get_resource_scoring_dataset"');
      expect(migSql).toContain('AND rv.published_at <= p_eval_now');
      expect(migSql).toContain("ELSIF TG_TABLE_SCHEMA = 'files' AND TG_TABLE_NAME = 'resource_files' THEN");
      expect(migSql).toContain('CREATE TRIGGER "trg_resource_files_invalidation"');
    });
  });
});
