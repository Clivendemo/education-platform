import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { SearchService } from '../../src/services/search.service.js';
import type { AuthService } from '../../src/services/auth.service.js';
import type { RbacService } from '../../src/services/rbac.service.js';

describe('Search Autocomplete, Related Discovery & Demand Routes', () => {
  let mockSearchService: SearchService;
  let mockAuthService: AuthService;
  let mockRbacService: RbacService;

  beforeEach(() => {
    mockSearchService = {
      searchResources: vi.fn(),
      getAutocompleteSuggestions: vi.fn().mockResolvedValue({
        suggestions: [
          {
            text: 'Mathematics Grade 10 Past Papers',
            type: 'RESOURCE_TITLE',
            resourceId: '11111111-1111-1111-1111-111111111111',
            slug: 'mathematics-grade-10-past-papers',
            context: {
              country: 'Kenya',
              grade: 'Grade 10',
              subject: 'Mathematics',
            },
          },
        ],
        fallbackUsed: false,
      }),
      getRelatedDiscovery: vi.fn().mockResolvedValue({
        query: 'quantum',
        relatedSubjects: [
          { id: 'sub-1', name: 'Physics', code: 'PHY' },
        ],
        relatedTopics: [
          { id: 'top-1', name: 'Quantum Mechanics', code: 'QM' },
        ],
        suggestedResources: [],
      }),
      getSearchDemand: vi.fn().mockResolvedValue({
        data: [
          {
            query: 'cbc grade 9 revision',
            totalSearches: 42,
            distinctSearchIdentities: 18,
            zeroResultCount: 42,
            zeroResultRate: 1.0,
            firstSeenAt: '2026-10-01T10:00:00.000Z',
            lastSeenAt: '2026-10-21T18:00:00.000Z',
          },
        ],
        meta: {
          window: '30d',
          type: 'all',
          minCountThreshold: 3,
          page: 1,
          pageSize: 20,
          total: 1,
          hasMore: false,
        },
      }),
    };

    mockAuthService = {
      validateSession: vi.fn(),
    } as unknown as AuthService;

    mockRbacService = {
      hasPermission: vi.fn(),
    } as unknown as RbacService;
  });

  describe('GET /api/v1/search/autocomplete', () => {
    it('returns empty array when query is less than 2 characters without calling service', async () => {
      const app = buildApp({
        services: { searchService: mockSearchService },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search/autocomplete?q=m',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toEqual([]);
      expect(body.meta).toEqual({
        count: 0,
        query: 'm',
        fallbackUsed: false,
      });
      expect(mockSearchService.getAutocompleteSuggestions).not.toHaveBeenCalled();
    });

    it('returns suggestions and metadata when query is valid', async () => {
      const app = buildApp({
        services: { searchService: mockSearchService },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search/autocomplete?q=math&country=ke',
        headers: {
          'x-request-id': 'req-auto-001',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].text).toBe('Mathematics Grade 10 Past Papers');
      expect(body.meta.fallbackUsed).toBe(false);
      expect(mockSearchService.getAutocompleteSuggestions).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'math',
          country: 'ke',
        }),
      );
    });

    it('clamps limit to max 5', async () => {
      const app = buildApp({
        services: { searchService: mockSearchService },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search/autocomplete?q=math&limit=10',
      });

      // Zod schema enforces max 5
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/search/related', () => {
    it('returns 400 when query is empty', async () => {
      const app = buildApp({
        services: { searchService: mockSearchService },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search/related?q=',
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });

    it('returns related discoveries for valid query', async () => {
      const app = buildApp({
        services: { searchService: mockSearchService },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/search/related?q=quantum',
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data.query).toBe('quantum');
      expect(body.data.relatedSubjects).toHaveLength(1);
      expect(body.meta.hasSuggestions).toBe(true);
    });
  });

  describe('GET /api/v1/admin/search/demand', () => {
    it('returns 401 UNAUTHORIZED when no session token is provided', async () => {
      const app = buildApp({
        services: {
          searchService: mockSearchService,
          authService: mockAuthService,
          rbacService: mockRbacService,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/search/demand',
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHORIZED');
    });

    it('returns 403 FORBIDDEN when user lacks analytics.read permission', async () => {
      (mockAuthService.validateSession as any).mockResolvedValue({
        user: { id: 'usr-123', email: 'user@test.ke' },
      });
      (mockRbacService.hasPermission as any).mockResolvedValue(false);

      const app = buildApp({
        services: {
          searchService: mockSearchService,
          authService: mockAuthService,
          rbacService: mockRbacService,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/search/demand',
        cookies: {
          elimu_session: 'valid-token',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error.code).toBe('FORBIDDEN');
      expect(mockRbacService.hasPermission).toHaveBeenCalledWith(
        'usr-123',
        'analytics.read',
      );
    });

    it('returns 200 with search demand report when user has analytics.read', async () => {
      (mockAuthService.validateSession as any).mockResolvedValue({
        user: { id: 'adm-456', email: 'admin@test.ke' },
      });
      (mockRbacService.hasPermission as any).mockResolvedValue(true);

      const app = buildApp({
        services: {
          searchService: mockSearchService,
          authService: mockAuthService,
          rbacService: mockRbacService,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/search/demand?window=30d&type=all',
        cookies: {
          elimu_session: 'valid-admin-token',
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].query).toBe('cbc grade 9 revision');
      expect(body.data[0].distinctSearchIdentities).toBe(18);
      expect(body.meta.minCountThreshold).toBe(3);
    });

    it('rejects client minCount < 3 via schema validation', async () => {
      (mockAuthService.validateSession as any).mockResolvedValue({
        user: { id: 'adm-456', email: 'admin@test.ke' },
      });
      (mockRbacService.hasPermission as any).mockResolvedValue(true);

      const app = buildApp({
        services: {
          searchService: mockSearchService,
          authService: mockAuthService,
          rbacService: mockRbacService,
        },
      });

      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/search/demand?minCount=1',
        cookies: {
          elimu_session: 'valid-admin-token',
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('VALIDATION_ERROR');
    });
  });
});
