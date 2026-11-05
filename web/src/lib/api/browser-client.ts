import { publicEnv } from '@/config/public-env';
import {
  CSRF_REQUEST_HEADER_NAME,
  CSRF_RESPONSE_HEADER_NAME,
  type CsrfManager,
  getDefaultCsrfManager,
  isSessionMutatingRoute,
  isUnsafeHttpMethod,
} from './csrf-manager';
import {
  buildAnalyticsEventRequest,
  buildCommerceCheckoutRequest,
  isNonRetryableIdempotencyConflict,
} from './idempotency';
import {
  ApiClientError,
  type AnalyticsEventInput,
  type AnalyticsEventResponseDto,
  type ApiErrorEnvelope,
  type ApiSuccessEnvelope,
  type CheckoutOrderDto,
  type CheckoutOrderInput,
} from './types';

const RETRYABLE_CSRF_ERROR_CODES = new Set<string>([
  'CSRF_TOKEN_MISSING',
  'CSRF_TOKEN_INVALID',
  'CSRF_TOKEN_EXPIRED',
]);

export interface BrowserClientOptions {
  basePath?: string;
  csrfManager?: CsrfManager;
  fetchImpl?: typeof fetch;
}

export interface ApiRequestOptions {
  method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}

export class BrowserApiClient {
  private readonly basePath: string;
  private readonly csrfManager: CsrfManager;
  private readonly fetchImpl: typeof fetch;

  constructor(options: BrowserClientOptions = {}) {
    this.basePath = (options.basePath ?? publicEnv.NEXT_PUBLIC_API_BASE_PATH).replace(/\/+$/, '');
    this.csrfManager = options.csrfManager ?? getDefaultCsrfManager();
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
  }

  public async request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
    const method = (options.method ?? 'GET').toUpperCase() as NonNullable<
      ApiRequestOptions['method']
    >;
    const normalizedSubpath = path.startsWith('/') ? path : `/${path}`;
    const fullUrl = normalizedSubpath.startsWith(`${this.basePath}/`) || normalizedSubpath === this.basePath
      ? normalizedSubpath
      : `${this.basePath}${normalizedSubpath}`;

    const isUnsafe = isUnsafeHttpMethod(method);
    const mutatesSession = isUnsafe && isSessionMutatingRoute(method, fullUrl);

    if (mutatesSession) {
      return this.csrfManager.runThroughTransitionBarrier(() =>
        this.executeWithSingleCsrfRetry<T>(fullUrl, method, options, true),
      );
    }

    if (isUnsafe) {
      await this.csrfManager.awaitIdleBarrier();
    }

    return this.executeWithSingleCsrfRetry<T>(fullUrl, method, options, false);
  }

  public async ingestAnalyticsEvent(
    input: AnalyticsEventInput,
    explicitIdempotencyKey?: string,
  ): Promise<AnalyticsEventResponseDto> {
    const prepared = buildAnalyticsEventRequest(input, explicitIdempotencyKey);
    return this.request<AnalyticsEventResponseDto>(prepared.path, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
    });
  }

  public async createCheckoutOrder(
    input: CheckoutOrderInput,
    explicitIdempotencyKey?: string,
  ): Promise<CheckoutOrderDto> {
    const prepared = buildCommerceCheckoutRequest(input, explicitIdempotencyKey);
    return this.request<CheckoutOrderDto>(prepared.path, {
      method: prepared.method,
      headers: prepared.headers,
      body: prepared.body,
    });
  }

  private async executeWithSingleCsrfRetry<T>(
    fullUrl: string,
    method: NonNullable<ApiRequestOptions['method']>,
    options: ApiRequestOptions,
    mutatesSession: boolean,
  ): Promise<T> {
    const isUnsafe = isUnsafeHttpMethod(method);

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(options.headers ?? {}),
      };

      const hasJsonBody = options.body !== undefined;
      if (hasJsonBody) {
        headers['Content-Type'] = 'application/json';
      }

      if (isUnsafe) {
        const csrfToken = await this.csrfManager.ensureValidToken(attempt > 0, {
          insideBarrier: mutatesSession,
        });
        headers[CSRF_REQUEST_HEADER_NAME] = csrfToken;
      }

      const response = await this.fetchImpl(fullUrl, {
        method,
        credentials: 'include',
        headers,
        body: hasJsonBody ? JSON.stringify(options.body) : undefined,
        signal: options.signal,
      });

      const rotatedHeader = response.headers.get(CSRF_RESPONSE_HEADER_NAME);
      if (rotatedHeader) {
        this.csrfManager.applyRotatedHeaderToken(rotatedHeader, mutatesSession);
      } else if (mutatesSession && response.ok) {
        // Session cookie rotated even if custom proxy stripped header: invalidate & notify sibling tabs
        this.csrfManager.invalidateToken(true);
      }

      const parsedJson = await this.safeParseJson(response);

      if (response.ok) {
        if (parsedJson && typeof parsedJson === 'object' && 'data' in parsedJson) {
          return (parsedJson as ApiSuccessEnvelope<T>).data;
        }
        return parsedJson as T;
      }

      const errorDetail = (parsedJson as ApiErrorEnvelope | null)?.error;
      const errorCode = errorDetail?.code ?? `HTTP_${response.status}`;
      const errorMessage =
        errorDetail?.message ?? `Request failed with status ${response.status}`;

      // AC-05: Never auto-retry 409 or IDEMPOTENCY_ALREADY_CLAIMED
      if (isNonRetryableIdempotencyConflict(response.status, errorCode)) {
        throw new ApiClientError({
          status: response.status,
          code: errorCode,
          message: errorMessage,
          requestId: errorDetail?.requestId,
          details: errorDetail?.details,
        });
      }

      // Single refresh-and-retry on recoverable CSRF token mismatch/expiry
      if (
        attempt === 0 &&
        isUnsafe &&
        response.status === 403 &&
        RETRYABLE_CSRF_ERROR_CODES.has(errorCode)
      ) {
        continue;
      }

      throw new ApiClientError({
        status: response.status,
        code: errorCode,
        message: errorMessage,
        requestId: errorDetail?.requestId,
        details: errorDetail?.details,
      });
    }

    throw new ApiClientError({
      status: 403,
      code: 'CSRF_RETRY_EXHAUSTED',
      message: 'Unable to validate CSRF token after refresh retry.',
    });
  }

  private async safeParseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return null;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  }
}

export const browserApiClient = new BrowserApiClient();
