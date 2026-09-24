import { eq, and, or, count, desc, asc } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import {
  resourceTypes,
  resources,
  resourceVersions,
  countries,
  schools,
} from '../db/schemas.js';

export interface ResourceTypeResult {
  id: string;
  code: string;
  name: string;
  slug: string;
  pillar: string;
  description: string | null;
  status: string;
  sequenceOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceVersionResult {
  id: string;
  resourceId: string;
  versionNumber: number;
  versionLabel: string;
  title: string;
  description: string | null;
  changeSummary: string | null;
  status: string;
  qualityLabel: string;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ResourceDetailResult {
  id: string;
  country: {
    id: string;
    name: string;
    isoCode: string;
  };
  resourceType: {
    id: string;
    code: string;
    name: string;
    slug: string;
    pillar: string;
  };
  school: {
    id: string;
    name: string;
    code: string | null;
  } | null;
  curriculum: {
    curriculumId: string | null;
    curriculumVersionId: string | null;
    educationLevelId: string | null;
    gradeId: string | null;
    pathwayId: string | null;
    subjectId: string | null;
    topicId: string | null;
  };
  title: string;
  slug: string;
  description: string | null;
  status: string;
  qualityLabel: string;
  sourceName: string | null;
  sourceReference: string | null;
  academicYear: number | null;
  term: number | null;
  createdAt: string;
  updatedAt: string;
  latestVersion?: ResourceVersionResult | null;
}

export interface ListResourcesParams {
  country?: string;
  resourceType?: string;
  status?: string;
  qualityLabel?: string;
  gradeId?: string;
  subjectId?: string;
  schoolId?: string;
  academicYear?: number;
  term?: number;
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface CreateResourceVersionInput {
  resourceId: string;
  versionNumber?: number;
  versionLabel?: string;
  title: string;
  description?: string | null;
  changeSummary?: string | null;
  status?: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
  qualityLabel?: 'STANDARD' | 'VERIFIED' | 'PREMIUM';
  publishedAt?: Date | null;
}

export interface UpdateResourceVersionInput {
  title?: string;
  versionLabel?: string;
  description?: string | null;
  changeSummary?: string | null;
  status?: 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'PUBLISHED' | 'ARCHIVED' | 'REJECTED';
  qualityLabel?: 'STANDARD' | 'VERIFIED' | 'PREMIUM';
}

export interface ResourceService {
  listResourceTypes(options?: { includeInactive?: boolean }): Promise<ResourceTypeResult[]>;
  listResources(params?: ListResourcesParams): Promise<PaginatedResult<ResourceDetailResult>>;
  getResourceById(id: string): Promise<ResourceDetailResult | null>;
  listResourceVersions(
    resourceId: string,
    options?: { includeUnpublished?: boolean },
  ): Promise<ResourceVersionResult[]>;
  getResourceVersionById(id: string): Promise<ResourceVersionResult | null>;
  createResourceVersion(input: CreateResourceVersionInput): Promise<ResourceVersionResult>;
  updateResourceVersion(
    versionId: string,
    updates: UpdateResourceVersionInput,
  ): Promise<ResourceVersionResult>;
}

export class DbResourceService implements ResourceService {
  constructor(private readonly dbInstance = defaultDb) {}

  async listResourceTypes(options: { includeInactive?: boolean } = {}): Promise<ResourceTypeResult[]> {
    const conditions = [];
    if (!options.includeInactive) {
      conditions.push(eq(resourceTypes.status, 'ACTIVE'));
    }

    const rows = await this.dbInstance
      .select()
      .from(resourceTypes)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(resourceTypes.sequenceOrder));

    return rows.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      slug: r.slug,
      pillar: r.pillar,
      description: r.description,
      status: r.status,
      sequenceOrder: r.sequenceOrder,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listResources(params: ListResourcesParams = {}): Promise<PaginatedResult<ResourceDetailResult>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const conditions = [];

    // Filter by country (ISO code, url_prefix, or UUID)
    if (params.country) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.country);
      if (isUuid) {
        conditions.push(eq(resources.countryId, params.country));
      } else {
        conditions.push(
          or(
            eq(countries.isoCode, params.country.toUpperCase()),
            eq(countries.urlPrefix, params.country.toLowerCase()),
          ),
        );
      }
    }

    // Filter by resource type (UUID, code, or slug)
    if (params.resourceType) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.resourceType);
      if (isUuid) {
        conditions.push(eq(resources.resourceTypeId, params.resourceType));
      } else {
        conditions.push(
          or(
            eq(resourceTypes.code, params.resourceType.toUpperCase()),
            eq(resourceTypes.slug, params.resourceType.toLowerCase()),
          ),
        );
      }
    }

    // Status filter - by default, only PUBLISHED resources are visible unless explicitly queried
    if (params.status) {
      conditions.push(eq(resources.status, params.status));
    } else {
      conditions.push(eq(resources.status, 'PUBLISHED'));
    }

    if (params.qualityLabel) {
      conditions.push(eq(resources.qualityLabel, params.qualityLabel));
    }

    if (params.gradeId) {
      conditions.push(eq(resources.gradeId, params.gradeId));
    }

    if (params.subjectId) {
      conditions.push(eq(resources.subjectId, params.subjectId));
    }

    if (params.schoolId) {
      conditions.push(eq(resources.schoolId, params.schoolId));
    }

    if (params.academicYear !== undefined) {
      conditions.push(eq(resources.academicYear, params.academicYear));
    }

    if (params.term !== undefined) {
      conditions.push(eq(resources.term, params.term));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Total Count Query
    const [{ total }] = await this.dbInstance
      .select({ total: count() })
      .from(resources)
      .innerJoin(countries, eq(resources.countryId, countries.id))
      .innerJoin(resourceTypes, eq(resources.resourceTypeId, resourceTypes.id))
      .leftJoin(schools, eq(resources.schoolId, schools.id))
      .where(whereClause);

    // Rows Query
    const rows = await this.dbInstance
      .select({
        resource: resources,
        country: countries,
        resourceType: resourceTypes,
        school: schools,
      })
      .from(resources)
      .innerJoin(countries, eq(resources.countryId, countries.id))
      .innerJoin(resourceTypes, eq(resources.resourceTypeId, resourceTypes.id))
      .leftJoin(schools, eq(resources.schoolId, schools.id))
      .where(whereClause)
      .orderBy(desc(resources.createdAt))
      .limit(pageSize)
      .offset(offset);

    const totalNum = Number(total);
    const data: ResourceDetailResult[] = rows.map(({ resource, country, resourceType, school }) => ({
      id: resource.id,
      country: {
        id: country.id,
        name: country.name,
        isoCode: country.isoCode,
      },
      resourceType: {
        id: resourceType.id,
        code: resourceType.code,
        name: resourceType.name,
        slug: resourceType.slug,
        pillar: resourceType.pillar,
      },
      school: school
        ? {
            id: school.id,
            name: school.name,
            code: school.code,
          }
        : null,
      curriculum: {
        curriculumId: resource.curriculumId,
        curriculumVersionId: resource.curriculumVersionId,
        educationLevelId: resource.educationLevelId,
        gradeId: resource.gradeId,
        pathwayId: resource.pathwayId,
        subjectId: resource.subjectId,
        topicId: resource.topicId,
      },
      title: resource.title,
      slug: resource.slug,
      description: resource.description,
      status: resource.status,
      qualityLabel: resource.qualityLabel,
      sourceName: resource.sourceName,
      sourceReference: resource.sourceReference,
      academicYear: resource.academicYear,
      term: resource.term,
      createdAt: resource.createdAt.toISOString(),
      updatedAt: resource.updatedAt.toISOString(),
    }));

    return {
      data,
      meta: {
        page,
        pageSize,
        total: totalNum,
        hasMore: offset + rows.length < totalNum,
      },
    };
  }

  async getResourceById(id: string): Promise<ResourceDetailResult | null> {
    const rows = await this.dbInstance
      .select({
        resource: resources,
        country: countries,
        resourceType: resourceTypes,
        school: schools,
      })
      .from(resources)
      .innerJoin(countries, eq(resources.countryId, countries.id))
      .innerJoin(resourceTypes, eq(resources.resourceTypeId, resourceTypes.id))
      .leftJoin(schools, eq(resources.schoolId, schools.id))
      .where(eq(resources.id, id))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const { resource, country, resourceType, school } = rows[0];

    // Find latest published version (or latest version)
    const versions = await this.dbInstance
      .select()
      .from(resourceVersions)
      .where(eq(resourceVersions.resourceId, id))
      .orderBy(desc(resourceVersions.versionNumber))
      .limit(1);

    let latestVersion: ResourceVersionResult | null = null;
    if (versions.length > 0) {
      const v = versions[0];
      latestVersion = {
        id: v.id,
        resourceId: v.resourceId,
        versionNumber: v.versionNumber,
        versionLabel: v.versionLabel,
        title: v.title,
        description: v.description,
        changeSummary: v.changeSummary,
        status: v.status,
        qualityLabel: v.qualityLabel,
        publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
        createdAt: v.createdAt.toISOString(),
        updatedAt: v.updatedAt.toISOString(),
      };
    }

    return {
      id: resource.id,
      country: {
        id: country.id,
        name: country.name,
        isoCode: country.isoCode,
      },
      resourceType: {
        id: resourceType.id,
        code: resourceType.code,
        name: resourceType.name,
        slug: resourceType.slug,
        pillar: resourceType.pillar,
      },
      school: school
        ? {
            id: school.id,
            name: school.name,
            code: school.code,
          }
        : null,
      curriculum: {
        curriculumId: resource.curriculumId,
        curriculumVersionId: resource.curriculumVersionId,
        educationLevelId: resource.educationLevelId,
        gradeId: resource.gradeId,
        pathwayId: resource.pathwayId,
        subjectId: resource.subjectId,
        topicId: resource.topicId,
      },
      title: resource.title,
      slug: resource.slug,
      description: resource.description,
      status: resource.status,
      qualityLabel: resource.qualityLabel,
      sourceName: resource.sourceName,
      sourceReference: resource.sourceReference,
      academicYear: resource.academicYear,
      term: resource.term,
      createdAt: resource.createdAt.toISOString(),
      updatedAt: resource.updatedAt.toISOString(),
      latestVersion,
    };
  }

  async listResourceVersions(
    resourceId: string,
    options: { includeUnpublished?: boolean } = {},
  ): Promise<ResourceVersionResult[]> {
    const conditions = [eq(resourceVersions.resourceId, resourceId)];
    if (!options.includeUnpublished) {
      conditions.push(eq(resourceVersions.status, 'PUBLISHED'));
    }

    const rows = await this.dbInstance
      .select()
      .from(resourceVersions)
      .where(and(...conditions))
      .orderBy(asc(resourceVersions.versionNumber));

    return rows.map((v) => ({
      id: v.id,
      resourceId: v.resourceId,
      versionNumber: v.versionNumber,
      versionLabel: v.versionLabel,
      title: v.title,
      description: v.description,
      changeSummary: v.changeSummary,
      status: v.status,
      qualityLabel: v.qualityLabel,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    }));
  }

  async getResourceVersionById(id: string): Promise<ResourceVersionResult | null> {
    const rows = await this.dbInstance
      .select()
      .from(resourceVersions)
      .where(eq(resourceVersions.id, id))
      .limit(1);

    if (rows.length === 0) {
      return null;
    }

    const v = rows[0];
    return {
      id: v.id,
      resourceId: v.resourceId,
      versionNumber: v.versionNumber,
      versionLabel: v.versionLabel,
      title: v.title,
      description: v.description,
      changeSummary: v.changeSummary,
      status: v.status,
      qualityLabel: v.qualityLabel,
      publishedAt: v.publishedAt ? v.publishedAt.toISOString() : null,
      createdAt: v.createdAt.toISOString(),
      updatedAt: v.updatedAt.toISOString(),
    };
  }

  /**
   * Resource Version Policy:
   * 1. version_number > 0: Must be a strictly positive integer.
   * 2. unique per resource: Composite uniqueness (resource_id, version_number) prevents duplicate versions.
   * 3. correction creates a higher/new version: When corrections or revisions are needed for a published
   *    resource, callers create a new version with a higher version number (e.g. version 2, 3, etc.).
   * 4. non-gapless / flexible numbering: The system does not claim or enforce gapless sequential numbering.
   *    Version numbers may have gaps if intermediate versions/drafts are discarded or major increments occur.
   */
  async createResourceVersion(input: CreateResourceVersionInput): Promise<ResourceVersionResult> {
    let versionNum = input.versionNumber;

    if (versionNum !== undefined && versionNum <= 0) {
      throw new Error('Version number must be greater than 0');
    }

    if (versionNum === undefined) {
      // Find highest existing version number for this resource
      const highestVersion = await this.dbInstance
        .select({ versionNumber: resourceVersions.versionNumber })
        .from(resourceVersions)
        .where(eq(resourceVersions.resourceId, input.resourceId))
        .orderBy(desc(resourceVersions.versionNumber))
        .limit(1);

      versionNum = highestVersion.length > 0 ? highestVersion[0].versionNumber + 1 : 1;
    }

    const versionLabel = input.versionLabel || `v${versionNum}.0`;
    const status = input.status || 'DRAFT';
    const qualityLabel = input.qualityLabel || 'STANDARD';
    const publishedAt =
      status === 'PUBLISHED' ? (input.publishedAt ? new Date(input.publishedAt) : new Date()) : null;

    const [created] = await this.dbInstance
      .insert(resourceVersions)
      .values({
        resourceId: input.resourceId,
        versionNumber: versionNum,
        versionLabel,
        title: input.title,
        description: input.description ?? null,
        changeSummary: input.changeSummary ?? null,
        status,
        qualityLabel,
        publishedAt,
      })
      .returning();

    return {
      id: created.id,
      resourceId: created.resourceId,
      versionNumber: created.versionNumber,
      versionLabel: created.versionLabel,
      title: created.title,
      description: created.description,
      changeSummary: created.changeSummary,
      status: created.status,
      qualityLabel: created.qualityLabel,
      publishedAt: created.publishedAt ? created.publishedAt.toISOString() : null,
      createdAt: created.createdAt.toISOString(),
      updatedAt: created.updatedAt.toISOString(),
    };
  }

  /**
   * Published Resource-Version Immutability:
   * A PUBLISHED resource version CANNOT be modified through the application service.
   * Any attempt to update an already published resource version throws an error.
   */
  async updateResourceVersion(
    versionId: string,
    updates: UpdateResourceVersionInput,
  ): Promise<ResourceVersionResult> {
    const existingRows = await this.dbInstance
      .select()
      .from(resourceVersions)
      .where(eq(resourceVersions.id, versionId))
      .limit(1);

    if (existingRows.length === 0) {
      throw new Error(`Resource version with id ${versionId} not found`);
    }

    const existing = existingRows[0];

    // Immutability Check: PUBLISHED versions cannot be modified through the application service
    if (existing.status === 'PUBLISHED') {
      throw new Error(
        'Published resource versions are immutable and cannot be modified. Corrections must be created as a new version with a higher version number.',
      );
    }

    const nextStatus = updates.status ?? existing.status;
    let publishedAt = existing.publishedAt;
    if (nextStatus === 'PUBLISHED' && !publishedAt) {
      publishedAt = new Date();
    }

    const [updated] = await this.dbInstance
      .update(resourceVersions)
      .set({
        title: updates.title ?? existing.title,
        versionLabel: updates.versionLabel ?? existing.versionLabel,
        description: updates.description !== undefined ? updates.description : existing.description,
        changeSummary: updates.changeSummary !== undefined ? updates.changeSummary : existing.changeSummary,
        status: nextStatus,
        qualityLabel: updates.qualityLabel ?? existing.qualityLabel,
        publishedAt,
        updatedAt: new Date(),
      })
      .where(eq(resourceVersions.id, versionId))
      .returning();

    return {
      id: updated.id,
      resourceId: updated.resourceId,
      versionNumber: updated.versionNumber,
      versionLabel: updated.versionLabel,
      title: updated.title,
      description: updated.description,
      changeSummary: updated.changeSummary,
      status: updated.status,
      qualityLabel: updated.qualityLabel,
      publishedAt: updated.publishedAt ? updated.publishedAt.toISOString() : null,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    };
  }
}

export const defaultResourceService = new DbResourceService();
