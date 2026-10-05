import { eq, and, inArray, count, desc, asc, sql } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import {
  users,
  resources,
  resourceVersions,
  resourceFiles,
  countries,
  schools,
  curricula,
  curriculumVersions,
  educationLevels,
  grades,
  pathways,
  subjects,
  topics,
  resourceTypes,
} from '../db/schemas.js';
import type { CatalogueResourceSummary, CatalogueFileMetadata } from './catalogue.service.js';

type Database = typeof defaultDb;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LibraryError extends Error {
  public statusCode: number;
  public code: string;

  constructor(message: string, statusCode = 400, code = 'LIBRARY_ERROR') {
    super(message);
    this.name = 'LibraryError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class ResourceVersionNotFoundError extends LibraryError {
  constructor(message = 'Resource version not found.') {
    super(message, 404, 'RESOURCE_VERSION_NOT_FOUND');
    this.name = 'ResourceVersionNotFoundError';
  }
}

export class ResourceVersionNotEligibleError extends LibraryError {
  constructor(
    message = 'Only published resource versions can be saved to user library.',
  ) {
    super(message, 400, 'RESOURCE_VERSION_NOT_ELIGIBLE');
    this.name = 'ResourceVersionNotEligibleError';
  }
}

export interface ListSavedResourcesParams {
  page?: number;
  pageSize?: number;
}

export interface ListSavedResourcesResponse {
  data: CatalogueResourceSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface SaveResourceVersionResponse {
  saved: boolean;
  resourceVersionId: string;
  item: CatalogueResourceSummary;
}

export interface CheckSavedResponse {
  isSaved: boolean;
  resourceVersionId: string;
}

export interface RemoveResourceVersionResponse {
  removed: boolean;
  resourceVersionId: string;
}

export interface LibraryService {
  saveResourceVersion(
    userId: string,
    resourceVersionId: string,
  ): Promise<SaveResourceVersionResponse>;
  removeResourceVersion(
    userId: string,
    resourceVersionId: string,
  ): Promise<RemoveResourceVersionResponse>;
  isResourceVersionSaved(
    userId: string,
    resourceVersionId: string,
  ): Promise<CheckSavedResponse>;
  listSavedResources(
    userId: string,
    params?: ListSavedResourcesParams,
  ): Promise<ListSavedResourcesResponse>;
}

export class DefaultLibraryService implements LibraryService {
  constructor(private db: Database = defaultDb) {}

  /**
   * Saves a published resource version to the authenticated user's library.
   * Enforces:
   * 1. Valid UUID format.
   * 2. Resource version must exist.
   * 3. Resource version must have status = 'PUBLISHED'.
   * 4. Parent resource must have status = 'PUBLISHED'.
   * 5. Atomic PostgreSQL array update with deduplication.
   */
  async saveResourceVersion(
    userId: string,
    resourceVersionId: string,
  ): Promise<SaveResourceVersionResponse> {
    if (!UUID_REGEX.test(resourceVersionId)) {
      throw new ResourceVersionNotFoundError('Invalid resource version identifier.');
    }

    // 1. Verify existence & eligibility
    const [versionRecord] = await this.db
      .select({
        versionId: resourceVersions.id,
        versionStatus: resourceVersions.status,
        resourceId: resources.id,
        resourceStatus: resources.status,
      })
      .from(resourceVersions)
      .innerJoin(resources, eq(resources.id, resourceVersions.resourceId))
      .where(eq(resourceVersions.id, resourceVersionId));

    if (!versionRecord) {
      throw new ResourceVersionNotFoundError('Resource version not found.');
    }

    if (
      versionRecord.versionStatus !== 'PUBLISHED' ||
      versionRecord.resourceStatus !== 'PUBLISHED'
    ) {
      throw new ResourceVersionNotEligibleError(
        'Only published resource versions can be saved to user library.',
      );
    }

    // 2. Atomic array append with duplicate prevention (PostgreSQL array function)
    await this.db.execute(sql`
      UPDATE "identity"."users"
      SET "saved_resource_version_ids" = array_append("saved_resource_version_ids", ${resourceVersionId}::uuid),
          "updated_at" = NOW()
      WHERE "id" = ${userId}::uuid
        AND NOT (${resourceVersionId}::uuid = ANY("saved_resource_version_ids"))
    `);

    // 3. Project and return the saved resource version metadata
    const item = await this.projectSingleResourceVersion(resourceVersionId);
    if (!item) {
      throw new ResourceVersionNotFoundError('Saved resource version could not be projected.');
    }

    return {
      saved: true,
      resourceVersionId,
      item,
    };
  }

  /**
   * Idempotently removes a saved resource version from the user's library.
   */
  async removeResourceVersion(
    userId: string,
    resourceVersionId: string,
  ): Promise<RemoveResourceVersionResponse> {
    if (!UUID_REGEX.test(resourceVersionId)) {
      // Idempotent: return true even if format is invalid or not in library
      return {
        removed: true,
        resourceVersionId,
      };
    }

    await this.db.execute(sql`
      UPDATE "identity"."users"
      SET "saved_resource_version_ids" = array_remove("saved_resource_version_ids", ${resourceVersionId}::uuid),
          "updated_at" = NOW()
      WHERE "id" = ${userId}::uuid
    `);

    return {
      removed: true,
      resourceVersionId,
    };
  }

  /**
   * Checks whether a resource version is currently saved in the user's library.
   */
  async isResourceVersionSaved(
    userId: string,
    resourceVersionId: string,
  ): Promise<CheckSavedResponse> {
    if (!UUID_REGEX.test(resourceVersionId)) {
      return {
        isSaved: false,
        resourceVersionId,
      };
    }

    const [user] = await this.db
      .select({
        savedIds: users.savedResourceVersionIds,
      })
      .from(users)
      .where(eq(users.id, userId));

    const isSaved = Array.isArray(user?.savedIds) && user.savedIds.includes(resourceVersionId);

    return {
      isSaved,
      resourceVersionId,
    };
  }

  /**
   * Lists the user's saved published resources using the public catalogue projection.
   * Ineligible, archived, or unpublished versions are filtered out.
   */
  async listSavedResources(
    userId: string,
    params: ListSavedResourcesParams = {},
  ): Promise<ListSavedResourcesResponse> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    // Fetch user's saved IDs array
    const [user] = await this.db
      .select({
        savedIds: users.savedResourceVersionIds,
      })
      .from(users)
      .where(eq(users.id, userId));

    const savedIds = user?.savedIds || [];
    if (savedIds.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          pageSize,
          total: 0,
          hasMore: false,
        },
      };
    }

    // Eligibility where-clause for saved published resources
    const whereClause = and(
      inArray(resourceVersions.id, savedIds),
      eq(resourceVersions.status, 'PUBLISHED'),
      eq(resources.status, 'PUBLISHED'),
    );

    // Count total eligible saved items
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(resources)
      .innerJoin(resourceVersions, eq(resourceVersions.resourceId, resources.id))
      .where(whereClause);

    const totalCount = Number(total);
    if (totalCount === 0) {
      return {
        data: [],
        pagination: {
          page,
          pageSize,
          total: 0,
          hasMore: false,
        },
      };
    }

    // Fetch paginated resource version rows
    const rows = await this.db
      .select({
        resourceId: resources.id,
        resourceTitle: resources.title,
        resourceSlug: resources.slug,
        resourceDescription: resources.description,
        resourceQualityLabel: resources.qualityLabel,
        academicYear: resources.academicYear,
        term: resources.term,
        // Resource Type
        typeId: resourceTypes.id,
        typeCode: resourceTypes.code,
        typeName: resourceTypes.name,
        typeSlug: resourceTypes.slug,
        typePillar: resourceTypes.pillar,
        // Country
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        // School
        schoolId: schools.id,
        schoolName: schools.name,
        schoolCode: schools.code,
        // Curriculum
        curriculumId: curricula.id,
        curriculumCode: curricula.code,
        curriculumName: curricula.name,
        // Curriculum Version
        curriculumVersionId: curriculumVersions.id,
        curriculumVersionName: curriculumVersions.versionName,
        curriculumVersionCode: curriculumVersions.versionCode,
        curriculumVersionSlug: curriculumVersions.slug,
        // Education Level
        educationLevelId: educationLevels.id,
        educationLevelCode: educationLevels.code,
        educationLevelName: educationLevels.name,
        // Grade
        gradeId: grades.id,
        gradeCode: grades.code,
        gradeName: grades.name,
        // Pathway
        pathwayId: pathways.id,
        pathwayCode: pathways.code,
        pathwayName: pathways.name,
        // Subject
        subjectId: subjects.id,
        subjectCode: subjects.code,
        subjectName: subjects.name,
        // Topic
        topicId: topics.id,
        topicCode: topics.code,
        topicName: topics.name,
        // Saved Version
        versionId: resourceVersions.id,
        versionNumber: resourceVersions.versionNumber,
        versionLabel: resourceVersions.versionLabel,
        versionTitle: resourceVersions.title,
        versionPublishedAt: resourceVersions.publishedAt,
      })
      .from(resources)
      .innerJoin(resourceVersions, eq(resourceVersions.resourceId, resources.id))
      .innerJoin(countries, eq(countries.id, resources.countryId))
      .innerJoin(resourceTypes, eq(resourceTypes.id, resources.resourceTypeId))
      .leftJoin(schools, eq(schools.id, resources.schoolId))
      .leftJoin(curricula, eq(curricula.id, resources.curriculumId))
      .leftJoin(
        curriculumVersions,
        eq(curriculumVersions.id, resources.curriculumVersionId),
      )
      .leftJoin(
        educationLevels,
        eq(educationLevels.id, resources.educationLevelId),
      )
      .leftJoin(grades, eq(grades.id, resources.gradeId))
      .leftJoin(pathways, eq(pathways.id, resources.pathwayId))
      .leftJoin(subjects, eq(subjects.id, resources.subjectId))
      .leftJoin(topics, eq(topics.id, resources.topicId))
      .where(whereClause)
      .orderBy(desc(resourceVersions.publishedAt), asc(resources.id))
      .limit(pageSize)
      .offset(offset);

    if (rows.length === 0) {
      return {
        data: [],
        pagination: {
          page,
          pageSize,
          total: totalCount,
          hasMore: false,
        },
      };
    }

    // Fetch AVAILABLE file summary for returned versions (zero R2 leak)
    const versionIds = rows.map((r) => r.versionId);
    const availableFiles = await this.db
      .select({
        id: resourceFiles.id,
        resourceVersionId: resourceFiles.resourceVersionId,
        originalFilename: resourceFiles.originalFilename,
        fileExtension: resourceFiles.fileExtension,
        fileType: resourceFiles.fileType,
        mimeType: resourceFiles.mimeType,
        fileSizeBytes: resourceFiles.fileSizeBytes,
        isPrimary: resourceFiles.isPrimary,
        sequenceOrder: resourceFiles.sequenceOrder,
      })
      .from(resourceFiles)
      .where(
        and(
          inArray(resourceFiles.resourceVersionId, versionIds),
          eq(resourceFiles.status, 'AVAILABLE'),
        ),
      )
      .orderBy(desc(resourceFiles.isPrimary), asc(resourceFiles.sequenceOrder));

    const filesByVersion = new Map<string, CatalogueFileMetadata[]>();
    for (const f of availableFiles) {
      const list = filesByVersion.get(f.resourceVersionId) || [];
      list.push({
        id: f.id,
        originalFilename: f.originalFilename,
        fileExtension: f.fileExtension,
        fileType: f.fileType,
        mimeType: f.mimeType,
        fileSizeBytes: f.fileSizeBytes,
        isPrimary: f.isPrimary,
        sequenceOrder: f.sequenceOrder,
      });
      filesByVersion.set(f.resourceVersionId, list);
    }

    const items: CatalogueResourceSummary[] = rows.map((r) => {
      const vFiles = filesByVersion.get(r.versionId) || [];
      const primary = vFiles.find((f) => f.isPrimary) || vFiles[0] || null;

      return {
        id: r.resourceId,
        title: r.resourceTitle,
        slug: r.resourceSlug,
        description: r.resourceDescription,
        qualityLabel: r.resourceQualityLabel,
        resourceType: {
          id: r.typeId,
          code: r.typeCode,
          name: r.typeName,
          slug: r.typeSlug,
          pillar: r.typePillar,
        },
        country: {
          id: r.countryId,
          name: r.countryName,
          isoCode: r.countryIsoCode,
          urlPrefix: r.countryUrlPrefix,
        },
        curriculum: r.curriculumId
          ? {
              id: r.curriculumId,
              code: r.curriculumCode!,
              name: r.curriculumName!,
            }
          : null,
        curriculumVersion: r.curriculumVersionId
          ? {
              id: r.curriculumVersionId,
              versionName: r.curriculumVersionName!,
              versionCode: r.curriculumVersionCode,
              slug: r.curriculumVersionSlug!,
            }
          : null,
        educationLevel: r.educationLevelId
          ? {
              id: r.educationLevelId,
              code: r.educationLevelCode!,
              name: r.educationLevelName!,
            }
          : null,
        grade: r.gradeId
          ? {
              id: r.gradeId,
              code: r.gradeCode!,
              name: r.gradeName!,
            }
          : null,
        pathway: r.pathwayId
          ? {
              id: r.pathwayId,
              code: r.pathwayCode!,
              name: r.pathwayName!,
            }
          : null,
        subject: r.subjectId
          ? {
              id: r.subjectId,
              code: r.subjectCode!,
              name: r.subjectName!,
            }
          : null,
        topic: r.topicId
          ? {
              id: r.topicId,
              code: r.topicCode!,
              name: r.topicName!,
            }
          : null,
        school: r.schoolId
          ? {
              id: r.schoolId,
              name: r.schoolName!,
              code: r.schoolCode,
            }
          : null,
        academicYear: r.academicYear,
        term: r.term,
        publishedVersion: {
          id: r.versionId,
          versionNumber: r.versionNumber,
          versionLabel: r.versionLabel,
          title: r.versionTitle,
          publishedAt: r.versionPublishedAt?.toISOString() || '',
        },
        fileCount: vFiles.length,
        primaryFile: primary
          ? {
              id: primary.id,
              originalFilename: primary.originalFilename,
              fileExtension: primary.fileExtension,
              fileType: primary.fileType,
              mimeType: primary.mimeType,
              fileSizeBytes: primary.fileSizeBytes,
            }
          : null,
      };
    });

    return {
      data: items,
      pagination: {
        page,
        pageSize,
        total: totalCount,
        hasMore: offset + items.length < totalCount,
      },
    };
  }

  /**
   * Projects a single resource version by ID according to public catalogue representation.
   */
  private async projectSingleResourceVersion(
    resourceVersionId: string,
  ): Promise<CatalogueResourceSummary | null> {
    const [row] = await this.db
      .select({
        resourceId: resources.id,
        resourceTitle: resources.title,
        resourceSlug: resources.slug,
        resourceDescription: resources.description,
        resourceQualityLabel: resources.qualityLabel,
        academicYear: resources.academicYear,
        term: resources.term,
        // Resource Type
        typeId: resourceTypes.id,
        typeCode: resourceTypes.code,
        typeName: resourceTypes.name,
        typeSlug: resourceTypes.slug,
        typePillar: resourceTypes.pillar,
        // Country
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        // School
        schoolId: schools.id,
        schoolName: schools.name,
        schoolCode: schools.code,
        // Curriculum
        curriculumId: curricula.id,
        curriculumCode: curricula.code,
        curriculumName: curricula.name,
        // Curriculum Version
        curriculumVersionId: curriculumVersions.id,
        curriculumVersionName: curriculumVersions.versionName,
        curriculumVersionCode: curriculumVersions.versionCode,
        curriculumVersionSlug: curriculumVersions.slug,
        // Education Level
        educationLevelId: educationLevels.id,
        educationLevelCode: educationLevels.code,
        educationLevelName: educationLevels.name,
        // Grade
        gradeId: grades.id,
        gradeCode: grades.code,
        gradeName: grades.name,
        // Pathway
        pathwayId: pathways.id,
        pathwayCode: pathways.code,
        pathwayName: pathways.name,
        // Subject
        subjectId: subjects.id,
        subjectCode: subjects.code,
        subjectName: subjects.name,
        // Topic
        topicId: topics.id,
        topicCode: topics.code,
        topicName: topics.name,
        // Published Version
        versionId: resourceVersions.id,
        versionNumber: resourceVersions.versionNumber,
        versionLabel: resourceVersions.versionLabel,
        versionTitle: resourceVersions.title,
        versionPublishedAt: resourceVersions.publishedAt,
      })
      .from(resources)
      .innerJoin(resourceVersions, eq(resourceVersions.resourceId, resources.id))
      .innerJoin(countries, eq(countries.id, resources.countryId))
      .innerJoin(resourceTypes, eq(resourceTypes.id, resources.resourceTypeId))
      .leftJoin(schools, eq(schools.id, resources.schoolId))
      .leftJoin(curricula, eq(curricula.id, resources.curriculumId))
      .leftJoin(
        curriculumVersions,
        eq(curriculumVersions.id, resources.curriculumVersionId),
      )
      .leftJoin(
        educationLevels,
        eq(educationLevels.id, resources.educationLevelId),
      )
      .leftJoin(grades, eq(grades.id, resources.gradeId))
      .leftJoin(pathways, eq(pathways.id, resources.pathwayId))
      .leftJoin(subjects, eq(subjects.id, resources.subjectId))
      .leftJoin(topics, eq(topics.id, resources.topicId))
      .where(eq(resourceVersions.id, resourceVersionId));

    if (!row) return null;

    const availableFiles = await this.db
      .select({
        id: resourceFiles.id,
        resourceVersionId: resourceFiles.resourceVersionId,
        originalFilename: resourceFiles.originalFilename,
        fileExtension: resourceFiles.fileExtension,
        fileType: resourceFiles.fileType,
        mimeType: resourceFiles.mimeType,
        fileSizeBytes: resourceFiles.fileSizeBytes,
        isPrimary: resourceFiles.isPrimary,
        sequenceOrder: resourceFiles.sequenceOrder,
      })
      .from(resourceFiles)
      .where(
        and(
          eq(resourceFiles.resourceVersionId, resourceVersionId),
          eq(resourceFiles.status, 'AVAILABLE'),
        ),
      )
      .orderBy(desc(resourceFiles.isPrimary), asc(resourceFiles.sequenceOrder));

    const primary = availableFiles.find((f) => f.isPrimary) || availableFiles[0] || null;

    return {
      id: row.resourceId,
      title: row.resourceTitle,
      slug: row.resourceSlug,
      description: row.resourceDescription,
      qualityLabel: row.resourceQualityLabel,
      resourceType: {
        id: row.typeId,
        code: row.typeCode,
        name: row.typeName,
        slug: row.typeSlug,
        pillar: row.typePillar,
      },
      country: {
        id: row.countryId,
        name: row.countryName,
        isoCode: row.countryIsoCode,
        urlPrefix: row.countryUrlPrefix,
      },
      curriculum: row.curriculumId
        ? {
            id: row.curriculumId,
            code: row.curriculumCode!,
            name: row.curriculumName!,
          }
        : null,
      curriculumVersion: row.curriculumVersionId
        ? {
            id: row.curriculumVersionId,
            versionName: row.curriculumVersionName!,
            versionCode: row.curriculumVersionCode,
            slug: row.curriculumVersionSlug!,
          }
        : null,
      educationLevel: row.educationLevelId
        ? {
            id: row.educationLevelId,
            code: row.educationLevelCode!,
            name: row.educationLevelName!,
          }
        : null,
      grade: row.gradeId
        ? {
            id: row.gradeId,
            code: row.gradeCode!,
            name: row.gradeName!,
          }
        : null,
      pathway: row.pathwayId
        ? {
            id: row.pathwayId,
            code: row.pathwayCode!,
            name: row.pathwayName!,
          }
        : null,
      subject: row.subjectId
        ? {
            id: row.subjectId,
            code: row.subjectCode!,
            name: row.subjectName!,
          }
        : null,
      topic: row.topicId
        ? {
            id: row.topicId,
            code: row.topicCode!,
            name: row.topicName!,
          }
        : null,
      school: row.schoolId
        ? {
            id: row.schoolId,
            name: row.schoolName!,
            code: row.schoolCode,
          }
        : null,
      academicYear: row.academicYear,
      term: row.term,
      publishedVersion: {
        id: row.versionId,
        versionNumber: row.versionNumber,
        versionLabel: row.versionLabel,
        title: row.versionTitle,
        publishedAt: row.versionPublishedAt?.toISOString() || '',
      },
      fileCount: availableFiles.length,
      primaryFile: primary
        ? {
            id: primary.id,
            originalFilename: primary.originalFilename,
            fileExtension: primary.fileExtension,
            fileType: primary.fileType,
            mimeType: primary.mimeType,
            fileSizeBytes: primary.fileSizeBytes,
          }
        : null,
    };
  }
}

export const defaultLibraryService = new DefaultLibraryService();
