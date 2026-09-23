import { eq, and, or, sql, count } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import {
  schools,
  countries,
  administrativeAreas,
  type SchoolType,
} from '../db/schemas.js';

export interface SchoolCountryReference {
  id: string;
  name: string;
  isoCode: string;
}

export interface SchoolAreaReference {
  id: string;
  name: string;
  code: string | null;
  slug: string;
}

export interface SchoolResult {
  id: string;
  name: string;
  code: string | null;
  schoolType: string;
  status: string;
  country: SchoolCountryReference;
  administrativeArea: SchoolAreaReference | null;
  createdAt: string;
  updatedAt: string;
}

export interface ListSchoolsParams {
  country?: string;
  countryId?: string;
  administrativeAreaId?: string;
  schoolType?: string;
  page?: number;
  pageSize?: number;
}

export interface ListSchoolsResult {
  data: SchoolResult[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface SchoolService {
  listSchools(params: ListSchoolsParams): Promise<ListSchoolsResult>;
  getSchoolById(id: string): Promise<SchoolResult | null>;
}

export class DbSchoolService implements SchoolService {
  constructor(private readonly dbInstance = defaultDb) {}

  async listSchools(params: ListSchoolsParams): Promise<ListSchoolsResult> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    // Base conditions: public API only returns ACTIVE schools
    const conditions = [eq(schools.status, 'ACTIVE')];

    // Filter by country (can be UUID, ISO code, or URL prefix)
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

    if (params.countryId) {
      conditions.push(eq(schools.countryId, params.countryId));
    }

    if (params.administrativeAreaId) {
      conditions.push(
        eq(schools.administrativeAreaId, params.administrativeAreaId),
      );
    }

    if (params.schoolType) {
      conditions.push(
        eq(schools.schoolType, params.schoolType.toUpperCase() as SchoolType),
      );
    }

    const whereClause = and(...conditions);

    // Get total count
    const [totalRecord] = await this.dbInstance
      .select({ value: count() })
      .from(schools)
      .innerJoin(countries, eq(schools.countryId, countries.id))
      .where(whereClause);

    const total = Number(totalRecord?.value ?? 0);

    // Fetch paginated records with country and optional area join
    const records = await this.dbInstance
      .select({
        id: schools.id,
        name: schools.name,
        code: schools.code,
        schoolType: schools.schoolType,
        status: schools.status,
        createdAt: schools.createdAt,
        updatedAt: schools.updatedAt,
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        areaId: administrativeAreas.id,
        areaName: administrativeAreas.name,
        areaCode: administrativeAreas.code,
        areaSlug: administrativeAreas.slug,
      })
      .from(schools)
      .innerJoin(countries, eq(schools.countryId, countries.id))
      .leftJoin(
        administrativeAreas,
        eq(schools.administrativeAreaId, administrativeAreas.id),
      )
      .where(whereClause)
      .orderBy(schools.name, schools.id)
      .limit(pageSize)
      .offset(offset);

    const data: SchoolResult[] = records.map((record) => ({
      id: record.id,
      name: record.name,
      code: record.code,
      schoolType: record.schoolType,
      status: record.status,
      country: {
        id: record.countryId,
        name: record.countryName,
        isoCode: record.countryIsoCode,
      },
      administrativeArea:
        record.areaId && record.areaName && record.areaSlug
          ? {
              id: record.areaId,
              name: record.areaName,
              code: record.areaCode,
              slug: record.areaSlug,
            }
          : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
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

  async getSchoolById(id: string): Promise<SchoolResult | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id.trim(),
      );
    if (!isUuid) return null;

    // Public discovery: only return if ACTIVE
    const records = await this.dbInstance
      .select({
        id: schools.id,
        name: schools.name,
        code: schools.code,
        schoolType: schools.schoolType,
        status: schools.status,
        createdAt: schools.createdAt,
        updatedAt: schools.updatedAt,
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        areaId: administrativeAreas.id,
        areaName: administrativeAreas.name,
        areaCode: administrativeAreas.code,
        areaSlug: administrativeAreas.slug,
      })
      .from(schools)
      .innerJoin(countries, eq(schools.countryId, countries.id))
      .leftJoin(
        administrativeAreas,
        eq(schools.administrativeAreaId, administrativeAreas.id),
      )
      .where(and(eq(schools.id, id), eq(schools.status, 'ACTIVE')))
      .limit(1);

    if (records.length === 0) {
      return null;
    }

    const record = records[0];
    return {
      id: record.id,
      name: record.name,
      code: record.code,
      schoolType: record.schoolType,
      status: record.status,
      country: {
        id: record.countryId,
        name: record.countryName,
        isoCode: record.countryIsoCode,
      },
      administrativeArea:
        record.areaId && record.areaName && record.areaSlug
          ? {
              id: record.areaId,
              name: record.areaName,
              code: record.areaCode,
              slug: record.areaSlug,
            }
          : null,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }
}

export const defaultSchoolService = new DbSchoolService();
