import { eq, and, or, sql, count } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import {
  countries,
  administrativeAreaTypes,
  administrativeAreas,
} from '../db/schemas.js';

export interface CountryResult {
  id: string;
  name: string;
  isoCode: string;
  urlPrefix: string;
  defaultLanguageCode: string;
  currencyCode: string;
  status: string;
}

export interface AreaTypeSummary {
  id: string;
  name: string;
  slug: string;
  hierarchyLevel: number;
}

export interface AdministrativeAreaResult {
  id: string;
  countryId: string;
  typeId: string;
  parentTypeId: string | null;
  parentId: string | null;
  name: string;
  code: string | null;
  slug: string;
  status: string;
  type?: AreaTypeSummary;
}

export interface ListAreasParams {
  countryId?: string;
  typeId?: string;
  parentId?: string | null;
  page?: number;
  pageSize?: number;
}

export interface ListAreasResult {
  data: AdministrativeAreaResult[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface GeographyService {
  listActiveCountries(): Promise<CountryResult[]>;
  getActiveCountryByIdentifier(identifier: string): Promise<CountryResult | null>;
  listAreas(params: ListAreasParams): Promise<ListAreasResult>;
  getAreaById(id: string): Promise<AdministrativeAreaResult | null>;
  getChildAreas(parentId: string): Promise<AdministrativeAreaResult[]>;
}

export class DbGeographyService implements GeographyService {
  constructor(private readonly dbInstance = defaultDb) {}

  async listActiveCountries(): Promise<CountryResult[]> {
    const records = await this.dbInstance
      .select({
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
        urlPrefix: countries.urlPrefix,
        defaultLanguageCode: countries.defaultLanguageCode,
        currencyCode: countries.currencyCode,
        status: countries.status,
      })
      .from(countries)
      .where(eq(countries.status, 'ACTIVE'))
      .orderBy(countries.name);

    return records;
  }

  async getActiveCountryByIdentifier(
    identifier: string,
  ): Promise<CountryResult | null> {
    const trimmed = identifier.trim();
    if (!trimmed) return null;

    // Check if valid UUID format
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        trimmed,
      );

    const conditions = [
      eq(sql`lower(${countries.isoCode})`, trimmed.toLowerCase()),
      eq(sql`lower(${countries.urlPrefix})`, trimmed.toLowerCase()),
    ];

    if (isUuid) {
      conditions.push(eq(countries.id, trimmed));
    }

    const records = await this.dbInstance
      .select({
        id: countries.id,
        name: countries.name,
        isoCode: countries.isoCode,
        urlPrefix: countries.urlPrefix,
        defaultLanguageCode: countries.defaultLanguageCode,
        currencyCode: countries.currencyCode,
        status: countries.status,
      })
      .from(countries)
      .where(and(eq(countries.status, 'ACTIVE'), or(...conditions)))
      .limit(1);

    return records[0] ?? null;
  }

  async listAreas(params: ListAreasParams): Promise<ListAreasResult> {
    const page = Math.max(1, params.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 50));
    const offset = (page - 1) * pageSize;

    const whereConditions = [eq(administrativeAreas.status, 'ACTIVE')];

    if (params.countryId) {
      whereConditions.push(eq(administrativeAreas.countryId, params.countryId));
    }

    if (params.typeId) {
      whereConditions.push(eq(administrativeAreas.typeId, params.typeId));
    }

    if (params.parentId === 'root' || params.parentId === null) {
      whereConditions.push(sql`${administrativeAreas.parentId} IS NULL`);
    } else if (params.parentId) {
      whereConditions.push(eq(administrativeAreas.parentId, params.parentId));
    }

    const whereClause = and(...whereConditions);

    // Total count
    const [totalRow] = await this.dbInstance
      .select({ value: count() })
      .from(administrativeAreas)
      .where(whereClause);

    const total = Number(totalRow?.value ?? 0);

    // Fetch records with type metadata
    const rows = await this.dbInstance
      .select({
        id: administrativeAreas.id,
        countryId: administrativeAreas.countryId,
        typeId: administrativeAreas.typeId,
        parentTypeId: administrativeAreas.parentTypeId,
        parentId: administrativeAreas.parentId,
        name: administrativeAreas.name,
        code: administrativeAreas.code,
        slug: administrativeAreas.slug,
        status: administrativeAreas.status,
        typeName: administrativeAreaTypes.name,
        typeSlug: administrativeAreaTypes.slug,
        typeHierarchyLevel: administrativeAreaTypes.hierarchyLevel,
      })
      .from(administrativeAreas)
      .leftJoin(
        administrativeAreaTypes,
        eq(administrativeAreas.typeId, administrativeAreaTypes.id),
      )
      .where(whereClause)
      .orderBy(administrativeAreas.name)
      .limit(pageSize)
      .offset(offset);

    const items: AdministrativeAreaResult[] = rows.map((r) => ({
      id: r.id,
      countryId: r.countryId,
      typeId: r.typeId,
      parentTypeId: r.parentTypeId,
      parentId: r.parentId,
      name: r.name,
      code: r.code,
      slug: r.slug,
      status: r.status,
      type: r.typeName
        ? {
            id: r.typeId,
            name: r.typeName,
            slug: r.typeSlug!,
            hierarchyLevel: r.typeHierarchyLevel!,
          }
        : undefined,
    }));

    return {
      data: items,
      meta: {
        page,
        pageSize,
        total,
        hasMore: offset + items.length < total,
      },
    };
  }

