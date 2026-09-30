import { eq, and } from 'drizzle-orm';
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
} from '../db/schemas.js';
import { env } from '../config/env.js';

type Database = typeof defaultDb;

export interface OpenGraphMetadata {
  title: string;
  description: string;
  url: string;
  type: 'article';
  siteName: string;
  locale: string;
}

export interface TwitterMetadata {
  card: 'summary';
  title: string;
  description: string;
}

export interface RobotsMetadata {
  index: boolean;
  follow: boolean;
}

export interface ResourceSeoMetadata {
  id: string;
  slug: string;
  title: string;
  description: string;
  canonicalUrl: string;
  country: {
    id: string;
    name: string;
    isoCode: string;
    urlPrefix: string;
  };
  openGraph: OpenGraphMetadata;
  twitter: TwitterMetadata;
  robots: RobotsMetadata;
}

export interface SeoService {
  getResourceSeoMetadata(id: string): Promise<ResourceSeoMetadata | null>;
}

export class DefaultSeoService implements SeoService {
  constructor(
    private readonly db: Database = defaultDb,
    private readonly canonicalBaseUrl: string = env.CANONICAL_DOMAIN,
    private readonly siteName: string = env.SITE_NAME,
  ) {}

  /**
   * Deterministically normalizes title and meta description.
   * Strips excess whitespace and control characters.
   */
  private normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Builds the deterministic canonical public URL:
   * https://<canonical-domain>/<countryUrlPrefix>/resources/<slug>
   */
  private buildCanonicalUrl(countryUrlPrefix: string, slug: string): string {
    const base = this.canonicalBaseUrl.trim().replace(/\/+$/, '');
    const cleanPrefix = countryUrlPrefix.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    const cleanSlug = slug.trim().replace(/^\/+|\/+$/g, '');
    return `${base}/${cleanPrefix}/resources/${cleanSlug}`;
  }

  /**
   * Generates a deterministic fallback description when resource/version description is missing.
   * Leverages authoritative taxonomy and country metadata without keyword stuffing.
   */
  private generateDeterministicFallbackDescription(data: {
    title: string;
    gradeName?: string | null;
    subjectName?: string | null;
    curriculumName?: string | null;
    countryName: string;
    resourceTypeName: string;
  }): string {
    const parts: string[] = [];
    if (data.gradeName && data.subjectName) {
      parts.push(`${data.gradeName} ${data.subjectName}`);
    } else if (data.subjectName) {
      parts.push(data.subjectName);
    } else if (data.gradeName) {
      parts.push(data.gradeName);
    }

    if (data.curriculumName) {
      parts.push(`under the ${data.curriculumName} curriculum`);
    }

    parts.push(`in ${data.countryName}`);

    const contextStr = parts.join(' ');
    return this.normalizeText(
      `${data.title} - ${data.resourceTypeName} educational resource for ${contextStr}.`,
    );
  }

  /**
   * Maps country ISO code to standard OpenGraph locale (e.g., KE -> en_KE).
   */
  private getLocaleForCountry(countryIsoCode: string, defaultLanguageCode: string = 'en'): string {
    const lang = (defaultLanguageCode || 'en').toLowerCase();
    const region = (countryIsoCode || 'KE').toUpperCase();
    return `${lang}_${region}`;
  }

  /**
   * Retrieves SEO metadata for a single published resource.
   *
   * Visibility Invariants:
   * 1. resources.status = 'PUBLISHED'
   * 2. resource_versions.status = 'PUBLISHED'
   * 3. Exactly single published version selected
   * 4. Excludes draft, in-review, approved, rejected, or archived resources
   * 5. Never leaks storage buckets, keys, providers, or credentials
   */
  async getResourceSeoMetadata(id: string): Promise<ResourceSeoMetadata | null> {
    const trimmedId = id.trim();

    // Query published resource joined with its single published version and authoritative taxonomy
    const records = await this.db
      .select({
        resourceId: resources.id,
        resourceTitle: resources.title,
        resourceSlug: resources.slug,
        resourceDescription: resources.description,
        versionId: resourceVersions.id,
        versionTitle: resourceVersions.title,
        versionDescription: resourceVersions.description,
        // Country
        countryId: countries.id,
        countryName: countries.name,
        countryIsoCode: countries.isoCode,
        countryUrlPrefix: countries.urlPrefix,
        countryLanguageCode: countries.defaultLanguageCode,
        countryStatus: countries.status,
        // Resource Type
        resourceTypeName: resourceTypes.name,
        // Taxonomy
        curriculumName: curricula.name,
        curriculumVersionName: curriculumVersions.versionName,
        educationLevelName: educationLevels.name,
        gradeName: grades.name,
        pathwayName: pathways.name,
        subjectName: subjects.name,
        topicName: topics.name,
        schoolName: schools.name,
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
      .leftJoin(curricula, eq(curricula.id, resources.curriculumId))
      .leftJoin(curriculumVersions, eq(curriculumVersions.id, resources.curriculumVersionId))
      .leftJoin(educationLevels, eq(educationLevels.id, resources.educationLevelId))
      .leftJoin(grades, eq(grades.id, resources.gradeId))
      .leftJoin(pathways, eq(pathways.id, resources.pathwayId))
      .leftJoin(subjects, eq(subjects.id, resources.subjectId))
      .leftJoin(topics, eq(topics.id, resources.topicId))
      .leftJoin(schools, eq(schools.id, resources.schoolId))
      .where(
        and(
          eq(resources.id, trimmedId),
          eq(resources.status, 'PUBLISHED'),
          eq(countries.status, 'ACTIVE'),
        ),
      )
      .limit(1);

    if (records.length === 0) {
      return null;
    }

    const row = records[0];

    // Authoritative Title: Prefer published version title if set, otherwise resource title
    const rawTitle = row.versionTitle?.trim() || row.resourceTitle.trim();
    const title = this.normalizeText(rawTitle);

    // Authoritative Description: Prefer published version description, then resource description, then deterministic fallback
    let description: string;
    const rawDesc = row.versionDescription?.trim() || row.resourceDescription?.trim();
    if (rawDesc && rawDesc.length > 0) {
      description = this.normalizeText(rawDesc);
    } else {
      description = this.generateDeterministicFallbackDescription({
        title,
        gradeName: row.gradeName,
        subjectName: row.subjectName,
        curriculumName: row.curriculumName,
        countryName: row.countryName,
        resourceTypeName: row.resourceTypeName,
      });
    }

    const canonicalUrl = this.buildCanonicalUrl(row.countryUrlPrefix, row.resourceSlug);
    const locale = this.getLocaleForCountry(row.countryIsoCode, row.countryLanguageCode);

    return {
      id: row.resourceId,
      slug: row.resourceSlug,
      title,
      description,
      canonicalUrl,
      country: {
        id: row.countryId,
        name: row.countryName,
        isoCode: row.countryIsoCode,
        urlPrefix: row.countryUrlPrefix,
      },
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
  }
}

export const defaultSeoService = new DefaultSeoService();
