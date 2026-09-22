import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  GeographyService,
  AdministrativeAreaResult,
} from '../../src/services/geography.service.js';

describe('Geography API Routes (/api/v1/geography)', () => {
  const mockCounty: AdministrativeAreaResult = {
    id: 'b0000000-0000-0000-0000-000000000001',
    countryId: 'a0000000-0000-0000-0000-000000000001',
    typeId: 'c0000000-0000-0000-0000-000000000001',
    parentTypeId: null,
    parentId: null,
    name: 'Nairobi',
    code: '047',
    slug: 'nairobi',
    status: 'ACTIVE',
    type: {
      id: 'c0000000-0000-0000-0000-000000000001',
      name: 'County',
      slug: 'county',
      hierarchyLevel: 1,
    },
  };

  const mockSubCounty: AdministrativeAreaResult = {
    id: 'b0000000-0000-0000-0000-000000000002',
    countryId: 'a0000000-0000-0000-0000-000000000001',
    typeId: 'c0000000-0000-0000-0000-000000000002',
    parentTypeId: 'c0000000-0000-0000-0000-000000000001',
    parentId: mockCounty.id,
    name: 'Westlands',
    code: null,
    slug: 'westlands',
    status: 'ACTIVE',
    type: {
      id: 'c0000000-0000-0000-0000-000000000002',
      name: 'Sub-County',
      slug: 'sub-county',
      hierarchyLevel: 2,
    },
  };

  const createMockService = (
    overrides: Partial<GeographyService> = {},
  ): GeographyService => ({
    listActiveCountries: vi.fn().mockResolvedValue([]),
    getActiveCountryByIdentifier: vi.fn().mockResolvedValue(null),
    listAreas: vi.fn().mockImplementation(async (params) => ({
      data: [mockCounty],
      meta: {
        page: params.page ?? 1,
        pageSize: params.pageSize ?? 50,
        total: 1,
        hasMore: false,
      },
    })),
    getAreaById: vi.fn().mockImplementation(async (id: string) => {
      if (id === mockCounty.id) return mockCounty;
      if (id === mockSubCounty.id) return mockSubCounty;
      return null;
    }),
    getChildAreas: vi.fn().mockImplementation(async (parentId: string) => {
      if (parentId === mockCounty.id) return [mockSubCounty];
      return [];
    }),
    ...overrides,
  });

  describe('GET /api/v1/geography/areas', () => {
    it('returns a paginated list of administrative areas', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/geography/areas?page=1&pageSize=10',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('data');
      expect(payload).toHaveProperty('meta');
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].name).toBe('Nairobi');
      expect(payload.meta.page).toBe(1);
      expect(payload.meta.pageSize).toBe(10);
      expect(mockService.listAreas).toHaveBeenCalledWith({
        countryId: undefined,
        typeId: undefined,
        parentId: undefined,
        page: 1,
        pageSize: 10,
      });
    });

    it('returns 400 when query parameter has invalid format', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/geography/areas?countryId=not-a-valid-uuid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('GET /api/v1/geography/areas/:id', () => {
    it('returns area details with type metadata for valid UUID', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/geography/areas/${mockCounty.id}`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.id).toBe(mockCounty.id);
      expect(payload.data.name).toBe('Nairobi');
      expect(payload.data.type?.name).toBe('County');
    });

    it('returns 404 when area is not found', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/geography/areas/00000000-0000-0000-0000-000000000099',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('AREA_NOT_FOUND');
    });

    it('returns 400 when ID is not a valid UUID', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/geography/areas/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_PARAMETER');
    });
  });

  describe('GET /api/v1/geography/children/:id', () => {
    it('returns direct child areas for a parent area', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/geography/children/${mockCounty.id}`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].name).toBe('Westlands');
      expect(mockService.getChildAreas).toHaveBeenCalledWith(mockCounty.id);
    });

    it('returns 400 when parent ID is not a valid UUID', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/geography/children/invalid-parent-id',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_PARAMETER');
    });
  });
});