  async getAreaById(id: string): Promise<AdministrativeAreaResult | null> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id.trim(),
      );
    if (!isUuid) return null;

    const rows = await this.dbInstance
      .select({
        id: administrativeAreas.id,
        countryId: administrativeAreas.countryId,
        typeId: administrativeAreas.typeId,
        parentTypeId: administrativeAreas.parentTypeId,
        parentId: administrativeAreas.parentId,
        name: administrativeAreas.name,
        code: administrativeAreas.code,
        slug: administrativeAreas.slug,
        status: administrativeAreas.status,
        typeName: administrativeAreaTypes.name,
        typeSlug: administrativeAreaTypes.slug,
        typeHierarchyLevel: administrativeAreaTypes.hierarchyLevel,
      })
      .from(administrativeAreas)
      .leftJoin(
        administrativeAreaTypes,
        eq(administrativeAreas.typeId, administrativeAreaTypes.id),
      )
      .where(
        and(
          eq(administrativeAreas.id, id.trim()),
          eq(administrativeAreas.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    const r = rows[0];
    if (!r) return null;

    return {
      id: r.id,
      countryId: r.countryId,
      typeId: r.typeId,
      parentTypeId: r.parentTypeId,
      parentId: r.parentId,
      name: r.name,
      code: r.code,
      slug: r.slug,
      status: r.status,
      type: r.typeName
        ? {
            id: r.typeId,
            name: r.typeName,
            slug: r.typeSlug!,
            hierarchyLevel: r.typeHierarchyLevel!,
          }
        : undefined,
    };
  }

  async getChildAreas(parentId: string): Promise<AdministrativeAreaResult[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        parentId.trim(),
      );
    if (!isUuid) return [];

    const rows = await this.dbInstance
      .select({
        id: administrativeAreas.id,
        countryId: administrativeAreas.countryId,
        typeId: administrativeAreas.typeId,
        parentTypeId: administrativeAreas.parentTypeId,
        parentId: administrativeAreas.parentId,
        name: administrativeAreas.name,
        code: administrativeAreas.code,
        slug: administrativeAreas.slug,
        status: administrativeAreas.status,
        typeName: administrativeAreaTypes.name,
        typeSlug: administrativeAreaTypes.slug,
        typeHierarchyLevel: administrativeAreaTypes.hierarchyLevel,
      })
      .from(administrativeAreas)
      .leftJoin(
        administrativeAreaTypes,
        eq(administrativeAreas.typeId, administrativeAreaTypes.id),
      )
      .where(
        and(
          eq(administrativeAreas.parentId, parentId.trim()),
          eq(administrativeAreas.status, 'ACTIVE'),
        ),
      )
      .orderBy(administrativeAreas.name);

    return rows.map((r) => ({
      id: r.id,
      countryId: r.countryId,
      typeId: r.typeId,
      parentTypeId: r.parentTypeId,
      parentId: r.parentId,
      name: r.name,
      code: r.code,
      slug: r.slug,
      status: r.status,
      type: r.typeName
        ? {
            id: r.typeId,
            name: r.typeName,
            slug: r.typeSlug!,
            hierarchyLevel: r.typeHierarchyLevel!,
          }
        : undefined,
    }));
  }
}

export const defaultGeographyService = new DbGeographyService();
