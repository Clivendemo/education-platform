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
  resourceVerifications,
} from '../../db/schemas.js';
import type { PaginatedResult } from '../catalogue.service.js';
import { escapeRegexMetacharacters } from '../../utils/search-sanitizer.js';
import type {
  SearchProvider,
  SearchQuery,
  SearchResultItem,
  AutocompleteQuery,
  AutocompleteSuggestion,
  RelatedDiscoveryQuery,
  RelatedDiscoveryResult,
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

    // Filter by Quality Label (Prompt 24 / Technical Correction A)
    if (query.quality === 'VERIFIED') {
      const verifiedFilter = or(
        eq(resources.qualityLabel, 'VERIFIED'),
        sql`EXISTS (
          SELECT 1 FROM "governance"."resource_verifications" rv
          WHERE rv."resource_version_id" = ${resourceVersions.id}
          AND rv."verification_status" = 'VERIFIED'
        )`,
      );
      if (verifiedFilter) {
        conditions.push(verifiedFilter);
      }
    } else if (query.quality) {
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

    // Batch fetch active verifications for search result items (Technical Correction A)
    const activeVerifications = versionIds.length > 0
      ? await this.db
          .select({
            resourceVersionId: resourceVerifications.resourceVersionId,
            verifiedAt: resourceVerifications.verifiedAt,
          })
          .from(resourceVerifications)
          .where(
            and(
              inArray(resourceVerifications.resourceVersionId, versionIds),
              eq(resourceVerifications.verificationStatus, 'VERIFIED'),
            ),
          )
      : [];

    const verificationByVersionId = new Map(
      activeVerifications.map((v) => [v.resourceVersionId, v]),
    );

    const items: SearchResultItem[] = rows.map((row) => {
      const versionFiles = filesByVersionId.get(row.publishedVersionId) || [];
      const primaryFileRow =
        versionFiles.find((f) => f.isPrimary) || versionFiles[0] || null;

      const verification = verificationByVersionId.get(row.publishedVersionId);
      const isVerified = !!verification || row.resourceQualityLabel === 'VERIFIED';
      const isPremium = row.resourceQualityLabel === 'PREMIUM';

      return {
        id: row.resourceId,
        title: row.resourceTitle,
        slug: row.resourceSlug,
        description: row.resourceDescription,
        qualityLabel: isPremium ? 'PREMIUM' : (isVerified ? 'VERIFIED' : row.resourceQualityLabel),
        quality: {
          label: isVerified ? 'VERIFIED' : row.resourceQualityLabel,
          displayMark: isVerified ? '✓' : (isPremium ? '⭐' : null),
          isVerified,
          verifiedAt: verification ? verification.verifiedAt.toISOString() : null,
        },
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

  async getAutocompleteSuggestions(
    query: AutocompleteQuery,
  ): Promise<{ suggestions: AutocompleteSuggestion[]; fallbackUsed: boolean }> {
    const trimmedQ = (query.q || '').trim();
    if (trimmedQ.length < 2) {
      return { suggestions: [], fallbackUsed: false };
    }

    const limit = Math.min(5, Math.max(1, query.limit || 5));
    const lowerPrefix = `${trimmedQ.toLowerCase()}%`;
    const escapedQ = escapeRegexMetacharacters(trimmedQ);

    // Resolve Country filter if provided
    let countryId: string | null = null;
    if (query.country) {
      const countryInput = query.country.trim();
      if (UUID_REGEX.test(countryInput)) {
        countryId = countryInput;
      } else {
        const countryRow = await this.db
          .select({ id: countries.id })
          .from(countries)
          .where(
            or(
              eq(sql`LOWER(${countries.urlPrefix})`, countryInput.toLowerCase()),
              eq(sql`UPPER(${countries.isoCode})`, countryInput.toUpperCase()),
            ),
          )
          .limit(1);
        if (countryRow.length > 0) {
          countryId = countryRow[0].id;
        }
      }
    }

    // Check if contextual parameters were provided
    const hasContextFilters = Boolean(
      query.curriculum ||
      query.curriculumVersion ||
      query.educationLevel ||
      query.grade ||
      query.pathway ||
      query.subject ||
      query.topic,
    );

    // Helper to query published resources matching query
    const queryResourceTitles = async (applyContext: boolean) => {
      const conditions = [
        eq(resources.status, 'PUBLISHED'),
        eq(resourceVersions.status, 'PUBLISHED'),
        or(
          sql`lower(${resources.title}) LIKE ${lowerPrefix}`,
          sql`${resources.title} ~* ${'\\y' + escapedQ}`,
        )!,
      ];

      if (countryId) {
        conditions.push(eq(resources.countryId, countryId));
      }

      if (applyContext) {
        if (query.grade) {
          if (UUID_REGEX.test(query.grade.trim())) {
            conditions.push(eq(resources.gradeId, query.grade.trim()));
          } else {
            conditions.push(eq(sql`LOWER(${grades.code})`, query.grade.trim().toLowerCase()));
          }
        }
        if (query.subject) {
          if (UUID_REGEX.test(query.subject.trim())) {
            conditions.push(eq(resources.subjectId, query.subject.trim()));
          } else {
            conditions.push(eq(sql`LOWER(${subjects.code})`, query.subject.trim().toLowerCase()));
          }
        }
        if (query.curriculum) {
          if (UUID_REGEX.test(query.curriculum.trim())) {
            conditions.push(eq(resources.curriculumId, query.curriculum.trim()));
          } else {
            conditions.push(eq(sql`LOWER(${curricula.code})`, query.curriculum.trim().toLowerCase()));
          }
        }
        if (query.topic) {
          if (UUID_REGEX.test(query.topic.trim())) {
            conditions.push(eq(resources.topicId, query.topic.trim()));
          } else {
            conditions.push(eq(sql`LOWER(${topics.code})`, query.topic.trim().toLowerCase()));
          }
        }
      }

      const rows = await this.db
        .select({
          resourceId: resources.id,
          title: resources.title,
          slug: resources.slug,
          countryName: countries.name,
          curriculumName: curricula.name,
          gradeName: grades.name,
          subjectName: subjects.name,
          tier: sql<number>`CASE 
            WHEN lower(${resources.title}) LIKE ${lowerPrefix} THEN 1 
            ELSE 2 
          END`.as('tier'),
        })
        .from(resources)
        .innerJoin(resourceVersions, eq(resources.id, resourceVersions.resourceId))
        .innerJoin(countries, eq(resources.countryId, countries.id))
        .leftJoin(curricula, eq(resources.curriculumId, curricula.id))
        .leftJoin(grades, eq(resources.gradeId, grades.id))
        .leftJoin(subjects, eq(resources.subjectId, subjects.id))
        .leftJoin(topics, eq(resources.topicId, topics.id))
        .where(and(...conditions))
        .orderBy(
          sql`tier ASC`,
          sql`LENGTH(${resources.title}) ASC`,
          asc(resources.title),
          asc(resources.id),
        )
        .limit(limit);

      return rows;
    };

    // 1. Try with context if provided
    const contextRows = await queryResourceTitles(hasContextFilters);

    const suggestions: AutocompleteSuggestion[] = [];
    const seenTitles = new Set<string>();

    for (const row of contextRows) {
      if (!seenTitles.has(row.title.toLowerCase())) {
        seenTitles.add(row.title.toLowerCase());
        suggestions.push({
          text: row.title,
          type: 'RESOURCE_TITLE',
          resourceId: row.resourceId,
          slug: row.slug,
          context: {
            country: row.countryName || undefined,
            curriculum: row.curriculumName || undefined,
            grade: row.gradeName || undefined,
            subject: row.subjectName || undefined,
          },
        });
      }
      if (suggestions.length >= limit) break;
    }

    // Also look for matching curriculum topics if slots remain and subject context is present
    if (suggestions.length < limit && hasContextFilters && (query.subject || query.grade)) {
      const topicConditions = [
        or(
          sql`lower(${topics.name}) LIKE ${lowerPrefix}`,
          sql`${topics.name} ~* ${'\\y' + escapedQ}`,
        )!,
      ];
      if (query.subject) {
        if (UUID_REGEX.test(query.subject.trim())) {
          topicConditions.push(eq(topics.subjectId, query.subject.trim()));
        } else {
          topicConditions.push(eq(sql`LOWER(${subjects.code})`, query.subject.trim().toLowerCase()));
        }
      }
      const topicRows = await this.db
        .select({
          topicId: topics.id,
          name: topics.name,
          subjectName: subjects.name,
        })
        .from(topics)
        .innerJoin(subjects, eq(topics.subjectId, subjects.id))
        .where(and(...topicConditions))
        .limit(limit - suggestions.length);

      for (const t of topicRows) {
        if (!seenTitles.has(t.name.toLowerCase())) {
          seenTitles.add(t.name.toLowerCase());
          suggestions.push({
            text: t.name,
            type: 'CURRICULUM_TOPIC',
            context: {
              subject: t.subjectName,
            },
          });
        }
        if (suggestions.length >= limit) break;
      }
    }

    // If matches found, return
    if (suggestions.length > 0) {
      return { suggestions: suggestions.slice(0, limit), fallbackUsed: false };
    }

    // 2. If zero results and context was specified, execute Fallback across the country
    if (hasContextFilters) {
      const fallbackRows = await queryResourceTitles(false);
      const fallbackSuggestions: AutocompleteSuggestion[] = [];
      for (const row of fallbackRows) {
        if (!seenTitles.has(row.title.toLowerCase())) {
          seenTitles.add(row.title.toLowerCase());
          fallbackSuggestions.push({
            text: row.title,
            type: 'RESOURCE_TITLE',
            resourceId: row.resourceId,
            slug: row.slug,
            context: {
              country: row.countryName || undefined,
              curriculum: row.curriculumName || undefined,
              grade: row.gradeName || undefined,
              subject: row.subjectName || undefined,
            },
          });
        }
        if (fallbackSuggestions.length >= limit) break;
      }

      return {
        suggestions: fallbackSuggestions.slice(0, limit),
        fallbackUsed: fallbackSuggestions.length > 0,
      };
    }

    return { suggestions: [], fallbackUsed: false };
  }

  async getRelatedDiscovery(
    query: RelatedDiscoveryQuery,
  ): Promise<RelatedDiscoveryResult> {
    const rawQ = (query.q || '').trim();
    const escapedQ = escapeRegexMetacharacters(rawQ);

    // 1. Related subjects
    const relatedSubjects = await this.db
      .select({
        id: subjects.id,
        name: subjects.name,
        code: subjects.code,
      })
      .from(subjects)
      .where(sql`${subjects.name} ~* ${'\\y' + escapedQ}`)
      .limit(5);

    // 2. Related topics
    const relatedTopics = await this.db
      .select({
        id: topics.id,
        name: topics.name,
        code: topics.code,
      })
      .from(topics)
      .where(sql`${topics.name} ~* ${'\\y' + escapedQ}`)
      .limit(5);

    // 3. Suggested resources in country
    const searchRes = await this.searchResources({
      q: rawQ,
      country: query.country,
      curriculum: query.curriculum,
      grade: query.grade,
      subject: query.subject,
      pageSize: 5,
    });

    let suggestedResources = searchRes.data;

    // If zero resources found with direct query, search using related subject names
    if (suggestedResources.length === 0 && relatedSubjects.length > 0) {
      const subjectSearch = await this.searchResources({
        q: relatedSubjects[0].name,
        country: query.country,
        pageSize: 5,
      });
      suggestedResources = subjectSearch.data;
    }

    return {
      query: rawQ,
      relatedSubjects,
      relatedTopics,
      suggestedResources,
    };
  }
}
