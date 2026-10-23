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

export interface AutocompleteSuggestion {
  text: string;
  type: 'RESOURCE_TITLE' | 'CURRICULUM_TOPIC';
  resourceId?: string;
  slug?: string;
  context?: {
    country?: string;
    curriculum?: string;
    grade?: string;
    subject?: string;
  };
}

export interface AutocompleteQuery {
  q: string;
  country?: string;
  curriculum?: string;
  curriculumVersion?: string;
  educationLevel?: string;
  grade?: string;
  pathway?: string;
  subject?: string;
  topic?: string;
  limit?: number;
}

export interface RelatedDiscoveryQuery {
  q: string;
  country?: string;
  curriculum?: string;
  grade?: string;
  subject?: string;
}

export interface RelatedDiscoveryResult {
  query: string;
  relatedSubjects: Array<{ id: string; name: string; code: string | null }>;
  relatedTopics: Array<{ id: string; name: string; code: string | null }>;
  suggestedResources: CatalogueResourceSummary[];
}

export interface SearchProvider {
  searchResources(query: SearchQuery): Promise<PaginatedResult<SearchResultItem>>;
  getAutocompleteSuggestions(query: AutocompleteQuery): Promise<{ suggestions: AutocompleteSuggestion[]; fallbackUsed: boolean }>;
  getRelatedDiscovery(query: RelatedDiscoveryQuery): Promise<RelatedDiscoveryResult>;
}
