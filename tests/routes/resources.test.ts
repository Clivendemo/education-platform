import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  ResourceService,
  ResourceTypeResult,
  ResourceDetailResult,
  ResourceVersionResult,
} from '../../src/services/resource.service.js';

describe('Resource API Routes (/api/v1/resources & /api/v1/resource-types)', () => {
  const mockResourceType: ResourceTypeResult = {
    id: '10000000-0000-0000-0000-000000000001',
    code: 'PAST_PAPER',
    name: 'Past Papers & Examinations',
    slug: 'past-papers',
    pillar: 'PAST_PAPERS',
    description: 'Summative examinations and mock papers',
    status: 'ACTIVE',
    sequenceOrder: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockResource: ResourceDetailResult = {
    id: '20000000-0000-0000-0000-000000000001',
    country: {
      id: '30000000-0000-0000-0000-000000000001',
      name: 'Kenya',
      isoCode: 'KE',
    },
    resourceType: {
      id: mockResourceType.id,
      code: mockResourceType.code,
      name: mockResourceType.name,
      slug: mockResourceType.slug,
      pillar: mockResourceType.pillar,
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
    title: '[STRUCTURAL-TEST] Generic Academic Term Calendar 2026',
    slug: 'test-generic-academic-calendar-2026',
    description: 'Sample description for testing.',
    status: 'PUBLISHED',
    qualityLabel: 'STANDARD',
    sourceName: 'Sample Board',
    sourceReference: 'REF-001',
    academicYear: 2026,
    term: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestVersion: {
      id: '40000000-0000-0000-0000-000000000001',
      resourceId: '20000000-0000-0000-0000-000000000001',
      versionNumber: 1,
      versionLabel: 'v1.0',
      title: '[STRUCTURAL-TEST] Generic Academic Term Calendar 2026 (Edition 1)',
      description: 'First version',
      changeSummary: 'Initial publication',
      status: 'PUBLISHED',
      qualityLabel: 'STANDARD',
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };

  const mockVersion: ResourceVersionResult = {
    id: '40000000-0000-0000-0000-000000000001',
    resourceId: mockResource.id,
    versionNumber: 1,
    versionLabel: 'v1.0',
    title: '[STRUCTURAL-TEST] Generic Academic Term Calendar 2026 (Edition 1)',
    description: 'First version',
    changeSummary: 'Initial publication',
    status: 'PUBLISHED',
    qualityLabel: 'STANDARD',
    publishedAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  let mockResourceService: ResourceService;

  beforeEach(() => {
    mockResourceService = {
      listResourceTypes: vi.fn().mockResolvedValue([mockResourceType]),
      listResources: vi.fn().mockResolvedValue({
        data: [mockResource],
        meta: { page: 1, pageSize: 20, total: 1, hasMore: false },
      }),
      getResourceById: vi.fn().mockImplementation(async (id: string) => {
        if (id === mockResource.id) return mockResource;
        return null;
      }),
      listResourceVersions: vi.fn().mockResolvedValue([mockVersion]),
      getResourceVersionById: vi.fn().mockImplementation(async (id: string) => {
        if (id === mockVersion.id) return mockVersion;
        return null;
      }),
      createResourceVersion: vi.fn().mockResolvedValue(mockVersion),
      updateResourceVersion: vi.fn().mockResolvedValue(mockVersion),
    };
  });

  describe('GET /api/v1/resource-types', () => {
    it('returns resource types with 200 OK and response envelope', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-types',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();
      const payload = JSON.parse(response.payload);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].code).toBe('PAST_PAPER');
      expect(payload.data[0].pillar).toBe('PAST_PAPERS');
    });

    it('rejects invalid query parameter with 400 Bad Request', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-types?includeInactive=invalid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error).toBeDefined();
      expect(payload.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/resources', () => {
    it('returns paginated resources with 200 OK and meta envelope', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resources?page=1&pageSize=10',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();
      const payload = JSON.parse(response.payload);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].id).toBe(mockResource.id);
      expect(payload.meta.page).toBe(1);
      expect(payload.meta.total).toBe(1);
    });

    it('rejects invalid pagination parameters with 400 Bad Request', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resources?pageSize=200',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/resources/:id', () => {
    it('returns resource detail for valid UUID', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${mockResource.id}`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.id).toBe(mockResource.id);
      expect(payload.data.qualityLabel).toBe('STANDARD');
    });

    it('returns 404 for nonexistent resource UUID', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resources/99999999-9999-9999-9999-999999999999',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('RESOURCE_NOT_FOUND');
    });

    it('returns 400 for malformed UUID format', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resources/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_ID_FORMAT');
    });
  });

  describe('GET /api/v1/resources/:id/versions', () => {
    it('returns versions list for valid resource UUID', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/resources/${mockResource.id}/versions`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].versionNumber).toBe(1);
    });

    it('returns 404 for versions request on nonexistent resource', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resources/99999999-9999-9999-9999-999999999999/versions',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('RESOURCE_NOT_FOUND');
    });
  });

  describe('GET /api/v1/resource-versions/:id', () => {
    it('returns version detail with 200 OK for valid version UUID', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/resource-versions/${mockVersion.id}`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.id).toBe(mockVersion.id);
      expect(payload.data.versionNumber).toBe(1);
    });

    it('returns 404 for nonexistent version UUID', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-versions/99999999-9999-9999-9999-999999999999',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('RESOURCE_VERSION_NOT_FOUND');
    });

    it('returns 400 for invalid version UUID format', async () => {
      const app = buildApp({ services: { resourceService: mockResourceService } });
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/resource-versions/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_ID_FORMAT');
    });
  });
});
