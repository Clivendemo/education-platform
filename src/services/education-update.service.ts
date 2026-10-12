import { eq, and, ne, sql, desc, asc, inArray, or } from 'drizzle-orm';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  educationUpdates,
  educationUpdateCategories,
  educationUpdateCurricula,
  educationUpdateResources,
  countries,
  curricula,
  resources,
  type UpdatePublicationStatus,
} from '../db/schemas.js';
import { env } from '../config/env.js';

export class EducationUpdateError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'EDUCATION_UPDATE_ERROR',
  ) {
    super(message);
    this.name = 'EducationUpdateError';
  }
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AttachedResourceInput {
  resourceId: string;
  displayOrder?: number;
}

export interface CreateEducationUpdateInput {
  title: string;
  slug?: string;
  summary?: string | null;
  body: string;
  countryId?: string | null;
  categoryId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  curriculumIds?: string[];
  resources?: AttachedResourceInput[];
  userId?: string | null;
}

export interface UpdateEducationUpdateInput {
  title?: string;
  slug?: string;
  summary?: string | null;
  body?: string;
  countryId?: string | null;
  categoryId?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
  curriculumIds?: string[];
  resources?: AttachedResourceInput[];
  userId?: string | null;
}

export interface ListUpdatesParams {
  country?: string;
  category?: string;
  search?: string;
  status?: UpdatePublicationStatus;
  page?: number;
  pageSize?: number;
}

export interface AttachedCurriculumSummary {
  id: string;
  code: string | null;
  name: string;
  slug: string;
  countryId: string;
}

export interface AttachedResourceSummary {
  id: string;
  title: string;
  slug: string;
  qualityLabel: string;
  displayOrder: number;
}

export interface UpdateSeoMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  openGraph: {
    title: string;
    description: string;
    url: string;
    type: 'article';
    siteName: string;
    locale: string;
  };
  twitter: {
    card: 'summary';
    title: string;
    description: string;
  };
  robots: {
    index: boolean;
    follow: boolean;
  };
}

export interface PublicUpdateSummary {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  publicationStatus: UpdatePublicationStatus;
  publishedAt: string;
  canonicalUrl: string;
  country: {
    id: string;
    name: string;
    isoCode: string;
    urlPrefix: string;
  } | null;
  category: {
    id: string;
    name: string;
    slug: string;
  } | null;
}

