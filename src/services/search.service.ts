import { sql } from 'drizzle-orm';
import { db as defaultDb } from '../db/index.js';
import { PostgreSQLSearchProvider } from './search/postgresql-search.provider.js';
import type {
  SearchProvider,
  SearchQuery,
  SearchResultItem,
  AutocompleteQuery,
  AutocompleteSuggestion,
  RelatedDiscoveryQuery,
  RelatedDiscoveryResult,
} from './search/search-provider.interface.js';
import type { PaginatedResult } from './catalogue.service.js';

export type {
  SearchProvider,
  SearchQuery,
  SearchResultItem,
  AutocompleteQuery,
  AutocompleteSuggestion,
  RelatedDiscoveryQuery,
  RelatedDiscoveryResult,
} from './search/search-provider.interface.js';
export { PostgreSQLSearchProvider } from './search/postgresql-search.provider.js';

export interface SearchDemandItem {
  query: string;
  totalSearches: number;
  distinctSearchIdentities: number;
  zeroResultCount: number;
  zeroResultRate: number;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface SearchDemandQuery {
  window?: '7d' | '30d' | '90d';
  type?: 'all' | 'popular' | 'zero_results';
  country?: string;
  minCount?: number;
  page?: number;
  pageSize?: number;
}

export interface SearchDemandResponseMeta {
  window: string;
  type: string;
  minCountThreshold: number;
  page: number;
  pageSize: number;
  total: number;
  hasMore: boolean;
}

export interface SearchService {
  searchResources(query: SearchQuery): Promise<PaginatedResult<SearchResultItem>>;
  getAutocompleteSuggestions?(
    query: AutocompleteQuery,
  ): Promise<{ suggestions: AutocompleteSuggestion[]; fallbackUsed: boolean }>;
  getRelatedDiscovery?(query: RelatedDiscoveryQuery): Promise<RelatedDiscoveryResult>;
  getSearchDemand?(
    query: SearchDemandQuery,
  ): Promise<{ data: SearchDemandItem[]; meta: SearchDemandResponseMeta }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class DefaultSearchService implements SearchService {
  constructor(
    private readonly provider: SearchProvider = new PostgreSQLSearchProvider(),
    private readonly db = defaultDb,
  ) {}

  async searchResources(
    query: SearchQuery,
  ): Promise<PaginatedResult<SearchResultItem>> {
    const trimmed = (query.q || '').trim();
    if (!trimmed) {
      throw new Error("Search query 'q' must not be empty");
    }

    return this.provider.searchResources({
      ...query,
      q: trimmed,
    });
  }

  async getAutocompleteSuggestions(
    query: AutocompleteQuery,
  ): Promise<{ suggestions: AutocompleteSuggestion[]; fallbackUsed: boolean }> {
    return this.provider.getAutocompleteSuggestions(query);
  }

  async getRelatedDiscovery(
    query: RelatedDiscoveryQuery,
  ): Promise<RelatedDiscoveryResult> {
    return this.provider.getRelatedDiscovery(query);
  }

  async getSearchDemand(
    query: SearchDemandQuery,
  ): Promise<{ data: SearchDemandItem[]; meta: SearchDemandResponseMeta }> {
    const windowParam = query.window || '30d';
    const intervalDays = windowParam === '7d' ? 7 : windowParam === '90d' ? 90 : 30;
    const typeParam = query.type || 'all';
    const minIdentities = Math.max(3, query.minCount || 3);
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    // Optional country filter
    let countryCondition = sql`1=1`;
    if (query.country) {
      const countryInput = query.country.trim();
      if (UUID_REGEX.test(countryInput)) {
        countryCondition = sql`ae.country_id = ${countryInput}::uuid`;
      }
    }

    // Type filter
    let typeCondition = sql`1=1`;
    if (typeParam === 'zero_results') {
      typeCondition = sql`zero_result_count > 0`;
    }

    // Order clause
    const orderClause =
      typeParam === 'zero_results'
        ? sql`zero_result_count DESC, total_searches DESC, normalized_query ASC`
        : sql`total_searches DESC, normalized_query ASC`;

    // Qualifying CTE definition
    const cteSql = sql`
      WITH qualifying_groups AS (
        SELECT
          ae.context->>'normalized_query' AS normalized_query,
          COUNT(*)::int AS total_searches,
          COUNT(DISTINCT CASE 
            WHEN ae.actor_type = 'AUTHENTICATED' AND ae.user_id IS NOT NULL 
              THEN 'u:' || ae.user_id::text
            WHEN ae.actor_type = 'ANONYMOUS' 
                 AND ae.anonymous_session_hash IS NOT NULL 
                 AND length(trim(ae.anonymous_session_hash)) = 64 
                 AND ae.anonymous_session_hash ~ '^[0-9a-f]{64}$'
              THEN 's:' || ae.anonymous_session_hash
            ELSE NULL
          END)::int AS distinct_search_identities,
          COUNT(*) FILTER (WHERE (ae.context->>'zero_results')::boolean IS TRUE)::int AS zero_result_count,
          ROUND(
            (COUNT(*) FILTER (WHERE (ae.context->>'zero_results')::boolean IS TRUE)::numeric / NULLIF(COUNT(*), 0)::numeric), 
            4
          )::float AS zero_result_rate,
          MIN(ae.occurred_at) AS first_seen_at,
          MAX(ae.occurred_at) AS last_seen_at
        FROM analytics.analytics_events ae
        JOIN analytics.analytics_event_types aet ON ae.event_type_id = aet.id
        WHERE aet.event_code IN ('search', 'RESOURCE_SEARCH')
          AND ae.actor_type IN ('AUTHENTICATED', 'ANONYMOUS')
          AND ae.occurred_at >= NOW() - (${intervalDays} || ' days')::interval
          AND ae.occurred_at <= NOW()
          AND (ae.context->>'normalized_query') IS NOT NULL
          AND ${countryCondition}
        GROUP BY ae.context->>'normalized_query'
        HAVING COUNT(DISTINCT CASE 
          WHEN ae.actor_type = 'AUTHENTICATED' AND ae.user_id IS NOT NULL 
            THEN 'u:' || ae.user_id::text
          WHEN ae.actor_type = 'ANONYMOUS' 
               AND ae.anonymous_session_hash IS NOT NULL 
               AND length(trim(ae.anonymous_session_hash)) = 64 
               AND ae.anonymous_session_hash ~ '^[0-9a-f]{64}$'
            THEN 's:' || ae.anonymous_session_hash
          ELSE NULL
        END) >= ${minIdentities}
      )
    `;

    // 1. Get total qualifying count
    const countResult = await this.db.execute<{ count: number }>(sql`
      ${cteSql}
      SELECT COUNT(*)::int AS count FROM qualifying_groups WHERE ${typeCondition};
    `);
    const totalCount = Number(countResult.rows[0]?.count || 0);

    // 2. Get paginated rows
    const rowsResult = await this.db.execute<{
      normalized_query: string;
      total_searches: number;
      distinct_search_identities: number;
      zero_result_count: number;
      zero_result_rate: number;
      first_seen_at: string;
      last_seen_at: string;
    }>(sql`
      ${cteSql}
      SELECT * FROM qualifying_groups 
      WHERE ${typeCondition}
      ORDER BY ${orderClause}
      LIMIT ${pageSize} OFFSET ${offset};
    `);

    const items: SearchDemandItem[] = rowsResult.rows.map((r) => ({
      query: r.normalized_query,
      totalSearches: Number(r.total_searches),
      distinctSearchIdentities: Number(r.distinct_search_identities),
      zeroResultCount: Number(r.zero_result_count),
      zeroResultRate: Number(r.zero_result_rate ?? 0),
      firstSeenAt: new Date(r.first_seen_at).toISOString(),
      lastSeenAt: new Date(r.last_seen_at).toISOString(),
    }));

    return {
      data: items,
      meta: {
        window: windowParam,
        type: typeParam,
        minCountThreshold: minIdentities,
        page,
        pageSize,
        total: totalCount,
        hasMore: offset + items.length < totalCount,
      },
    };
  }
}

export const defaultSearchService = new DefaultSearchService();
