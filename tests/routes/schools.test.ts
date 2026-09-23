import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  SchoolService,
  SchoolResult,
  ListSchoolsResult,
} from '../../src/services/school.service.js';

describe('Schools API Routes (/api/v1/schools)', () => {
  const mockKenyaCountry = {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Kenya',
    isoCode: 'KE',
  };

  const mockNairobiArea = {
    id: 'b0000000-0000-0000-0000-000000000047',
    name: 'Nairobi',
    code: '047',
    slug: 'nairobi',
  };

  const mockSchool: SchoolResult = {
    id: 'c0000000-0000-0000-0000-000000000001',
    name: 'Alliance High School',
    code: 'AHS001',
    schoolType: 'SECONDARY',
    status: 'ACTIVE',
    country: mockKenyaCountry,
    administrativeArea: mockNairobiArea,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const createMockService = (
    overrides: Partial<SchoolService> = {},
  ): SchoolService => ({
    listSchools: vi.fn().mockResolvedValue({
      data: [mockSchool],
      meta: { page: 1, pageSize: 20, total: 1, hasMore: false },
    } as ListSchoolsResult),
    getSchoolById: vi.fn().mockImplementation(async (id: string) => {
      if (id === mockSchool.id) {
        return mockSchool;
      }
      return null;
    }),
    ...overrides,
  });

  describe('GET /api/v1/schools', () => {
    it('returns a paginated list of active schools with 200 OK and response envelope', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/schools',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();

      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('data');
      expect(payload).toHaveProperty('meta');
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]).toMatchObject({
        id: mockSchool.id,
        name: 'Alliance High School',
        code: 'AHS001',
        schoolType: 'SECONDARY',
        status: 'ACTIVE',
        country: {
          id: mockKenyaCountry.id,
          name: 'Kenya',
          isoCode: 'KE',
        },
        administrativeArea: {
          id: mockNairobiArea.id,
          name: 'Nairobi',
          code: '047',
        },
      });
      expect(payload.meta).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        hasMore: false,
      });
    });

    it('passes pagination parameters correctly to service', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/schools?page=2&pageSize=15',
      });

      expect(response.statusCode).toBe(200);
      expect(mockService.listSchools).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          pageSize: 15,
        }),
      );
    });

    it('rejects invalid pagination parameters with 400 and standardized error', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      // Invalid page: 0
      const resPageZero = await app.inject({
        method: 'GET',
        url: '/api/v1/schools?page=0',
      });
      expect(resPageZero.statusCode).toBe(400);
      const payloadZero = JSON.parse(resPageZero.payload);
      expect(payloadZero.error.code).toBe('INVALID_QUERY_PARAMETER');
      expect(payloadZero.error.message).toContain('page must be at least 1');

      // Invalid pageSize: 150 (exceeds max 100)
      const resPageSizeMax = await app.inject({
        method: 'GET',
        url: '/api/v1/schools?pageSize=150',
      });
      expect(resPageSizeMax.statusCode).toBe(400);
      const payloadMax = JSON.parse(resPageSizeMax.payload);
      expect(payloadMax.error.code).toBe('INVALID_QUERY_PARAMETER');
      expect(payloadMax.error.message).toContain('pageSize cannot exceed 100');
    });

    it('filters schools by country, administrativeAreaId, and schoolType', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const areaId = 'b0000000-0000-0000-0000-000000000047';
      const countryId = 'a0000000-0000-0000-0000-000000000001';

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/schools?countryId=${countryId}&administrativeAreaId=${areaId}&schoolType=SECONDARY`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockService.listSchools).toHaveBeenCalledWith(
        expect.objectContaining({
          countryId,
          administrativeAreaId: areaId,
          schoolType: 'SECONDARY',
        }),
      );
    });

    it('rejects invalid filter values with 400 Bad Request', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      // Invalid administrativeAreaId format
      const resArea = await app.inject({
        method: 'GET',
        url: '/api/v1/schools?administrativeAreaId=not-a-uuid',
      });
      expect(resArea.statusCode).toBe(400);
      const payloadArea = JSON.parse(resArea.payload);
      expect(payloadArea.error.code).toBe('INVALID_QUERY_PARAMETER');

      // Invalid schoolType value
      const resType = await app.inject({
        method: 'GET',
        url: '/api/v1/schools?schoolType=UNIVERSITY',
      });
      expect(resType.statusCode).toBe(400);
      const payloadType = JSON.parse(resType.payload);
      expect(payloadType.error.code).toBe('INVALID_QUERY_PARAMETER');
      expect(payloadType.error.message).toContain('schoolType must be one of');
    });
  });

  describe('GET /api/v1/schools/:id', () => {
    it('returns a single active school by UUID with 200 OK', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/schools/${mockSchool.id}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();

      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('data');
      expect(payload.data.id).toBe(mockSchool.id);
      expect(payload.data.name).toBe('Alliance High School');
      expect(payload.data.code).toBe('AHS001');
      expect(payload.data.schoolType).toBe('SECONDARY');
      expect(payload.data.status).toBe('ACTIVE');
      expect(payload.data.country.name).toBe('Kenya');
      expect(payload.data.administrativeArea.name).toBe('Nairobi');
      expect(payload.data.createdAt).toBeDefined();
      expect(payload.data.updatedAt).toBeDefined();
    });

    it('returns 400 INVALID_PARAMETER when ID is not a valid UUID', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/schools/invalid-uuid-string',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_PARAMETER');
      expect(payload.error.message).toContain('Invalid school UUID format');
    });

    it('returns 404 SCHOOL_NOT_FOUND when school does not exist', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const unknownId = 'e0000000-0000-0000-0000-000000000099';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/schools/${unknownId}`,
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('SCHOOL_NOT_FOUND');
      expect(payload.error.message).toBe('School not found');
    });

    it('returns 404 SCHOOL_NOT_FOUND for inactive schools on public endpoint', async () => {
      // Service returns null when school is inactive, in accordance with public-data principle
      const mockService = createMockService({
        getSchoolById: vi.fn().mockResolvedValue(null),
      });
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const inactiveSchoolId = 'c0000000-0000-0000-0000-000000000002';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/schools/${inactiveSchoolId}`,
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('SCHOOL_NOT_FOUND');
    });

    it('propagates client-provided x-request-id in headers and error envelope', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { schoolService: mockService },
      });

      const customReqId = 'req-trace-schools-test-123';
      const unknownId = 'e0000000-0000-0000-0000-000000000099';

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/schools/${unknownId}`,
        headers: {
          'x-request-id': customReqId,
        },
      });

      expect(response.headers['x-request-id']).toBe(customReqId);
      const payload = JSON.parse(response.payload);
      expect(payload.error.requestId).toBe(customReqId);
    });
  });
});