export interface PublicUpdateDetail extends PublicUpdateSummary {
  body: string;
  seo: UpdateSeoMetadata;
  curricula: AttachedCurriculumSummary[];
  resources: AttachedResourceSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface AdminUpdateDetail {
  id: string;
  title: string;
  slug: string;
  summary: string | null;
  body: string;
  publicationStatus: UpdatePublicationStatus;
  publishedAt: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  canonicalUrl: string;
  country: {
    id: string;
    name: string;
    isoCode: string;
    urlPrefix: string;
  } | null;
  category: {
    id: string;
    name: string;
    slug: string;
  } | null;
  curricula: AttachedCurriculumSummary[];
  resources: AttachedResourceSummary[];
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedUpdatesResult<T> {
  data: T[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    hasMore: boolean;
  };
}

export interface EducationUpdateCategorySummary {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
}

export class EducationUpdateService {
  constructor(
    private readonly db: AppDatabase = defaultDb,
    private readonly canonicalBaseUrl: string = env.CANONICAL_DOMAIN,
    private readonly siteName: string = env.SITE_NAME,
  ) {}

  /**
   * Slugify helper ensuring URL-safe characters.
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Builds the deterministic canonical public URL.
   * Scoped by country urlPrefix when country is specified, or global /updates/:slug for regional.
   */
  private buildCanonicalUrl(countryUrlPrefix: string | null | undefined, slug: string): string {
    const base = this.canonicalBaseUrl.trim().replace(/\/+$/, '');
    const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, '');
    if (countryUrlPrefix && countryUrlPrefix.trim().length > 0) {
      const cleanPrefix = countryUrlPrefix.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
      return `${base}/${cleanPrefix}/updates/${cleanSlug}`;
    }
    return `${base}/updates/${cleanSlug}`;
  }

  /**
   * Maps country ISO code to OpenGraph locale.
   */
  private getLocaleForCountry(countryIsoCode?: string | null): string {
    const region = (countryIsoCode || 'KE').toUpperCase();
    return `en_${region}`;
  }

  /**
   * Resolves country by ID, ensuring it is ACTIVE.
   */
  private async getActiveCountry(countryId: string) {
    const [c] = await this.db
      .select()
      .from(countries)
      .where(and(eq(countries.id, countryId), eq(countries.status, 'ACTIVE')))
      .limit(1);

    if (!c) {
      throw new EducationUpdateError(
        `Country with ID ${countryId} does not exist or is inactive`,
        400,
        'INVALID_COUNTRY',
      );
    }
    return c;
  }

  /**
   * Validates country consistency for attached curricula and resources.
   * If update is country-scoped (countryId !== null):
   * - All curricula MUST belong to the specified countryId.
   * - All resources MUST belong to the specified countryId.
   */
  private async validateCountryConsistency(
    countryId: string | null | undefined,
    curriculumIds: string[] = [],
    resourceInputs: AttachedResourceInput[] = [],
  ): Promise<void> {
    if (curriculumIds.length > 0) {
      const foundCurricula = await this.db
        .select({ id: curricula.id, countryId: curricula.countryId, name: curricula.name })
        .from(curricula)
        .where(inArray(curricula.id, curriculumIds));

      if (foundCurricula.length !== curriculumIds.length) {
        throw new EducationUpdateError(
          'One or more specified curriculum IDs do not exist',
          400,
          'INVALID_CURRICULUM',
        );
      }

      if (countryId) {
        const mismatched = foundCurricula.find((c) => c.countryId !== countryId);
        if (mismatched) {
          throw new EducationUpdateError(
            `Country mismatch: Associated curriculum '${mismatched.name}' belongs to a different country than the update`,
            400,
            'COUNTRY_MISMATCH',
          );
        }
      }
    }

    if (resourceInputs.length > 0) {
      const resIds = resourceInputs.map((r) => r.resourceId);
      const foundResources = await this.db
        .select({ id: resources.id, countryId: resources.countryId, title: resources.title })
        .from(resources)
        .where(inArray(resources.id, resIds));

      if (foundResources.length !== resIds.length) {
        throw new EducationUpdateError(
          'One or more specified resource IDs do not exist',
          400,
          'INVALID_RESOURCE',
        );
      }

      if (countryId) {
        const mismatched = foundResources.find((r) => r.countryId !== countryId);
        if (mismatched) {
          throw new EducationUpdateError(
            `Country mismatch: Associated resource '${mismatched.title}' belongs to a different country than the update`,
            400,
            'COUNTRY_MISMATCH',
          );
        }
      }
    }
  }

  /**
   * Creates a new Education Update.
   * Always begins in DRAFT status.
   */
  async createUpdate(input: CreateEducationUpdateInput): Promise<AdminUpdateDetail> {
    const title = input.title?.trim();
    if (!title || title.length === 0) {
      throw new EducationUpdateError('Update title cannot be empty', 400, 'VALIDATION_ERROR');
    }

    const body = input.body?.trim();
    if (!body || body.length === 0) {
      throw new EducationUpdateError('Update body cannot be empty', 400, 'VALIDATION_ERROR');
    }

    const rawSlug = input.slug?.trim() || this.slugify(title);
    const slug = this.slugify(rawSlug);
    if (!slug || slug.length === 0) {
      throw new EducationUpdateError('Invalid or empty update slug', 400, 'VALIDATION_ERROR');
    }

    // Check slug collision
    const [existing] = await this.db
      .select({ id: educationUpdates.id })
      .from(educationUpdates)
      .where(eq(educationUpdates.slug, slug))
      .limit(1);

    if (existing) {
      throw new EducationUpdateError(
        `Duplicate slug: An education update with slug '${slug}' already exists`,
        409,
        'DUPLICATE_SLUG',
      );
    }

    // Validate Country
    if (input.countryId) {
      await this.getActiveCountry(input.countryId);
    }

    // Validate Category
    if (input.categoryId) {
      const [cat] = await this.db
        .select()
        .from(educationUpdateCategories)
        .where(
          and(
            eq(educationUpdateCategories.id, input.categoryId),
            eq(educationUpdateCategories.status, 'ACTIVE'),
          ),
        )
        .limit(1);

      if (!cat) {
        throw new EducationUpdateError(
          `Category with ID ${input.categoryId} does not exist or is inactive`,
          400,
          'INVALID_CATEGORY',
        );
      }
    }

    // Validate country consistency for associated curricula & resources
    await this.validateCountryConsistency(
      input.countryId,
      input.curriculumIds,
      input.resources,
    );

    // Transactional insert
    const updateId = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(educationUpdates)
        .values({
          title,
          slug,
          summary: input.summary?.trim() || null,
          body,
          countryId: input.countryId || null,
          categoryId: input.categoryId || null,
          seoTitle: input.seoTitle?.trim() || null,
          seoDescription: input.seoDescription?.trim() || null,
          publicationStatus: 'DRAFT',
          publishedAt: null,
          createdBy: input.userId || null,
          updatedBy: input.userId || null,
        })
        .returning({ id: educationUpdates.id });

      // Insert curricula
      if (input.curriculumIds && input.curriculumIds.length > 0) {
        const uniqueCurricula = Array.from(new Set(input.curriculumIds));
        await tx.insert(educationUpdateCurricula).values(
          uniqueCurricula.map((curriculumId) => ({
            updateId: inserted.id,
            curriculumId,
          })),
        );
      }

      // Insert resources
      if (input.resources && input.resources.length > 0) {
        const seen = new Set<string>();
        const resRows: { updateId: string; resourceId: string; displayOrder: number }[] = [];
        let order = 0;
        for (const item of input.resources) {
          if (!seen.has(item.resourceId)) {
            seen.add(item.resourceId);
            resRows.push({
              updateId: inserted.id,
              resourceId: item.resourceId,
              displayOrder: item.displayOrder !== undefined ? item.displayOrder : order++,
            });
          }
        }
        if (resRows.length > 0) {
          await tx.insert(educationUpdateResources).values(resRows);
        }
      }

      return inserted.id;
    });

