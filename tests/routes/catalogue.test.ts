import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  CatalogueService,
  CatalogueResourceSummary,
  CatalogueResourceDetail,
} from '../../src/services/catalogue.service.js';

describe('Public Catalogue API Routes (/api/v1/catalogue/resources)', () => {
  const mockSummaryResource: CatalogueResourceSummary = {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Grade 10 Mathematics Past Paper 2026',
    slug: 'grade-10-mathematics-past-paper-2026',
    description: 'Sample CBC Grade 10 mathematics examination',
    qualityLabel: 'VERIFIED',
    resourceType: {
      id: '22222222-2222-2222-2222-222222222222',
      code: 'PAST_PAPER',
      name: 'Past Papers & Examinations',
      slug: 'past-papers',
      pillar: 'PAST_PAPERS',
    },
    country: {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Kenya',
      isoCode: 'KE',
      urlPrefix: 'ke',
    },
    curriculum: {
      id: '44444444-4444-4444-4444-444444444444',
      code: 'CBC',
      name: 'Competency-Based Curriculum',
    },
    curriculumVersion: {
      id: '55555555-5555-5555-5555-555555555555',
      versionName: 'CBC 2024 Edition',
      versionCode: 'CBC-2024',
      slug: 'cbc-2024',
    },
    educationLevel: {
      id: '66666666-6666-6666-6666-666666666666',
      code: 'SENIOR_SCHOOL',
      name: 'Senior School',
    },
    grade: {
      id: '77777777-7777-7777-7777-777777777777',
      code: 'GRADE_10',
      name: 'Grade 10',
    },
    pathway: {
      id: '88888888-8888-8888-8888-888888888888',
      code: 'STEM',
      name: 'STEM',
    },
    subject: {
      id: '99999999-9999-9999-9999-999999999999',
      code: 'MATH',
      name: 'Mathematics',
    },
    topic: null,
    school: {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      name: 'Alliance High School',
      code: 'ALLIANCE_BOYS',
    },
    academicYear: 2026,
    term: 1,
    publishedVersion: {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      versionNumber: 1,
      versionLabel: 'v1.0',
      title: 'Grade 10 Mathematics Past Paper 2026',
      publishedAt: '2026-01-15T08:00:00.000Z',
    },
    fileCount: 1,
    primaryFile: {
      id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      originalFilename: 'exam_paper.pdf',
      fileExtension: 'pdf',
      fileType: 'MAIN_DOCUMENT',
      mimeType: 'application/pdf',
      fileSizeBytes: 2048576,
    },
  };

  const mockDetailResource: CatalogueResourceDetail = {
    ...mockSummaryResource,
    sourceName: 'KNEC',
    sourceReference: 'KNEC-G10-MATH-2026',
    files: [
      {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        originalFilename: 'exam_paper.pdf',
        fileExtension: 'pdf',
        fileType: 'MAIN_DOCUMENT',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048576,
        isPrimary: true,
        sequenceOrder: 1,
      },
    ],
  };

  let mockCatalogueService: CatalogueService;

  beforeEach(() => {
    mockCatalogueService = {
      listCatalogueResources: vi.fn().mockResolvedValue({
        data: [mockSummaryResource],
        meta: {
          page: 1,
          pageSize: 20,
          total: 1,
          hasMore: false,
        },
      }),
      getCatalogueResourceById: vi.fn().mockImplementation(async (id: string) => {
        if (id === mockDetailResource.id) {
          return mockDetailResource;
        }
        return null;
      }),
    };
  });

  describe('GET /api/v1/catalogue/resources', () => {
    it('returns 200 with default paginated catalogue resources', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/catalogue/resources',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json).toHaveProperty('data');
      expect(json).toHaveProperty('meta');
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.data.length).toBe(1);
      expect(json.data[0].id).toBe(mockSummaryResource.id);
      expect(json.data[0].qualityLabel).toBe('VERIFIED');
      expect(json.data[0].publishedVersion.versionNumber).toBe(1);
      expect(json.meta).toEqual({
        page: 1,
        pageSize: 20,
        total: 1,
        hasMore: false,
      });

      expect(mockCatalogueService.listCatalogueResources).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
        sort: 'newest',
      });
    });

    it('passes structured filters to service correctly', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/catalogue/resources?country=ke&resourceType=past-papers&curriculum=CBC&grade=GRADE_10&pathway=STEM&subject=MATH&quality=VERIFIED&sort=title&page=2&pageSize=10',
      });

      expect(response.statusCode).toBe(200);
      expect(mockCatalogueService.listCatalogueResources).toHaveBeenCalledWith({
        country: 'ke',
        resourceType: 'past-papers',
        curriculum: 'CBC',
        grade: 'GRADE_10',
        pathway: 'STEM',
        subject: 'MATH',
        quality: 'VERIFIED',
        sort: 'title',
        page: 2,
        pageSize: 10,
      });
    });

    it('returns 400 when quality label is invalid', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/catalogue/resources?quality=SUPER_PREMIUM',
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('returns 400 when pageSize exceeds 100', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/catalogue/resources?pageSize=150',
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
      expect(json.error.message).toContain('pageSize cannot exceed 100');
    });

    it('returns 400 when academicYear is out of allowed range', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/catalogue/resources?academicYear=1800',
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('GET /api/v1/catalogue/resources/:id', () => {
    it('returns 200 with detail and presentation file metadata for published resource', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${mockDetailResource.id}`,
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.id).toBe(mockDetailResource.id);
      expect(json.data.title).toBe(mockDetailResource.title);
      expect(json.data.files).toHaveLength(1);
      expect(json.data.files[0]).toEqual({
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        originalFilename: 'exam_paper.pdf',
        fileExtension: 'pdf',
        fileType: 'MAIN_DOCUMENT',
        mimeType: 'application/pdf',
        fileSizeBytes: 2048576,
        isPrimary: true,
        sequenceOrder: 1,
      });

      // Strict security assertion: no storage bucket, object key, or R2 credentials exposed
      expect(json.data.files[0].storageBucket).toBeUndefined();
      expect(json.data.files[0].objectKey).toBeUndefined();
      expect(json.data.files[0].storageProvider).toBeUndefined();
      expect(json.data.files[0].storageMetadata).toBeUndefined();
    });

    it('returns 400 when resource id is not a valid UUID', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/catalogue/resources/invalid-uuid-string',
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('INVALID_ID_FORMAT');
      expect(json.error.message).toContain('must be a valid UUID');
    });

    it('returns 404 when resource does not exist or is not publicly published', async () => {
      const app = buildApp({
        services: { catalogueService: mockCatalogueService },
      });

      const nonExistentId = '99999999-9999-9999-9999-999999999999';
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/catalogue/resources/${nonExistentId}`,
      });

      expect(response.statusCode).toBe(404);
      const json = response.json();
      expect(json.error.code).toBe('RESOURCE_NOT_FOUND');
      expect(json.error.message).toBe(`Resource with id '${nonExistentId}' was not found.`);
    });
  });
});
