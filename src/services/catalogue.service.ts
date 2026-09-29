import { eq, and, or, count, desc, asc, sql } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import {
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
  resources,
  resourceVersions,
  resourceFiles,
} from '../db/schemas.js';

type Database = typeof defaultDb;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CatalogueFileMetadata {
  id: string;
  originalFilename: string;
  fileExtension: string;
  fileType: string;
  mimeType: string;
  fileSizeBytes: number;
  isPrimary: boolean;
  sequenceOrder: number;
}

export interface CatalogueResourceSummary {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  qualityLabel: string;
  resourceType: {
    id: string;
    code: string;
    name: string;
    slug: string;
    pillar: string;
  };
  country: {
    id: string;
    name: string;
    isoCode: string;
    urlPrefix: string;
  };
  curriculum: {
    id: string;
    code: string;
    name: string;
  } | null;
  curriculumVersion: {
    id: string;
    versionName: string;
    versionCode: string | null;
    slug: string;
  } | null;
  educationLevel: {
    id: string;
    code: string;
    name: string;
  } | null;
  grade: {
    id: string;
    code: string;
    name: string;
  } | null;
  pathway: {
    id: string;
    code: string;
    name: string;
  } | null;
  subject: {
    id: string;
    code: string;
    name: string;
  } | null;
  topic: {
    id: string;
    code: string;
    name: string;
  } | null;
  school: {
    id: string;
    name: string;
    code: string | null;
  } | null;
  academicYear: number | null;
  term: number | null;
  publishedVersion: {
    id: string;
    versionNumber: number;
    versionLabel: string;
    title: string;
    publishedAt: string;
  };
  fileCount: number;
  primaryFile: {
    id: string;
    originalFilename: string;
    fileExtension: string;
    fileType: string;
    mimeType: string;
    fileSizeBytes: number;
  } | null;
}

export interface CatalogueResourceDetail extends CatalogueResourceSummary {
  sourceName: string | null;
  sourceReference: string | null;
  files: CatalogueFileMetadata[];
}

export interface ListCatalogueParams {
  country?: string;
  resourceType?: string;
  curriculum?: string;
  curriculumVersion?: string;
  educationLevel?: string;
  grade?: string;
  pathway?: string;
  subject?: string;
  topic?: string;
  school?: string;
  academicYear?: number;
  term?: number;
  quality?: 'STANDARD' | 'VERIFIED' | 'PREMIUM';
  sort?: 'newest' | 'oldest' | 'title';
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

export interface CatalogueService {
  listCatalogueResources(
    params?: ListCatalogueParams,
  ): Promise<PaginatedResult<CatalogueResourceSummary>>;
  getCatalogueResourceById(id: string): Promise<CatalogueResourceDetail | null>;
}

export class DbCatalogueService implements CatalogueService {
  constructor(private readonly db: Database = defaultDb) {}

  async listCatalogueResources(
    params: ListCatalogueParams = {},
  ): Promise<PaginatedResult<CatalogueResourceSummary>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    // Base conditions: Resource MUST be PUBLISHED, Version MUST be PUBLISHED
    const conditions = [
      eq(resources.status, 'PUBLISHED'),
      eq(resourceVersions.status, 'PUBLISHED'),
    ];

    // Filter by Country (supports urlPrefix, isoCode, or UUID)
    if (params.country) {
      const countryInput = params.country.trim();
      if (UUID_REGEX.test(countryInput)) {
        conditions.push(eq(countries.id, countryInput));
      } else {
        conditions.push(
          or(
            eq(sql`LOWER(${countries.urlPrefix})`, countryInput.toLowerCase()),
            eq(sql`UPPER(${countries.isoCode})`, countryInput.toUpperCase()),
          )!,
        );
      }
    }

    // Filter by Resource Type (supports slug, code, or UUID)
    if (params.resourceType) {
      const typeInput = params.resourceType.trim();
      if (UUID_REGEX.test(typeInput)) {
        conditions.push(eq(resourceTypes.id, typeInput));
      } else {
        conditions.push(
          or(
            eq(sql`LOWER(${resourceTypes.slug})`, typeInput.toLowerCase()),
            eq(sql`UPPER(${resourceTypes.code})`, typeInput.toUpperCase()),
          )!,
        );
      }
    }