    const result = await this.getAdminUpdateById(updateId);
    if (!result) {
      throw new EducationUpdateError('Failed to retrieve newly created update', 500);
    }
    return result;
  }

  /**
   * Updates an existing Education Update.
   * Cannot edit an ARCHIVED update.
   * Preserves publishedAt timestamp when updating published updates.
   */
  async updateUpdate(
    id: string,
    input: UpdateEducationUpdateInput,
  ): Promise<AdminUpdateDetail> {
    const existing = await this.getAdminUpdateRecord(id);
    if (!existing) {
      throw new EducationUpdateError(`Update with ID ${id} not found`, 404, 'NOT_FOUND');
    }

    if (existing.publicationStatus === 'ARCHIVED') {
      throw new EducationUpdateError('Cannot edit an archived education update', 400, 'CANNOT_EDIT_ARCHIVED');
    }

    // Slug check if changing
    let newSlug = existing.slug;
    if (input.slug !== undefined) {
      const slugCandidate = this.slugify(input.slug);
      if (!slugCandidate) {
        throw new EducationUpdateError('Slug cannot be empty', 400, 'VALIDATION_ERROR');
      }
      if (slugCandidate !== existing.slug) {
        const [conflict] = await this.db
          .select({ id: educationUpdates.id })
          .from(educationUpdates)
          .where(and(eq(educationUpdates.slug, slugCandidate), ne(educationUpdates.id, id)))
          .limit(1);

        if (conflict) {
          throw new EducationUpdateError(
            `Duplicate slug: An education update with slug '${slugCandidate}' already exists`,
            409,
            'DUPLICATE_SLUG',
          );
        }
        newSlug = slugCandidate;
      }
    }

    // Country validation
    let resolvedCountryId = existing.countryId;
    if (input.countryId !== undefined) {
      if (input.countryId) {
        await this.getActiveCountry(input.countryId);
        resolvedCountryId = input.countryId;
      } else {
        resolvedCountryId = null;
      }
    }

    // Category validation
    let resolvedCategoryId = existing.categoryId;
    if (input.categoryId !== undefined) {
      if (input.categoryId) {
        const [cat] = await this.db
          .select()
          .from(educationUpdateCategories)
          .where(
            and(
              eq(educationUpdateCategories.id, input.categoryId),
              eq(educationUpdateCategories.status, 'ACTIVE'),
            ),
          )
          .limit(1);

        if (!cat) {
          throw new EducationUpdateError(
            `Category with ID ${input.categoryId} does not exist or is inactive`,
            400,
            'INVALID_CATEGORY',
          );
        }
        resolvedCategoryId = input.categoryId;
      } else {
        resolvedCategoryId = null;
      }
    }

    // If changing curricula or resources, or changing country, validate country consistency
    const nextCurricula =
      input.curriculumIds !== undefined
        ? input.curriculumIds
        : (await this.getCurriculumIdsForUpdate(id));

    const nextResources =
      input.resources !== undefined
        ? input.resources
        : (await this.getResourceInputsForUpdate(id));

    await this.validateCountryConsistency(
      resolvedCountryId,
      nextCurricula,
      nextResources,
    );

    // Apply updates inside transaction
    await this.db.transaction(async (tx) => {
      const updateData: Record<string, any> = {
        updatedAt: new Date(),
        updatedBy: input.userId || null,
      };

      if (input.title !== undefined) {
        const title = input.title.trim();
        if (!title) throw new EducationUpdateError('Update title cannot be empty', 400, 'VALIDATION_ERROR');
        updateData.title = title;
      }

      if (input.body !== undefined) {
        const body = input.body.trim();
        if (!body) throw new EducationUpdateError('Update body cannot be empty', 400, 'VALIDATION_ERROR');
        updateData.body = body;
      }

      if (input.slug !== undefined) {
        updateData.slug = newSlug;
      }

      if (input.summary !== undefined) {
        updateData.summary = input.summary?.trim() || null;
      }

      if (input.countryId !== undefined) {
        updateData.countryId = resolvedCountryId;
      }

      if (input.categoryId !== undefined) {
        updateData.categoryId = resolvedCategoryId;
      }

      if (input.seoTitle !== undefined) {
        updateData.seoTitle = input.seoTitle?.trim() || null;
      }

      if (input.seoDescription !== undefined) {
        updateData.seoDescription = input.seoDescription?.trim() || null;
      }

      await tx
        .update(educationUpdates)
        .set(updateData)
        .where(eq(educationUpdates.id, id));

      // Curricula update
      if (input.curriculumIds !== undefined) {
        await tx
          .delete(educationUpdateCurricula)
          .where(eq(educationUpdateCurricula.updateId, id));

        const uniqueCurricula = Array.from(new Set(input.curriculumIds));
        if (uniqueCurricula.length > 0) {
          await tx.insert(educationUpdateCurricula).values(
            uniqueCurricula.map((curriculumId) => ({
              updateId: id,
              curriculumId,
            })),
          );
        }
      }

      // Resources update
      if (input.resources !== undefined) {
        await tx
          .delete(educationUpdateResources)
          .where(eq(educationUpdateResources.updateId, id));

        const seen = new Set<string>();
        const resRows: { updateId: string; resourceId: string; displayOrder: number }[] = [];
        let order = 0;
        for (const item of input.resources) {
          if (!seen.has(item.resourceId)) {
            seen.add(item.resourceId);
            resRows.push({
              updateId: id,
              resourceId: item.resourceId,
              displayOrder: item.displayOrder !== undefined ? item.displayOrder : order++,
            });
          }
        }
        if (resRows.length > 0) {
          await tx.insert(educationUpdateResources).values(resRows);
        }
      }
    });

    const result = await this.getAdminUpdateById(id);
    if (!result) {
      throw new EducationUpdateError('Failed to retrieve updated update', 500);
    }
    return result;
  }

  /**
   * Publishes an Education Update.
   * State transition: DRAFT -> PUBLISHED.
   * Sets publishedAt on first publication and preserves it thereafter.
   */
  async publishUpdate(id: string, userId?: string | null): Promise<AdminUpdateDetail> {
    const existing = await this.getAdminUpdateRecord(id);
    if (!existing) {
      throw new EducationUpdateError(`Update with ID ${id} not found`, 404, 'NOT_FOUND');
    }

    if (existing.publicationStatus === 'ARCHIVED') {
      throw new EducationUpdateError('Cannot publish an archived update', 400, 'CANNOT_PUBLISH_ARCHIVED');
    }

    if (existing.publicationStatus === 'PUBLISHED') {
      // Already published; return clean record idempotently
      return (await this.getAdminUpdateById(id))!;
    }

    // Validate required content before publishing
    if (!existing.title || existing.title.trim().length === 0) {
      throw new EducationUpdateError('Cannot publish update without a valid title', 400, 'VALIDATION_ERROR');
    }
    if (!existing.body || existing.body.trim().length === 0) {
      throw new EducationUpdateError('Cannot publish update without content body', 400, 'VALIDATION_ERROR');
    }
    if (!existing.slug || existing.slug.trim().length === 0) {
      throw new EducationUpdateError('Cannot publish update without a valid slug', 400, 'VALIDATION_ERROR');
    }

    // Set published_at if null
    const publishedAt = existing.publishedAt || new Date();

    await this.db
      .update(educationUpdates)
      .set({
        publicationStatus: 'PUBLISHED',
        publishedAt,
        updatedAt: new Date(),
        updatedBy: userId || existing.updatedBy,
      })
      .where(eq(educationUpdates.id, id));

    return (await this.getAdminUpdateById(id))!;
  }

  /**
   * Archives an Education Update.
   * State transitions: DRAFT -> ARCHIVED, PUBLISHED -> ARCHIVED.
   * Immediately hides the update from public endpoints.
   */
  async archiveUpdate(id: string, userId?: string | null): Promise<AdminUpdateDetail> {
    const existing = await this.getAdminUpdateRecord(id);
    if (!existing) {
      throw new EducationUpdateError(`Update with ID ${id} not found`, 404, 'NOT_FOUND');
    }

    if (existing.publicationStatus === 'ARCHIVED') {
      // Idempotent
      return (await this.getAdminUpdateById(id))!;
    }

    await this.db
      .update(educationUpdates)
      .set({
        publicationStatus: 'ARCHIVED',
        updatedAt: new Date(),
        updatedBy: userId || existing.updatedBy,
      })
      .where(eq(educationUpdates.id, id));

    return (await this.getAdminUpdateById(id))!;
  }

  /**
   * Public retrieval of a single published update by slug.
   * Hidden if not published. Attached resources stripped of drafts.
   */
  async getPublicUpdateBySlug(slug: string): Promise<PublicUpdateDetail | null> {
    const cleanSlug = slug.trim().toLowerCase();
    if (!cleanSlug) return null;

    const [row] = await this.db
      .select({
        id: educationUpdates.id,
        title: educationUpdates.title,
        slug: educationUpdates.slug,
        summary: educationUpdates.summary,
        body: educationUpdates.body,
        seoTitle: educationUpdates.seoTitle,
        seoDescription: educationUpdates.seoDescription,
        publicationStatus: educationUpdates.publicationStatus,
        publishedAt: educationUpdates.publishedAt,
        createdAt: educationUpdates.createdAt,
        updatedAt: educationUpdates.updatedAt,
        countryId: educationUpdates.countryId,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        categoryId: educationUpdates.categoryId,
        categoryName: educationUpdateCategories.name,
        categorySlug: educationUpdateCategories.slug,
      })
      .from(educationUpdates)
      .leftJoin(countries, eq(countries.id, educationUpdates.countryId))
      .leftJoin(
        educationUpdateCategories,
        eq(educationUpdateCategories.id, educationUpdates.categoryId),
      )
      .where(
        and(
          eq(educationUpdates.slug, cleanSlug),
          eq(educationUpdates.publicationStatus, 'PUBLISHED'),
        ),
      )
      .limit(1);

    if (!row) {
      return null;
    }

    // Fetch attached curricula
    const curriculaList = await this.getCurriculaDetailsForUpdate(row.id);

    // Fetch attached resources: ONLY PUBLISHED resources
    const resourcesList = await this.getPublishedResourcesForUpdate(row.id);

    const canonicalUrl = this.buildCanonicalUrl(row.countryUrlPrefix, row.slug);
    const locale = this.getLocaleForCountry(row.countryIsoCode);
    const title = row.seoTitle?.trim() || row.title;
    const description =
      row.seoDescription?.trim() ||
      row.summary?.trim() ||
      `${row.title} - Official education update on ${this.siteName}.`;

    const seo: UpdateSeoMetadata = {
      title,
      description,
      canonicalUrl,
      openGraph: {
        title,
        description,
        url: canonicalUrl,
        type: 'article',
        siteName: this.siteName,
        locale,
      },
      twitter: {
        card: 'summary',
        title,
        description,
      },
      robots: {
        index: true,
        follow: true,
      },
    };

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      body: row.body,
      publicationStatus: row.publicationStatus as UpdatePublicationStatus,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : row.createdAt.toISOString(),
      canonicalUrl,
      country: row.countryId
        ? {
            id: row.countryId,
            name: row.countryName!,
            isoCode: row.countryIsoCode!,
            urlPrefix: row.countryUrlPrefix!,
          }
        : null,
      category: row.categoryId
        ? {
            id: row.categoryId,
            name: row.categoryName!,
            slug: row.categorySlug!,
          }
        : null,
      curricula: curriculaList,
      resources: resourcesList,
      seo,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Lists published updates with filtering and pagination for public discovery.
   */
  async listPublicUpdates(
    params: ListUpdatesParams = {},
  ): Promise<PaginatedUpdatesResult<PublicUpdateSummary>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const conditions = [eq(educationUpdates.publicationStatus, 'PUBLISHED')];

    // Filter by Country (isoCode, urlPrefix, or UUID)
    if (params.country) {
      const countryInput = params.country.trim();
      if (UUID_REGEX.test(countryInput)) {
        conditions.push(eq(educationUpdates.countryId, countryInput));
      } else {
        conditions.push(
          or(
            eq(sql`LOWER(${countries.urlPrefix})`, countryInput.toLowerCase()),
            eq(sql`UPPER(${countries.isoCode})`, countryInput.toUpperCase()),
          )!,
        );
      }
    }

    // Filter by Category (slug or UUID)
    if (params.category) {
      const catInput = params.category.trim();
      if (UUID_REGEX.test(catInput)) {
        conditions.push(eq(educationUpdates.categoryId, catInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${educationUpdateCategories.slug})`, catInput.toLowerCase()),
        );
      }
    }

    // Search term in title or summary
    if (params.search && params.search.trim().length > 0) {
      const term = `%${params.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          sql`LOWER(${educationUpdates.title}) LIKE ${term}`,
          sql`LOWER(COALESCE(${educationUpdates.summary}, '')) LIKE ${term}`,
        )!,
      );
    }

    const whereClause = and(...conditions);

    // Count
    const [countRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(educationUpdates)
      .leftJoin(countries, eq(countries.id, educationUpdates.countryId))
      .leftJoin(
        educationUpdateCategories,
        eq(educationUpdateCategories.id, educationUpdates.categoryId),
      )
      .where(whereClause);

    const total = Number(countRow?.count || 0);

    // Query rows ordered by publishedAt DESC
    const rows = await this.db
      .select({
        id: educationUpdates.id,
        title: educationUpdates.title,
        slug: educationUpdates.slug,
        summary: educationUpdates.summary,
        publicationStatus: educationUpdates.publicationStatus,
        publishedAt: educationUpdates.publishedAt,
        createdAt: educationUpdates.createdAt,
        countryId: educationUpdates.countryId,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        categoryId: educationUpdates.categoryId,
        categoryName: educationUpdateCategories.name,
        categorySlug: educationUpdateCategories.slug,
      })
      .from(educationUpdates)
      .leftJoin(countries, eq(countries.id, educationUpdates.countryId))
      .leftJoin(
        educationUpdateCategories,
        eq(educationUpdateCategories.id, educationUpdates.categoryId),
      )
      .where(whereClause)
      .orderBy(desc(educationUpdates.publishedAt), desc(educationUpdates.createdAt))
      .limit(pageSize)
      .offset(offset);

    const data: PublicUpdateSummary[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      summary: r.summary,
      publicationStatus: r.publicationStatus as UpdatePublicationStatus,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : r.createdAt.toISOString(),
      canonicalUrl: this.buildCanonicalUrl(r.countryUrlPrefix, r.slug),
      country: r.countryId
        ? {
            id: r.countryId,
            name: r.countryName!,
            isoCode: r.countryIsoCode!,
            urlPrefix: r.countryUrlPrefix!,
          }
        : null,
      category: r.categoryId
        ? {
            id: r.categoryId,
            name: r.categoryName!,
            slug: r.categorySlug!,
          }
        : null,
    }));

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        hasMore: offset + data.length < total,
      },
    };
  }

  /**
   * Finds related published updates sharing category, curricula, or country.
   */
  async getRelatedUpdates(slug: string, limit: number = 5): Promise<PublicUpdateSummary[]> {
    const cleanSlug = slug.trim().toLowerCase();
    const current = await this.getPublicUpdateBySlug(cleanSlug);
    if (!current) {
      return [];
    }

    const maxLimit = Math.min(20, Math.max(1, limit));

    // Curriculum IDs of current update
    const currIds = current.curricula.map((c) => c.id);

    const relatedConditions = [
      eq(educationUpdates.publicationStatus, 'PUBLISHED'),
      ne(educationUpdates.id, current.id),
    ];

    const matchConditions: any[] = [];

    if (current.category?.id) {
      matchConditions.push(eq(educationUpdates.categoryId, current.category.id));
    }

    if (current.country?.id) {
      matchConditions.push(eq(educationUpdates.countryId, current.country.id));
    }

    if (currIds.length > 0) {
      const sharedUpdates = await this.db
        .select({ updateId: educationUpdateCurricula.updateId })
        .from(educationUpdateCurricula)
        .where(inArray(educationUpdateCurricula.curriculumId, currIds));

      const sharedUpdateIds = sharedUpdates.map((u) => u.updateId);
      if (sharedUpdateIds.length > 0) {
        matchConditions.push(inArray(educationUpdates.id, sharedUpdateIds));
      }
    }

    if (matchConditions.length > 0) {
      relatedConditions.push(or(...matchConditions)!);
    }

    const rows = await this.db
      .select({
        id: educationUpdates.id,
        title: educationUpdates.title,
        slug: educationUpdates.slug,
        summary: educationUpdates.summary,
        publicationStatus: educationUpdates.publicationStatus,
        publishedAt: educationUpdates.publishedAt,
        createdAt: educationUpdates.createdAt,
        countryId: educationUpdates.countryId,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        categoryId: educationUpdates.categoryId,
        categoryName: educationUpdateCategories.name,
        categorySlug: educationUpdateCategories.slug,
      })
      .from(educationUpdates)
      .leftJoin(countries, eq(countries.id, educationUpdates.countryId))
      .leftJoin(
        educationUpdateCategories,
        eq(educationUpdateCategories.id, educationUpdates.categoryId),
      )
      .where(and(...relatedConditions))
      .orderBy(desc(educationUpdates.publishedAt), desc(educationUpdates.createdAt))
      .limit(maxLimit);

    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      slug: r.slug,
      summary: r.summary,
      publicationStatus: r.publicationStatus as UpdatePublicationStatus,
      publishedAt: r.publishedAt ? r.publishedAt.toISOString() : r.createdAt.toISOString(),
      canonicalUrl: this.buildCanonicalUrl(r.countryUrlPrefix, r.slug),
      country: r.countryId
        ? {
            id: r.countryId,
            name: r.countryName!,
            isoCode: r.countryIsoCode!,
            urlPrefix: r.countryUrlPrefix!,
          }
        : null,
      category: r.categoryId
        ? {
            id: r.categoryId,
            name: r.categoryName!,
            slug: r.categorySlug!,
          }
        : null,
    }));
  }

  /**
   * Administrative list of updates across all publication statuses.
   */
  async listAdminUpdates(
    params: ListUpdatesParams = {},
  ): Promise<PaginatedUpdatesResult<AdminUpdateDetail>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const conditions: any[] = [];

    if (params.status) {
      conditions.push(eq(educationUpdates.publicationStatus, params.status));
    }

    if (params.country) {
      const countryInput = params.country.trim();
      if (UUID_REGEX.test(countryInput)) {
        conditions.push(eq(educationUpdates.countryId, countryInput));
      } else {
        conditions.push(
          or(
            eq(sql`LOWER(${countries.urlPrefix})`, countryInput.toLowerCase()),
            eq(sql`UPPER(${countries.isoCode})`, countryInput.toUpperCase()),
          )!,
        );
      }
    }

    if (params.category) {
      const catInput = params.category.trim();
      if (UUID_REGEX.test(catInput)) {
        conditions.push(eq(educationUpdates.categoryId, catInput));
      } else {
        conditions.push(
          eq(sql`LOWER(${educationUpdateCategories.slug})`, catInput.toLowerCase()),
        );
      }
    }

    if (params.search && params.search.trim().length > 0) {
      const term = `%${params.search.trim().toLowerCase()}%`;
      conditions.push(
        or(
          sql`LOWER(${educationUpdates.title}) LIKE ${term}`,
          sql`LOWER(COALESCE(${educationUpdates.summary}, '')) LIKE ${term}`,
        )!,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countRow] = await this.db
      .select({ count: sql<string>`count(*)` })
      .from(educationUpdates)
      .leftJoin(countries, eq(countries.id, educationUpdates.countryId))
      .leftJoin(
        educationUpdateCategories,
        eq(educationUpdateCategories.id, educationUpdates.categoryId),
      )
      .where(whereClause);

    const total = Number(countRow?.count || 0);

    const rows = await this.db
      .select({
        id: educationUpdates.id,
        title: educationUpdates.title,
        slug: educationUpdates.slug,
        summary: educationUpdates.summary,
        body: educationUpdates.body,
        seoTitle: educationUpdates.seoTitle,
        seoDescription: educationUpdates.seoDescription,
        publicationStatus: educationUpdates.publicationStatus,
        publishedAt: educationUpdates.publishedAt,
        createdBy: educationUpdates.createdBy,
        updatedBy: educationUpdates.updatedBy,
        createdAt: educationUpdates.createdAt,
        updatedAt: educationUpdates.updatedAt,
        countryId: educationUpdates.countryId,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        categoryId: educationUpdates.categoryId,
        categoryName: educationUpdateCategories.name,
        categorySlug: educationUpdateCategories.slug,
      })
      .from(educationUpdates)
      .leftJoin(countries, eq(countries.id, educationUpdates.countryId))
      .leftJoin(
        educationUpdateCategories,
        eq(educationUpdateCategories.id, educationUpdates.categoryId),
      )
      .where(whereClause)
      .orderBy(desc(educationUpdates.createdAt))
      .limit(pageSize)
      .offset(offset);

    // Map rows with details
    const data: AdminUpdateDetail[] = [];
    for (const r of rows) {
      const curriculaList = await this.getCurriculaDetailsForUpdate(r.id);
      const resourcesList = await this.getAllResourcesForUpdate(r.id);

      data.push({
        id: r.id,
        title: r.title,
        slug: r.slug,
        summary: r.summary,
        body: r.body,
        publicationStatus: r.publicationStatus as UpdatePublicationStatus,
        publishedAt: r.publishedAt ? r.publishedAt.toISOString() : null,
        seoTitle: r.seoTitle,
        seoDescription: r.seoDescription,
        canonicalUrl: this.buildCanonicalUrl(r.countryUrlPrefix, r.slug),
        country: r.countryId
          ? {
              id: r.countryId,
              name: r.countryName!,
              isoCode: r.countryIsoCode!,
              urlPrefix: r.countryUrlPrefix!,
            }
          : null,
        category: r.categoryId
          ? {
              id: r.categoryId,
              name: r.categoryName!,
              slug: r.categorySlug!,
            }
          : null,
        curricula: curriculaList,
        resources: resourcesList,
        createdBy: r.createdBy,
        updatedBy: r.updatedBy,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      });
    }

    return {
      data,
      meta: {
        page,
        pageSize,
        total,
        hasMore: offset + data.length < total,
      },
    };
  }

  /**
   * Administrative get by ID.
   */
  async getAdminUpdateById(id: string): Promise<AdminUpdateDetail | null> {
    const [row] = await this.db
      .select({
        id: educationUpdates.id,
        title: educationUpdates.title,
        slug: educationUpdates.slug,
        summary: educationUpdates.summary,
        body: educationUpdates.body,
        seoTitle: educationUpdates.seoTitle,
        seoDescription: educationUpdates.seoDescription,
        publicationStatus: educationUpdates.publicationStatus,
        publishedAt: educationUpdates.publishedAt,
        createdBy: educationUpdates.createdBy,
        updatedBy: educationUpdates.updatedBy,
        createdAt: educationUpdates.createdAt,
        updatedAt: educationUpdates.updatedAt,
        countryId: educationUpdates.countryId,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        categoryId: educationUpdates.categoryId,
        categoryName: educationUpdateCategories.name,
        categorySlug: educationUpdateCategories.slug,
      })
      .from(educationUpdates)
      .leftJoin(countries, eq(countries.id, educationUpdates.countryId))
      .leftJoin(
        educationUpdateCategories,
        eq(educationUpdateCategories.id, educationUpdates.categoryId),
      )
      .where(eq(educationUpdates.id, id))
      .limit(1);

    if (!row) return null;

    const curriculaList = await this.getCurriculaDetailsForUpdate(row.id);
    const resourcesList = await this.getAllResourcesForUpdate(row.id);

    return {
      id: row.id,
      title: row.title,
      slug: row.slug,
      summary: row.summary,
      body: row.body,
      publicationStatus: row.publicationStatus as UpdatePublicationStatus,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
      seoTitle: row.seoTitle,
      seoDescription: row.seoDescription,
      canonicalUrl: this.buildCanonicalUrl(row.countryUrlPrefix, row.slug),
      country: row.countryId
        ? {
            id: row.countryId,
            name: row.countryName!,
            isoCode: row.countryIsoCode!,
            urlPrefix: row.countryUrlPrefix!,
          }
        : null,
      category: row.categoryId
        ? {
            id: row.categoryId,
            name: row.categoryName!,
            slug: row.categorySlug!,
          }
        : null,
      curricula: curriculaList,
      resources: resourcesList,
      createdBy: row.createdBy,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /**
   * Lists active categories.
   */
  async listCategories(): Promise<EducationUpdateCategorySummary[]> {
    const cats = await this.db
      .select({
        id: educationUpdateCategories.id,
        name: educationUpdateCategories.name,
        slug: educationUpdateCategories.slug,
        description: educationUpdateCategories.description,
        status: educationUpdateCategories.status,
      })
      .from(educationUpdateCategories)
      .where(eq(educationUpdateCategories.status, 'ACTIVE'))
      .orderBy(asc(educationUpdateCategories.name));

    return cats;
  }

  // Helper queries
  private async getAdminUpdateRecord(id: string) {
    const [u] = await this.db
      .select()
      .from(educationUpdates)
      .where(eq(educationUpdates.id, id))
      .limit(1);
    return u || null;
  }

  private async getCurriculumIdsForUpdate(updateId: string): Promise<string[]> {
    const rows = await this.db
      .select({ curriculumId: educationUpdateCurricula.curriculumId })
      .from(educationUpdateCurricula)
      .where(eq(educationUpdateCurricula.updateId, updateId));
    return rows.map((r) => r.curriculumId);
  }

  private async getResourceInputsForUpdate(updateId: string): Promise<AttachedResourceInput[]> {
    const rows = await this.db
      .select({
        resourceId: educationUpdateResources.resourceId,
        displayOrder: educationUpdateResources.displayOrder,
      })
      .from(educationUpdateResources)
      .where(eq(educationUpdateResources.updateId, updateId))
      .orderBy(asc(educationUpdateResources.displayOrder));
    return rows;
  }

  private async getCurriculaDetailsForUpdate(updateId: string): Promise<AttachedCurriculumSummary[]> {
    const rows = await this.db
      .select({
        id: curricula.id,
        code: curricula.code,
        name: curricula.name,
        slug: curricula.slug,
        countryId: curricula.countryId,
      })
      .from(educationUpdateCurricula)
      .innerJoin(curricula, eq(curricula.id, educationUpdateCurricula.curriculumId))
      .where(eq(educationUpdateCurricula.updateId, updateId))
      .orderBy(asc(curricula.name));
    return rows;
  }

  private async getPublishedResourcesForUpdate(updateId: string): Promise<AttachedResourceSummary[]> {
    const rows = await this.db
      .select({
        id: resources.id,
        title: resources.title,
        slug: resources.slug,
        qualityLabel: resources.qualityLabel,
        displayOrder: educationUpdateResources.displayOrder,
      })
      .from(educationUpdateResources)
      .innerJoin(resources, eq(resources.id, educationUpdateResources.resourceId))
      .where(
        and(
          eq(educationUpdateResources.updateId, updateId),
          eq(resources.status, 'PUBLISHED'),
        ),
      )
      .orderBy(asc(educationUpdateResources.displayOrder), asc(resources.title));
    return rows;
  }

  private async getAllResourcesForUpdate(updateId: string): Promise<AttachedResourceSummary[]> {
    const rows = await this.db
      .select({
        id: resources.id,
        title: resources.title,
        slug: resources.slug,
        qualityLabel: resources.qualityLabel,
        displayOrder: educationUpdateResources.displayOrder,
      })
      .from(educationUpdateResources)
      .innerJoin(resources, eq(resources.id, educationUpdateResources.resourceId))
      .where(eq(educationUpdateResources.updateId, updateId))
      .orderBy(asc(educationUpdateResources.displayOrder), asc(resources.title));
    return rows;
  }
}

export const defaultEducationUpdateService = new EducationUpdateService();
