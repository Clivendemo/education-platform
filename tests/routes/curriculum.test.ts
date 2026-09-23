import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import type {
  CurriculumService,
  CurriculumResult,
  CurriculumVersionResult,
  EducationLevelResult,
  GradeResult,
  PathwayResult,
  SubjectResult,
  TopicResult,
  ListCurriculaResult,
} from '../../src/services/curriculum.service.js';

describe('Curriculum API Routes (/api/v1/curricula)', () => {
  const mockCountry = {
    id: '10000000-0000-0000-0000-000000000001',
    name: 'Kenya',
    isoCode: 'KE',
  };

  const mockCurriculum: CurriculumResult = {
    id: '20000000-0000-0000-0000-000000000001',
    name: 'Competency-Based Curriculum',
    slug: 'cbc',
    code: 'CBC',
    description: 'National curriculum',
    status: 'ACTIVE',
    country: mockCountry,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockVersion: CurriculumVersionResult = {
    id: '30000000-0000-0000-0000-000000000001',
    curriculumId: mockCurriculum.id,
    countryId: mockCountry.id,
    versionName: 'CBC 2024',
    versionCode: 'CBC-2024',
    slug: 'cbc-2024',
    effectiveFrom: '2024-01-01',
    effectiveTo: null,
    status: 'CURRENT',
    description: 'Current 2024 framework',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockLevel: EducationLevelResult = {
    id: '40000000-0000-0000-0000-000000000001',
    curriculumVersionId: mockVersion.id,
    name: 'Senior School',
    slug: 'senior-school',
    code: 'SS',
    description: 'Grades 10-12',
    sequenceOrder: 4,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockGrade: GradeResult = {
    id: '50000000-0000-0000-0000-000000000001',
    curriculumVersionId: mockVersion.id,
    educationLevelId: mockLevel.id,
    name: 'Grade 10',
    slug: 'grade-10',
    code: 'G10',
    description: 'Grade 10',
    sequenceOrder: 10,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockPathway: PathwayResult = {
    id: '60000000-0000-0000-0000-000000000001',
    curriculumVersionId: mockVersion.id,
    educationLevelId: mockLevel.id,
    gradeId: mockGrade.id,
    name: 'STEM',
    slug: 'stem',
    code: 'STEM',
    description: 'Science & Math',
    sequenceOrder: 1,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockSubject: SubjectResult = {
    id: '70000000-0000-0000-0000-000000000001',
    curriculumVersionId: mockVersion.id,
    educationLevelId: mockLevel.id,
    gradeId: mockGrade.id,
    pathwayId: mockPathway.id,
    name: 'Advanced Mathematics',
    slug: 'advanced-mathematics',
    code: 'MATH',
    description: 'Calculus and Algebra',
    sequenceOrder: 1,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const mockTopic: TopicResult = {
    id: '80000000-0000-0000-0000-000000000001',
    curriculumVersionId: mockVersion.id,
    subjectId: mockSubject.id,
    parentId: null,
    name: 'Algebra',
    slug: 'algebra',
    code: 'ALG',
    description: 'Polynomials & equations',
    sequenceOrder: 1,
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const createMockService = (
    overrides: Partial<CurriculumService> = {},
  ): CurriculumService => ({
    listCurricula: vi.fn().mockResolvedValue({
      data: [mockCurriculum],
      meta: { page: 1, pageSize: 20, total: 1, hasMore: false },
    } as ListCurriculaResult),
    getCurriculumById: vi.fn().mockImplementation(async (id: string) => {
      if (id === mockCurriculum.id) return mockCurriculum;
      return null;
    }),
    listCurriculumVersions: vi.fn().mockResolvedValue([mockVersion]),
    getCurriculumVersionById: vi.fn().mockImplementation(async (id: string) => {
      if (id === mockVersion.id) return mockVersion;
      return null;
    }),
    listEducationLevels: vi.fn().mockResolvedValue([mockLevel]),
    listGrades: vi.fn().mockResolvedValue([mockGrade]),
    listPathways: vi.fn().mockResolvedValue([mockPathway]),
    listSubjects: vi.fn().mockResolvedValue([mockSubject]),
    listTopics: vi.fn().mockResolvedValue([mockTopic]),
    ...overrides,
  });

  describe('GET /api/v1/curricula', () => {
    it('returns a paginated list of curricula with 200 OK and response envelope', async () => {
      const mockService = createMockService();
      const app = buildApp({
        services: { curriculumService: mockService },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/curricula',
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers['x-request-id']).toBeDefined();

      const payload = JSON.parse(response.payload);
      expect(payload).toHaveProperty('data');
      expect(payload).toHaveProperty('meta');
      expect(Array.isArray(payload.data)).toBe(true);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].name).toBe('Competency-Based Curriculum');
    });

    it('rejects invalid query parameters with 400 BAD REQUEST', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/curricula?page=-1',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_QUERY_PARAMETER');
    });
  });

  describe('GET /api/v1/curricula/:id', () => {
    it('returns curriculum by UUID with 200 OK', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/curricula/${mockCurriculum.id}`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data.id).toBe(mockCurriculum.id);
      expect(payload.data.slug).toBe('cbc');
    });

    it('returns 404 CURRICULUM_NOT_FOUND when curriculum does not exist', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/curricula/a0000000-0000-0000-0000-999999999999',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('CURRICULUM_NOT_FOUND');
    });

    it('returns 400 INVALID_PARAMETER when ID format is not a UUID', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/curricula/not-a-uuid',
      });

      expect(response.statusCode).toBe(400);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('INVALID_PARAMETER');
    });
  });

  describe('GET /api/v1/curricula/:id/versions', () => {
    it('returns curriculum versions with 200 OK', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/curricula/${mockCurriculum.id}/versions`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data).toHaveLength(1);
      expect(payload.data[0].versionName).toBe('CBC 2024');
    });
  });

  describe('GET /api/v1/curriculum-versions/:id/levels', () => {
    it('returns education levels for version with 200 OK', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/curriculum-versions/${mockVersion.id}/levels`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data[0].name).toBe('Senior School');
      expect(payload.data[0].sequenceOrder).toBe(4);
    });

    it('returns 404 when curriculum version does not exist', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/curriculum-versions/b0000000-0000-0000-0000-000000000099/levels',
      });

      expect(response.statusCode).toBe(404);
      const payload = JSON.parse(response.payload);
      expect(payload.error.code).toBe('CURRICULUM_VERSION_NOT_FOUND');
    });
  });

  describe('GET /api/v1/education-levels/:id/grades', () => {
    it('returns grades under an education level with 200 OK', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/education-levels/${mockLevel.id}/grades`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data[0].name).toBe('Grade 10');
      expect(payload.data[0].sequenceOrder).toBe(10);
    });
  });

  describe('GET /api/v1/grades/:id/pathways', () => {
    it('returns pathways under a grade with 200 OK', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/grades/${mockGrade.id}/pathways`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data[0].name).toBe('STEM');
    });
  });

  describe('GET /api/v1/pathways/:id/subjects', () => {
    it('returns subjects under a pathway with 200 OK', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/pathways/${mockPathway.id}/subjects`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data[0].name).toBe('Advanced Mathematics');
    });
  });

  describe('GET /api/v1/subjects/:id/topics', () => {
    it('returns topics under a subject with 200 OK', async () => {
      const app = buildApp({
        services: { curriculumService: createMockService() },
      });

      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/subjects/${mockSubject.id}/topics`,
      });

      expect(response.statusCode).toBe(200);
      const payload = JSON.parse(response.payload);
      expect(payload.data[0].name).toBe('Algebra');
      expect(payload.data[0].sequenceOrder).toBe(1);
    });
  });
});
