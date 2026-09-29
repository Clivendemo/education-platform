import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  SearchService,
  SearchResultItem,
} from '../../src/services/search.service.js';

describe('Public Search API Routes (/api/v1/search/resources & /api/v1/search)', () => {
  const mockSearchResult: SearchResultItem = {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Grade 10 Mathematics Past Paper 2026',
    slug: 'grade-10-mathematics-past-paper-2026',
    description: 'Sample CBC Grade 10 mathematics examination',
    qualityLabel: 'VERIFIED',
    searchScore: 0.85,
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
    school: null,
    academicYear: 2026,
    term: 1,
    publishedVersion: {
      id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      versionNumber: 1,
      versionLabel: 'v1.0.0',
      title: 'Grade 10 Mathematics Past Paper 2026',
      publishedAt: '2026-03-01T08:00:00.000Z',
    },
    fileCount: 1,
    primaryFile: {
      id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      originalFilename: 'exam.pdf',
      fileExtension: 'pdf',
      fileType: 'DOCUMENT',
      mimeType: 'application/pdf',
      fileSizeBytes: 1048576,
    },
  };

  let mockSearchService: SearchService;

  beforeEach(() => {
    mockSearchService = {
      searchResources: vi.fn().mockResolvedValue({
        data: [mockSearchResult],
        meta: {
          page: 1,
          pageSize: 20,
          total: 1,
          hasMore: false,
        },
      }),
    };
  });

  it('performs a valid search and returns 200 with result payload and request ID header', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=mathematics',
      headers: {
        'x-request-id': 'req-search-test-001',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-search-test-001');

    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('11111111-1111-1111-1111-111111111111');
    expect(body.data[0].title).toBe('Grade 10 Mathematics Past Paper 2026');
    expect(body.meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 1,
      hasMore: false,
    });

    expect(mockSearchService.searchResources).toHaveBeenCalledWith({
      q: 'mathematics',
      page: 1,
      pageSize: 20,
    });
  });

  it('supports the compatibility route /api/v1/search equivalently', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=calculus',
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.data).toHaveLength(1);
    expect(mockSearchService.searchResources).toHaveBeenCalledWith({
      q: 'calculus',
      page: 1,
      pageSize: 20,
    });
  });

  it('rejects missing search query q with 400 VALIDATION_ERROR', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/Search query 'q'/);
    expect(mockSearchService.searchResources).not.toHaveBeenCalled();
  });

  it('rejects empty search query q with 400 VALIDATION_ERROR', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/must not be empty/);
    expect(mockSearchService.searchResources).not.toHaveBeenCalled();
  });

  it('rejects whitespace-only search query q with 400 VALIDATION_ERROR', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=%20%20%20',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toMatch(/must not be empty/);
    expect(mockSearchService.searchResources).not.toHaveBeenCalled();
  });

  it('forwards structured catalogue filters combined with search query', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=physics&country=ke&grade=grade-10&subject=physics&quality=VERIFIED&academicYear=2026&term=2&page=2&pageSize=15',
    });

    expect(response.statusCode).toBe(200);
    expect(mockSearchService.searchResources).toHaveBeenCalledWith({
      q: 'physics',
      country: 'ke',
      grade: 'grade-10',
      subject: 'physics',
      quality: 'VERIFIED',
      academicYear: 2026,
      term: 2,
      page: 2,
      pageSize: 15,
    });
  });

  it('rejects invalid page and pageSize bounds with 400 VALIDATION_ERROR', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    // page < 1
    const res1 = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=test&page=0',
    });
    expect(res1.statusCode).toBe(400);
    expect(res1.json().error.code).toBe('VALIDATION_ERROR');

    // pageSize > 100
    const res2 = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=test&pageSize=101',
    });
    expect(res2.statusCode).toBe(400);
    expect(res2.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects invalid quality label with 400 VALIDATION_ERROR', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=test&quality=INVALID_LABEL',
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe('VALIDATION_ERROR');
  });

  it('ensures zero storage secrets or internal database fields are leaked in response', async () => {
    const app = buildApp({
      services: { searchService: mockSearchService },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/search/resources?q=math',
    });

    expect(response.statusCode).toBe(200);
    const text = response.body;

    expect(text).not.toContain('storage_bucket');
    expect(text).not.toContain('object_key');
    expect(text).not.toContain('storage_provider');
    expect(text).not.toContain('storage_metadata');
    expect(text).not.toContain('r2');
  });
});
