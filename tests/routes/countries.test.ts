import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  GeographyService,
  CountryResult,
} from '../../src/services/geography.service.js';

describe('Countries API Routes (/api/v1/countries)', () => {
  const mockKenya: CountryResult = {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Kenya',
    isoCode: 'KE',
    urlPrefix: 'ke',
    defaultLanguageCode: 'en',
    currencyCode: 'KES',
    status: 'ACTIVE',
  };

  const createMockService = (
    overrides: Partial<GeographyService> = {},
  ): GeographyService => ({
    listActiveCountries: vi.fn().mockResolvedValue([mockKenya]),
    getActiveCountryByIdentifier: vi.fn().mockImplementation(async (id: string) => {
      if (['ke', 'KE', mockKenya.id].includes(id)) {
        return mockKenya;
      }
      return null;
    }),
    listAreas: vi.fn().mockResolvedValue({
      data: [],
      meta: { page: 1, pageSize: 50, total: 0, hasMore: false },
    }),
    getAreaById: vi.fn().mockResolvedValue(null),
    getChildAreas: vi.fn().mockResolvedValue([]),
    ...overrides,
  });

  describe('GET /api/v1/countries', () => {
    it('returns a list of active countries with 200 OK and response envelope', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/countries',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();

      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('data');
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0]).toMatchObject({
        id: mockKenya.id,
        name: 'Kenya',
        isoCode: 'KE',
        urlPrefix: 'ke',
        status: 'ACTIVE',
      });
      expect(mockService.listActiveCountries).toHaveBeenCalledTimes(1);
    });
  });

  describe('GET /api/v1/countries/:identifier', () => {
    it('returns country details when found by ISO code', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/countries/KE',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.isoCode).toBe('KE');
      expect(payload.data.name).toBe('Kenya');
      expect(mockService.getActiveCountryByIdentifier).toHaveBeenCalledWith('KE');
    });

    it('returns country details when found by URL prefix', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/countries/ke',
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.urlPrefix).toBe('ke');
    });

    it('returns country details when found by UUID', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/countries/${mockKenya.id}`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.id).toBe(mockKenya.id);
    });

    it('returns 404 with COUNTRY_NOT_FOUND when country does not exist', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/countries/unknown-country',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error).toMatchObject({
        code: 'COUNTRY_NOT_FOUND',
        message: 'The requested country was not found.',
      });
      expect(payload.error.requestId).toBeDefined();
    });

    it('returns 400 with INVALID_PARAMETER when identifier has invalid characters', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { geographyService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/countries/invalid*slug!',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_PARAMETER');
    });
  });
});
