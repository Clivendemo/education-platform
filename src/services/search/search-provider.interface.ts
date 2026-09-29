import type { CatalogueResourceSummary, PaginatedResult } from '../catalogue.service.js';

export interface SearchQuery {
  q: string;
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
  page?: number;
  pageSize?: number;
}

export interface SearchResultItem extends CatalogueResourceSummary {
  searchScore?: number;
}

export interface SearchProvider {
  searchResources(query: SearchQuery): Promise<PaginatedResult<SearchResultItem>>;
}