    // Filter by Curriculum (code or UUID)
    if (params.curriculum) {
      const curriculumInput = params.curriculum.trim();
      if (UUID_REGEX.test(curriculumInput)) {
        conditions.push(eq(curricula.id, curriculumInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${curricula.code})`, curriculumInput.toLowerCase()),
        );
      }
    }

    // Filter by Curriculum Version (slug, versionCode or UUID)
    if (params.curriculumVersion) {
      const cvInput = params.curriculumVersion.trim();
      if (UUID_REGEX.test(cvInput)) {
        conditions.push(eq(curriculumVersions.id, cvInput));
      } else {
        conditions.push(
          or(
            eq(sql`LOWER(${curriculumVersions.slug})`, cvInput.toLowerCase()),
            eq(sql`LOWER(${curriculumVersions.versionCode})`, cvInput.toLowerCase()),
          )!,
        );
      }
    }

    // Filter by Education Level (code or UUID)
    if (params.educationLevel) {
      const elInput = params.educationLevel.trim();
      if (UUID_REGEX.test(elInput)) {
        conditions.push(eq(educationLevels.id, elInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${educationLevels.code})`, elInput.toLowerCase()),
        );
      }
    }

    // Filter by Grade (code or UUID)
    if (params.grade) {
      const gradeInput = params.grade.trim();
      if (UUID_REGEX.test(gradeInput)) {
        conditions.push(eq(grades.id, gradeInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${grades.code})`, gradeInput.toLowerCase()),
        );
      }
    }

    // Filter by Pathway (code or UUID)
    if (params.pathway) {
      const pathwayInput = params.pathway.trim();
      if (UUID_REGEX.test(pathwayInput)) {
        conditions.push(eq(pathways.id, pathwayInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${pathways.code})`, pathwayInput.toLowerCase()),
        );
      }
    }

    // Filter by Subject (code or UUID)
    if (params.subject) {
      const subjectInput = params.subject.trim();
      if (UUID_REGEX.test(subjectInput)) {
        conditions.push(eq(subjects.id, subjectInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${subjects.code})`, subjectInput.toLowerCase()),
        );
      }
    }

    // Filter by Topic (code or UUID)
    if (params.topic) {
      const topicInput = params.topic.trim();
      if (UUID_REGEX.test(topicInput)) {
        conditions.push(eq(topics.id, topicInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${topics.code})`, topicInput.toLowerCase()),
        );
      }
    }

    // Filter by School (code or UUID)
    if (params.school) {
      const schoolInput = params.school.trim();
      if (UUID_REGEX.test(schoolInput)) {
        conditions.push(eq(schools.id, schoolInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${schools.code})`, schoolInput.toLowerCase()),
        );
      }
    }

    // Filter by Academic Year
    if (params.academicYear !== undefined) {
      conditions.push(eq(resources.academicYear, params.academicYear));
    }

    // Filter by Term
    if (params.term !== undefined) {
      conditions.push(eq(resources.term, params.term));
    }

    // Filter by Quality Label
    if (params.quality) {
      conditions.push(eq(resources.qualityLabel, params.quality));
    }

    const whereClause = and(...conditions);

    // Count Total Query
    const [{ total }] = await this.db
      .select({ total: count() })
      .from(resources)
      .innerJoin(
        resourceVersions,
        and(
          eq(resourceVersions.resourceId, resources.id),
          eq(resourceVersions.status, 'PUBLISHED'),
        ),
      )
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
      .where(whereClause);

    const totalCount = Number(total);

    // Sorting selection
    let orderClauses = [desc(resourceVersions.publishedAt), asc(resources.id)];
    if (params.sort === 'oldest') {
      orderClauses = [asc(resourceVersions.publishedAt), asc(resources.id)];
    } else if (params.sort === 'title') {
      orderClauses = [asc(resources.title), asc(resources.id)];
    }

    // Data Rows Query
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
        // Published Version
        versionId: resourceVersions.id,
        versionNumber: resourceVersions.versionNumber,
        versionLabel: resourceVersions.versionLabel,
        versionTitle: resourceVersions.title,
        versionPublishedAt: resourceVersions.publishedAt,
      })
      .from(resources)
      .innerJoin(
        resourceVersions,
        and(
          eq(resourceVersions.resourceId, resources.id),
          eq(resourceVersions.status, 'PUBLISHED'),
        ),
      )
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
      .orderBy(...orderClauses)
      .limit(pageSize)
      .offset(offset);

    // If no rows, return early
    if (rows.length === 0) {
      return {
        data: [],
        meta: {
          page,
          pageSize,
          total: totalCount,
          hasMore: false,
        },
      };
    }

    // Fetch AVAILABLE file summary for the returned published version IDs
    const versionIds = rows.map((r: { versionId: string }) => r.versionId);
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
          sql`${resourceFiles.resourceVersionId} IN (${sql.join(
            versionIds.map((id: string) => sql`${id}`),
            sql`, `,
          )})`,
          eq(resourceFiles.status, 'AVAILABLE'),
        ),
      )
      .orderBy(desc(resourceFiles.isPrimary), asc(resourceFiles.sequenceOrder));

    // Map files by version ID
    const filesByVersionId = new Map<string, typeof availableFiles>();
    for (const file of availableFiles) {
      const list = filesByVersionId.get(file.resourceVersionId) || [];
      list.push(file);
      filesByVersionId.set(file.resourceVersionId, list);
    }

    const data: CatalogueResourceSummary[] = rows.map((row) => {
      const versionFiles = filesByVersionId.get(row.versionId) || [];
      const primary =
        versionFiles.find((f) => f.isPrimary) || versionFiles[0] || null;

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
          publishedAt: row.versionPublishedAt
            ? new Date(row.versionPublishedAt).toISOString()
            : '',
        },
        fileCount: versionFiles.length,
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
      data,
      meta: {
        page,
        pageSize,
        total: totalCount,
        hasMore: page * pageSize < totalCount,
      },
    };
  }

  async getCatalogueResourceById(
    id: string,
  ): Promise<CatalogueResourceDetail | null> {
    const [row] = await this.db
      .select({
        resourceId: resources.id,
        resourceTitle: resources.title,
        resourceSlug: resources.slug,
        resourceDescription: resources.description,
        resourceQualityLabel: resources.qualityLabel,
        sourceName: resources.sourceName,
        sourceReference: resources.sourceReference,
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
      .innerJoin(
        resourceVersions,
        and(
          eq(resourceVersions.resourceId, resources.id),
          eq(resourceVersions.status, 'PUBLISHED'),
        ),
      )
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
      .where(
        and(
          eq(resources.id, id),
          eq(resources.status, 'PUBLISHED'),
          eq(resourceVersions.status, 'PUBLISHED'),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    // Fetch AVAILABLE files attached to the published version
    const files = await this.db
      .select({
        id: resourceFiles.id,
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
          eq(resourceFiles.resourceVersionId, row.versionId),
          eq(resourceFiles.status, 'AVAILABLE'),
        ),
      )
      .orderBy(desc(resourceFiles.isPrimary), asc(resourceFiles.sequenceOrder));

    const primary = files.find((f: { isPrimary: boolean }) => f.isPrimary) || files[0] || null;

    return {
      id: row.resourceId,
      title: row.resourceTitle,
      slug: row.resourceSlug,
      description: row.resourceDescription,
      qualityLabel: row.resourceQualityLabel,
      sourceName: row.sourceName,
      sourceReference: row.sourceReference,
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
        publishedAt: row.versionPublishedAt
          ? new Date(row.versionPublishedAt).toISOString()
          : '',
      },
      fileCount: files.length,
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
      files,
    };
  }
}

export const defaultCatalogueService = new DbCatalogueService();
