import { PostgreSQLSearchProvider } from './search/postgresql-search.provider.js';
import type {
  SearchProvider,
  SearchQuery,
  SearchResultItem,
} from './search/search-provider.interface.js';
import type { PaginatedResult } from './catalogue.service.js';

export type { SearchProvider, SearchQuery, SearchResultItem } from './search/search-provider.interface.js';
export { PostgreSQLSearchProvider } from './search/postgresql-search.provider.js';

export interface SearchService {
  searchResources(query: SearchQuery): Promise<PaginatedResult<SearchResultItem>>;
}

export class DefaultSearchService implements SearchService {
  constructor(
    private readonly provider: SearchProvider = new PostgreSQLSearchProvider(),
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
}
