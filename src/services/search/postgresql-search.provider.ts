import { eq, and, or, count, desc, asc, sql, inArray } from 'drizzle-orm';
import { db as defaultDb } from '../../db/index.js';
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
} from '../../db/schemas.js';
import type { PaginatedResult } from '../catalogue.service.js';
import type {
  SearchProvider,
  SearchQuery,
  SearchResultItem,
} from './search-provider.interface.js';

type Database = typeof defaultDb;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class PostgreSQLSearchProvider implements SearchProvider {
  constructor(private readonly db: Database = defaultDb) {}

  async searchResources(
    query: SearchQuery,
  ): Promise<PaginatedResult<SearchResultItem>> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;
    const trimmedQ = query.q.trim();

    // The FTS tsquery using PostgreSQL websearch_to_tsquery for safe input parsing
    const searchTsQuery = sql`websearch_to_tsquery('english', ${trimmedQ})`;

    // Authoritative searchable document tsvector with weighted metadata
    const documentTsvector = sql`(
      setweight(to_tsvector('english', coalesce(${resources.title}, '')), 'A') ||
      setweight(to_tsvector('english', coalesce(${resources.description}, '')), 'B') ||
      setweight(to_tsvector('english', coalesce(${subjects.name}, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(${topics.name}, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(${grades.name}, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(${curricula.name}, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(${schools.name}, '')), 'C') ||
      setweight(to_tsvector('english', coalesce(${resourceTypes.name}, '')), 'C')
    )`;

    // Public visibility invariants: Resource PUBLISHED, Version PUBLISHED, FTS match
    const conditions = [
      eq(resources.status, 'PUBLISHED'),
      eq(resourceVersions.status, 'PUBLISHED'),
      sql`${documentTsvector} @@ ${searchTsQuery}`,
    ];

    // Filter by Country (urlPrefix, isoCode, or UUID)
    if (query.country) {
      const countryInput = query.country.trim();
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

    // Filter by Resource Type (slug, code, or UUID)
    if (query.resourceType) {
      const typeInput = query.resourceType.trim();
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
    if (query.curriculum) {
      const curriculumInput = query.curriculum.trim();
      if (UUID_REGEX.test(curriculumInput)) {
        conditions.push(eq(curricula.id, curriculumInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${curricula.code})`, curriculumInput.toLowerCase()),
        );
      }
    }

    // Filter by Curriculum Version (slug, versionCode, or UUID)
    if (query.curriculumVersion) {
      const cvInput = query.curriculumVersion.trim();
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
    if (query.educationLevel) {
      const elInput = query.educationLevel.trim();
      if (UUID_REGEX.test(elInput)) {
        conditions.push(eq(educationLevels.id, elInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${educationLevels.code})`, elInput.toLowerCase()),
        );
      }
    }

    // Filter by Grade (code or UUID)
    if (query.grade) {
      const gradeInput = query.grade.trim();
      if (UUID_REGEX.test(gradeInput)) {
        conditions.push(eq(grades.id, gradeInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${grades.code})`, gradeInput.toLowerCase()),
        );
      }
    }

    // Filter by Pathway (code or UUID)
    if (query.pathway) {
      const pathwayInput = query.pathway.trim();
      if (UUID_REGEX.test(pathwayInput)) {
        conditions.push(eq(pathways.id, pathwayInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${pathways.code})`, pathwayInput.toLowerCase()),
        );
      }
    }

    // Filter by Subject (code or UUID)
    if (query.subject) {
      const subjectInput = query.subject.trim();
      if (UUID_REGEX.test(subjectInput)) {
        conditions.push(eq(subjects.id, subjectInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${subjects.code})`, subjectInput.toLowerCase()),
        );
      }
    }

    // Filter by Topic (code or UUID)
    if (query.topic) {
      const topicInput = query.topic.trim();
      if (UUID_REGEX.test(topicInput)) {
        conditions.push(eq(topics.id, topicInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${topics.code})`, topicInput.toLowerCase()),
        );
      }
    }

    // Filter by School (code or UUID)
    if (query.school) {
      const schoolInput = query.school.trim();
      if (UUID_REGEX.test(schoolInput)) {
        conditions.push(eq(schools.id, schoolInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${schools.code})`, schoolInput.toLowerCase()),
        );
      }
    }

    // Filter by Academic Year
    if (query.academicYear !== undefined) {
      conditions.push(eq(resources.academicYear, query.academicYear));
    }

    // Filter by Term
    if (query.term !== undefined) {
      conditions.push(eq(resources.term, query.term));
    }

    // Filter by Quality Label
    if (query.quality) {
      conditions.push(eq(resources.qualityLabel, query.quality));
    }

    const whereClause = and(...conditions);

    // Total Count Query
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

    if (totalCount === 0) {
      return {
        data: [],
        meta: {
          page,
          pageSize,
          total: 0,
          hasMore: false,
        },
      };
    }

    // Cover density rank expression
    const rankSql = sql<number>`ts_rank_cd(${documentTsvector}, ${searchTsQuery})`;

    // Data rows with deterministic ordering: rank DESC, resources.id ASC
    const rows = await this.db
      .select({
        resourceId: resources.id,
        resourceTitle: resources.title,
        resourceSlug: resources.slug,
        resourceDescription: resources.description,
        resourceQualityLabel: resources.qualityLabel,
        academicYear: resources.academicYear,
        term: resources.term,
        searchScore: rankSql,
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
        publishedVersionId: resourceVersions.id,
        publishedVersionNumber: resourceVersions.versionNumber,
        publishedVersionLabel: resourceVersions.versionLabel,
        publishedVersionTitle: resourceVersions.title,
        publishedAt: resourceVersions.publishedAt,
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
      .orderBy(desc(rankSql), asc(resources.id))
      .limit(pageSize)
      .offset(offset);

    // Retrieve AVAILABLE files for the returned published resource versions
    const versionIds = rows.map((r) => r.publishedVersionId);
    let filesByVersionId = new Map<string, typeof resourceFiles.$inferSelect[]>();

    if (versionIds.length > 0) {
      const fileRows = await this.db
        .select()
        .from(resourceFiles)
        .where(
          and(
            inArray(resourceFiles.resourceVersionId, versionIds),
            eq(resourceFiles.status, 'AVAILABLE'),
          ),
        )
        .orderBy(asc(resourceFiles.sequenceOrder));

      for (const file of fileRows) {
        const list = filesByVersionId.get(file.resourceVersionId) || [];
        list.push(file);
        filesByVersionId.set(file.resourceVersionId, list);
      }
    }

    const items: SearchResultItem[] = rows.map((row) => {
      const versionFiles = filesByVersionId.get(row.publishedVersionId) || [];
      const primaryFileRow =
        versionFiles.find((f) => f.isPrimary) || versionFiles[0] || null;

      return {
        id: row.resourceId,
        title: row.resourceTitle,
        slug: row.resourceSlug,
        description: row.resourceDescription,
        qualityLabel: row.resourceQualityLabel,
        searchScore: row.searchScore ? Number(row.searchScore) : undefined,
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
          id: row.publishedVersionId,
          versionNumber: row.publishedVersionNumber,
          versionLabel: row.publishedVersionLabel,
          title: row.publishedVersionTitle,
          publishedAt: row.publishedAt
            ? new Date(row.publishedAt).toISOString()
            : '',
        },
        fileCount: versionFiles.length,
        primaryFile: primaryFileRow
          ? {
              id: primaryFileRow.id,
              originalFilename: primaryFileRow.originalFilename,
              fileExtension: primaryFileRow.fileExtension,
              fileType: primaryFileRow.fileType,
              mimeType: primaryFileRow.mimeType,
              fileSizeBytes: primaryFileRow.fileSizeBytes,
            }
          : null,
      };
    });

    return {
      data: items,
      meta: {
        page,
        pageSize,
        total: totalCount,
        hasMore: offset + rows.length < totalCount,
      },
    };
  }
}
