export interface ApiSuccessEnvelope<T> {
  data: T;
}

export interface ApiErrorDetail {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

export interface ApiErrorEnvelope {
  error: ApiErrorDetail;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code: string;
  public readonly requestId?: string;
  public readonly details?: unknown;

  constructor(params: {
    status: number;
    code: string;
    message: string;
    requestId?: string;
    details?: unknown;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.status = params.status;
    this.code = params.code;
    this.requestId = params.requestId;
    this.details = params.details;
  }
}

export interface HealthStatusDto {
  status: 'ok' | 'degraded';
  timestamp: string;
}

export interface CsrfBootstrapDto {
  csrfToken: string;
  expiresInSeconds: number;
}

export interface AuthSessionUserDto {
  id: string;
  email: string;
  displayName: string | null;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

export interface AnalyticsEventInput {
  eventCode: string;
  country?: string;
  entityType?: string;
  entityId?: string;
  anonymousSessionId?: string;
  context?: Record<string, unknown>;
}

export interface AnalyticsEventResponseDto {
  id?: string;
  deduplicated?: boolean;
  recorded?: boolean;
  [key: string]: unknown;
}

export interface CheckoutItemInput {
  offerId: string;
  quantity?: number;
}

export interface CheckoutOrderInput {
  items: CheckoutItemInput[];
}

export interface CheckoutOrderDto {
  id: string;
  status: string;
  currencyCode?: string;
  totalAmountMinor?: number;
  [key: string]: unknown;
}

export interface PlatformReadinessSnapshot {
  reachable: boolean;
  status: 'ok' | 'unavailable';
  checkedAtIso: string;
  countryCode: string;
}
