import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type { SeoService, ResourceSeoMetadata } from '../../src/services/seo.service.js';

describe('Public Resource SEO API Route (/api/v1/seo/resources/:id)', () => {
  const mockSeoMetadata: ResourceSeoMetadata = {
    id: '11111111-1111-1111-1111-111111111111',
    slug: 'grade-10-mathematics-past-paper-2026',
    title: 'Grade 10 Mathematics Past Paper 2026',
    description: 'Sample CBC Grade 10 mathematics examination revision notes and paper.',
    canonicalUrl: 'http://localhost:3000/ke/resources/grade-10-mathematics-past-paper-2026',
    country: {
      id: '33333333-3333-3333-3333-333333333333',
      name: 'Kenya',
      isoCode: 'KE',
      urlPrefix: 'ke',
    },
    openGraph: {
      title: 'Grade 10 Mathematics Past Paper 2026',
      description: 'Sample CBC Grade 10 mathematics examination revision notes and paper.',
      url: 'http://localhost:3000/ke/resources/grade-10-mathematics-past-paper-2026',
      type: 'article',
      siteName: 'ElimuPin',
      locale: 'en_KE',
    },
    twitter: {
      card: 'summary',
      title: 'Grade 10 Mathematics Past Paper 2026',
      description: 'Sample CBC Grade 10 mathematics examination revision notes and paper.',
    },
    robots: {
      index: true,
      follow: true,
    },
  };

  let mockSeoService: SeoService;

  beforeEach(() => {
    mockSeoService = {
      getResourceSeoMetadata: vi.fn(),
    };
  });

  it('returns 200 with complete SEO metadata and request ID header for published resource', async () => {
    vi.mocked(mockSeoService.getResourceSeoMetadata).mockResolvedValueOnce(mockSeoMetadata);

    const app = buildApp({
      services: {
        seoService: mockSeoService,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seo/resources/11111111-1111-1111-1111-111111111111',
      headers: {
        'x-request-id': 'req-seo-test-1',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['x-request-id']).toBe('req-seo-test-1');

    const json = response.json();
    expect(json.data).toBeDefined();
    expect(json.data.id).toBe('11111111-1111-1111-1111-111111111111');
    expect(json.data.title).toBe('Grade 10 Mathematics Past Paper 2026');
    expect(json.data.canonicalUrl).toBe(
      'http://localhost:3000/ke/resources/grade-10-mathematics-past-paper-2026',
    );
    expect(json.data.openGraph).toEqual({
      title: 'Grade 10 Mathematics Past Paper 2026',
      description: 'Sample CBC Grade 10 mathematics examination revision notes and paper.',
      url: 'http://localhost:3000/ke/resources/grade-10-mathematics-past-paper-2026',
      type: 'article',
      siteName: 'ElimuPin',
      locale: 'en_KE',
    });
    expect(json.data.twitter).toEqual({
      card: 'summary',
      title: 'Grade 10 Mathematics Past Paper 2026',
      description: 'Sample CBC Grade 10 mathematics examination revision notes and paper.',
    });
    expect(json.data.robots).toEqual({
      index: true,
      follow: true,
    });
  });

  it('rejects invalid UUID parameter with 400 INVALID_ID_FORMAT and does not perform slug search', async () => {
    const app = buildApp({
      services: {
        seoService: mockSeoService,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seo/resources/not-a-valid-uuid',
      headers: {
        'x-request-id': 'req-seo-invalid-uuid',
      },
    });

    expect(response.statusCode).toBe(400);
    const json = response.json();
    expect(json.error.code).toBe('INVALID_ID_FORMAT');
    expect(json.error.requestId).toBe('req-seo-invalid-uuid');
    expect(mockSeoService.getResourceSeoMetadata).not.toHaveBeenCalled();
  });

  it('returns 404 RESOURCE_NOT_FOUND when resource does not exist or is unpublished', async () => {
    vi.mocked(mockSeoService.getResourceSeoMetadata).mockResolvedValueOnce(null);

    const app = buildApp({
      services: {
        seoService: mockSeoService,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seo/resources/00000000-0000-0000-0000-000000000000',
      headers: {
        'x-request-id': 'req-seo-not-found',
      },
    });

    expect(response.statusCode).toBe(404);
    const json = response.json();
    expect(json.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(json.error.requestId).toBe('req-seo-not-found');
  });

  it('ensures zero storage secrets, R2 credentials, bucket names, or object keys are leaked', async () => {
    vi.mocked(mockSeoService.getResourceSeoMetadata).mockResolvedValueOnce(mockSeoMetadata);

    const app = buildApp({
      services: {
        seoService: mockSeoService,
      },
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/seo/resources/11111111-1111-1111-1111-111111111111',
    });

    expect(response.statusCode).toBe(200);
    const rawBody = response.body;

    expect(rawBody).not.toMatch(/bucket/i);
    expect(rawBody).not.toMatch(/r2/i);
    expect(rawBody).not.toMatch(/object_key/i);
    expect(rawBody).not.toMatch(/objectKey/i);
    expect(rawBody).not.toMatch(/secret/i);
    expect(rawBody).not.toMatch(/accessKey/i);
  });
});
