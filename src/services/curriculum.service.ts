import { eq, and, or, sql, count, asc, isNull } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import {
  curricula,
  curriculumVersions,
  educationLevels,
  grades,
  pathways,
  subjects,
  topics,
  countries,
} from '../db/schemas.js';

export interface CurriculumCountryReference {
  id: string;
  name: string;
  isoCode: string;
}

export interface CurriculumResult {
  id: string;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  status: string;
  country: CurriculumCountryReference;
  createdAt: string;
  updatedAt: string;
}

export interface CurriculumVersionResult {
  id: string;
  curriculumId: string;
  countryId: string;
  versionName: string;
  versionCode: string | null;
  slug: string;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  status: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EducationLevelResult {
  id: string;
  curriculumVersionId: string;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  sequenceOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface GradeResult {
  id: string;
  curriculumVersionId: string;
  educationLevelId: string;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  sequenceOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PathwayResult {
  id: string;
  curriculumVersionId: string;
  educationLevelId: string;
  gradeId: string;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  sequenceOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface SubjectResult {
  id: string;
  curriculumVersionId: string;
  educationLevelId: string;
  gradeId: string;
  pathwayId: string | null;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  sequenceOrder: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TopicResult {
  id: string;
  curriculumVersionId: string;
  subjectId: string;
  parentId: string | null;
  name: string;
  slug: string;
  code: string | null;
  description: string | null;
  sequenceOrder: number;
  status: string;
  subTopics?: TopicResult[];
  createdAt: string;
  updatedAt: string;
}

export interface ListCurriculaParams {
  country?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface ListCurriculaResult {
  data: CurriculumResult[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface CurriculumService {
  listCurricula(params: ListCurriculaParams): Promise<ListCurriculaResult>;
  getCurriculumById(id: string): Promise<CurriculumResult | null>;
  listCurriculumVersions(
    curriculumId: string,
    options?: { includeInactive?: boolean },
  ): Promise<CurriculumVersionResult[]>;
  getCurriculumVersionById(id: string): Promise<CurriculumVersionResult | null>;
  listEducationLevels(
    curriculumVersionId: string,
    options?: { includeInactive?: boolean },
  ): Promise<EducationLevelResult[]>;
  listGrades(
    educationLevelId: string,
    options?: { includeInactive?: boolean },
  ): Promise<GradeResult[]>;
  listPathways(
    gradeId: string,
    options?: { includeInactive?: boolean },
  ): Promise<PathwayResult[]>;
  listSubjects(options: {
    gradeId?: string;
    pathwayId?: string;
    includeInactive?: boolean;
  }): Promise<SubjectResult[]>;
  listTopics(
    subjectId: string,
    options?: { parentId?: string | null; includeInactive?: boolean },
  ): Promise<TopicResult[]>;
}

export class DbCurriculumService implements CurriculumService {
  constructor(private readonly dbInstance = defaultDb) {}

  async listCurricula(params: ListCurriculaParams): Promise<ListCurriculaResult> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    // Filter by status (default ACTIVE for public discovery)
    const targetStatus = params.status ?? 'ACTIVE';
    const conditions = [eq(curricula.status, targetStatus)];

    if (params.country) {
      const trimmed = params.country.trim();
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          trimmed,
        );

      if (isUuid) {
        conditions.push(eq(countries.id, trimmed));
      } else {
        conditions.push(
          or(
            eq(sql`lower(${countries.isoCode})`, trimmed.toLowerCase()),
            eq(sql`lower(${countries.urlPrefix})`, trimmed.toLowerCase()),
          )!,
        );
      }
    }

    const whereClause = and(...conditions);

    const [totalRecord] = await this.dbInstance
      .select({ value: count() })
      .from(curricula)
      .innerJoin(countries, eq(curricula.countryId, countries.id))
      .where(whereClause);

    const total = Number(totalRecord?.value ?? 0);

    const records = await this.dbInstance
      .select({
        id: curricula.id,
        name: curricula.name,
        slug: curricula.slug,
        code: curricula.code,
        description: curricula.description,
        status: curricula.status,
        createdAt: curricula.createdAt,
        updatedAt: curricula.updatedAt,
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
      })
      .from(curricula)
      .innerJoin(countries, eq(curricula.countryId, countries.id))
      .where(whereClause)
      .orderBy(asc(curricula.name), asc(curricula.id))
      .limit(pageSize)
      .offset(offset);

    const data: CurriculumResult[] = records.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      code: r.code,
      description: r.description,
      status: r.status,
      country: {
        id: r.countryId,
        name: r.countryName,
        isoCode: r.countryIsoCode,
      },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        hasMore: page * pageSize < total,
      },
    };
  }

  async getCurriculumById(id: string): Promise<CurriculumResult | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id.trim(),
      );
    if (!isUuid) return null;

    const records = await this.dbInstance
      .select({
        id: curricula.id,
        name: curricula.name,
        slug: curricula.slug,
        code: curricula.code,
        description: curricula.description,
        status: curricula.status,
        createdAt: curricula.createdAt,
        updatedAt: curricula.updatedAt,
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
      })
      .from(curricula)
      .innerJoin(countries, eq(curricula.countryId, countries.id))
      .where(eq(curricula.id, id))
      .limit(1);

    if (records.length === 0) return null;

    const r = records[0];
    return {
      id: r.id,
      name: r.name,
      slug: r.slug,
      code: r.code,
      description: r.description,
      status: r.status,
      country: {
        id: r.countryId,
        name: r.countryName,
        isoCode: r.countryIsoCode,
      },
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async listCurriculumVersions(
    curriculumId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<CurriculumVersionResult[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        curriculumId.trim(),
      );
    if (!isUuid) return [];

    const conditions = [eq(curriculumVersions.curriculumId, curriculumId)];
    if (!options.includeInactive) {
      conditions.push(
        sql`${curriculumVersions.status} IN ('CURRENT', 'PLANNED', 'DRAFT')`,
      );
    }

    const records = await this.dbInstance
      .select()
      .from(curriculumVersions)
      .where(and(...conditions))
      .orderBy(asc(curriculumVersions.versionName));

    return records.map((r) => ({
      id: r.id,
      curriculumId: r.curriculumId,
      countryId: r.countryId,
      versionName: r.versionName,
      versionCode: r.versionCode,
      slug: r.slug,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      status: r.status,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async getCurriculumVersionById(
    id: string,
  ): Promise<CurriculumVersionResult | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id.trim(),
      );
    if (!isUuid) return null;

    const records = await this.dbInstance
      .select()
      .from(curriculumVersions)
      .where(eq(curriculumVersions.id, id))
      .limit(1);

    if (records.length === 0) return null;

    const r = records[0];
    return {
      id: r.id,
      curriculumId: r.curriculumId,
      countryId: r.countryId,
      versionName: r.versionName,
      versionCode: r.versionCode,
      slug: r.slug,
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      status: r.status,
      description: r.description,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async listEducationLevels(
    curriculumVersionId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<EducationLevelResult[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        curriculumVersionId.trim(),
      );
    if (!isUuid) return [];

    const conditions = [
      eq(educationLevels.curriculumVersionId, curriculumVersionId),
    ];
    if (!options.includeInactive) {
      conditions.push(eq(educationLevels.status, 'ACTIVE'));
    }

    const records = await this.dbInstance
      .select()
      .from(educationLevels)
      .where(and(...conditions))
      .orderBy(asc(educationLevels.sequenceOrder));

    return records.map((r) => ({
      id: r.id,
      curriculumVersionId: r.curriculumVersionId,
      name: r.name,
      slug: r.slug,
      code: r.code,
      description: r.description,
      sequenceOrder: r.sequenceOrder,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listGrades(
    educationLevelId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<GradeResult[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        educationLevelId.trim(),
      );
    if (!isUuid) return [];

    const conditions = [eq(grades.educationLevelId, educationLevelId)];
    if (!options.includeInactive) {
      conditions.push(eq(grades.status, 'ACTIVE'));
    }

    const records = await this.dbInstance
      .select()
      .from(grades)
      .where(and(...conditions))
      .orderBy(asc(grades.sequenceOrder));

    return records.map((r) => ({
      id: r.id,
      curriculumVersionId: r.curriculumVersionId,
      educationLevelId: r.educationLevelId,
      name: r.name,
      slug: r.slug,
      code: r.code,
      description: r.description,
      sequenceOrder: r.sequenceOrder,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listPathways(
    gradeId: string,
    options: { includeInactive?: boolean } = {},
  ): Promise<PathwayResult[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        gradeId.trim(),
      );
    if (!isUuid) return [];

    const conditions = [eq(pathways.gradeId, gradeId)];
    if (!options.includeInactive) {
      conditions.push(eq(pathways.status, 'ACTIVE'));
    }

    const records = await this.dbInstance
      .select()
      .from(pathways)
      .where(and(...conditions))
      .orderBy(asc(pathways.sequenceOrder));

    return records.map((r) => ({
      id: r.id,
      curriculumVersionId: r.curriculumVersionId,
      educationLevelId: r.educationLevelId,
      gradeId: r.gradeId,
      name: r.name,
      slug: r.slug,
      code: r.code,
      description: r.description,
      sequenceOrder: r.sequenceOrder,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listSubjects(options: {
    gradeId?: string;
    pathwayId?: string;
    includeInactive?: boolean;
  }): Promise<SubjectResult[]> {
    const conditions = [];

    if (options.gradeId) {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          options.gradeId.trim(),
        );
      if (!isUuid) return [];
      conditions.push(eq(subjects.gradeId, options.gradeId));
    }

    if (options.pathwayId) {
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          options.pathwayId.trim(),
        );
      if (!isUuid) return [];
      conditions.push(eq(subjects.pathwayId, options.pathwayId));
    }

    if (!options.includeInactive) {
      conditions.push(eq(subjects.status, 'ACTIVE'));
    }

    const records = await this.dbInstance
      .select()
      .from(subjects)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(subjects.sequenceOrder));

    return records.map((r) => ({
      id: r.id,
      curriculumVersionId: r.curriculumVersionId,
      educationLevelId: r.educationLevelId,
      gradeId: r.gradeId,
      pathwayId: r.pathwayId,
      name: r.name,
      slug: r.slug,
      code: r.code,
      description: r.description,
      sequenceOrder: r.sequenceOrder,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }

  async listTopics(
    subjectId: string,
    options: { parentId?: string | null; includeInactive?: boolean } = {},
  ): Promise<TopicResult[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        subjectId.trim(),
      );
    if (!isUuid) return [];

    const conditions = [eq(topics.subjectId, subjectId)];

    if (options.parentId !== undefined) {
      if (options.parentId === null) {
        conditions.push(isNull(topics.parentId));
      } else {
        conditions.push(eq(topics.parentId, options.parentId));
      }
    }

    if (!options.includeInactive) {
      conditions.push(eq(topics.status, 'ACTIVE'));
    }

    const records = await this.dbInstance
      .select()
      .from(topics)
      .where(and(...conditions))
      .orderBy(asc(topics.sequenceOrder));

    return records.map((r) => ({
      id: r.id,
      curriculumVersionId: r.curriculumVersionId,
      subjectId: r.subjectId,
      parentId: r.parentId,
      name: r.name,
      slug: r.slug,
      code: r.code,
      description: r.description,
      sequenceOrder: r.sequenceOrder,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    }));
  }
}

export const defaultCurriculumService = new DbCurriculumService();
