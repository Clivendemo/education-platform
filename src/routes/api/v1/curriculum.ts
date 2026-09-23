import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import {
  CurriculumService,
  defaultCurriculumService,
} from '../../../services/curriculum.service.js';

export interface CurriculumRouteOptions {
  curriculumService?: CurriculumService;
}

const ListCurriculaQuerySchema = z.object({
  country: z.string().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  page: z.coerce.number().int().min(1, 'page must be at least 1').default(1),
  pageSize: z.coerce
    .number()
    .int()
    .min(1, 'pageSize must be at least 1')
    .max(100, 'pageSize cannot exceed 100')
    .default(20),
});

const IdParamSchema = z.object({
  id: z.string().uuid('Invalid UUID format'),
});

const VersionsQuerySchema = z.object({
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

const TopicsQuerySchema = z.object({
  parentId: z.string().uuid('Invalid parent UUID format').optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
});

export const curriculumRoutes: FastifyPluginAsync<
  CurriculumRouteOptions
> = async (fastify, opts) => {
  const service = opts.curriculumService ?? defaultCurriculumService;

  /**
   * GET /api/v1/curricula
   * List curricula with optional country filter and pagination.
   */
  fastify.get('/curricula', async (request, reply) => {
    const queryResult = ListCurriculaQuerySchema.safeParse(request.query);
    if (!queryResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_QUERY_PARAMETER',
          message:
            queryResult.error.issues[0]?.message ?? 'Invalid query parameters',
          requestId: request.id,
        },
      });
    }

    const { country, status, page, pageSize } = queryResult.data;
    const result = await service.listCurricula({
      country,
      status,
      page,
      pageSize,
    });

    return reply.status(200).send(result);
  });

  /**
   * GET /api/v1/curricula/:id
   * Get curriculum by UUID.
   */
  fastify.get('/curricula/:id', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid curriculum UUID',
          requestId: request.id,
        },
      });
    }

    const curriculum = await service.getCurriculumById(paramResult.data.id);
    if (!curriculum) {
      return reply.status(404).send({
        error: {
          code: 'CURRICULUM_NOT_FOUND',
          message: 'Curriculum not found',
          requestId: request.id,
        },
      });
    }

    return reply.status(200).send({
      data: curriculum,
    });
  });

  /**
   * GET /api/v1/curricula/:id/versions
   * Get version history for a curriculum.
   */
  fastify.get('/curricula/:id/versions', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid curriculum UUID',
          requestId: request.id,
        },
      });
    }

    const queryResult = VersionsQuerySchema.safeParse(request.query);
    const includeInactive = queryResult.success
      ? queryResult.data.includeInactive
      : false;

    // Check if curriculum exists
    const curriculum = await service.getCurriculumById(paramResult.data.id);
    if (!curriculum) {
      return reply.status(404).send({
        error: {
          code: 'CURRICULUM_NOT_FOUND',
          message: 'Curriculum not found',
          requestId: request.id,
        },
      });
    }

    const versions = await service.listCurriculumVersions(
      paramResult.data.id,
      { includeInactive },
    );

    return reply.status(200).send({
      data: versions,
    });
  });

  /**
   * GET /api/v1/curriculum-versions/:id/levels
   * Get education levels under a curriculum version, deterministically ordered.
   */
  fastify.get('/curriculum-versions/:id/levels', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ??
            'Invalid curriculum version UUID',
          requestId: request.id,
        },
      });
    }

    const version = await service.getCurriculumVersionById(paramResult.data.id);
    if (!version) {
      return reply.status(404).send({
        error: {
          code: 'CURRICULUM_VERSION_NOT_FOUND',
          message: 'Curriculum version not found',
          requestId: request.id,
        },
      });
    }

    const levels = await service.listEducationLevels(paramResult.data.id);
    return reply.status(200).send({
      data: levels,
    });
  });

  /**
   * GET /api/v1/education-levels/:id/grades
   * Get grades under an education level, deterministically ordered.
   */
  fastify.get('/education-levels/:id/grades', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ??
            'Invalid education level UUID',
          requestId: request.id,
        },
      });
    }

    const gradesList = await service.listGrades(paramResult.data.id);
    return reply.status(200).send({
      data: gradesList,
    });
  });

  /**
   * GET /api/v1/grades/:id/pathways
   * Get specialization pathways under a grade (optional in hierarchy).
   */
  fastify.get('/grades/:id/pathways', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid grade UUID',
          requestId: request.id,
        },
      });
    }

    const pathwaysList = await service.listPathways(paramResult.data.id);
    return reply.status(200).send({
      data: pathwaysList,
    });
  });

  /**
   * GET /api/v1/grades/:id/subjects
   * Get subjects under a grade (for grades without pathways or direct subjects).
   */
  fastify.get('/grades/:id/subjects', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid grade UUID',
          requestId: request.id,
        },
      });
    }

    const subjectsList = await service.listSubjects({
      gradeId: paramResult.data.id,
    });
    return reply.status(200).send({
      data: subjectsList,
    });
  });

  /**
   * GET /api/v1/pathways/:id/subjects
   * Get subjects under a specialization pathway.
   */
  fastify.get('/pathways/:id/subjects', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid pathway UUID',
          requestId: request.id,
        },
      });
    }

    const subjectsList = await service.listSubjects({
      pathwayId: paramResult.data.id,
    });
    return reply.status(200).send({
      data: subjectsList,
    });
  });

  /**
   * GET /api/v1/subjects/:id/topics
   * Get topics under a subject, deterministically ordered.
   */
  fastify.get('/subjects/:id/topics', async (request, reply) => {
    const paramResult = IdParamSchema.safeParse(request.params);
    if (!paramResult.success) {
      return reply.status(400).send({
        error: {
          code: 'INVALID_PARAMETER',
          message:
            paramResult.error.issues[0]?.message ?? 'Invalid subject UUID',
          requestId: request.id,
        },
      });
    }

    const queryResult = TopicsQuerySchema.safeParse(request.query);
    const parentId = queryResult.success ? queryResult.data.parentId : undefined;
    const includeInactive = queryResult.success
      ? queryResult.data.includeInactive
      : false;

    const topicsList = await service.listTopics(paramResult.data.id, {
      parentId,
      includeInactive,
    });

    return reply.status(200).send({
      data: topicsList,
    });
  });
};
