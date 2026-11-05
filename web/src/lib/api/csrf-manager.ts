import type { ApiSuccessEnvelope, CsrfBootstrapDto } from './types';

export const CSRF_REQUEST_HEADER_NAME = 'X-CSRF-Token';
export const CSRF_RESPONSE_HEADER_NAME = 'x-csrf-token';
export const CSRF_BROADCAST_CHANNEL_NAME = 'elimupin-csrf';

export type UnsafeHttpMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const UNSAFE_METHODS = new Set<string>(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface SessionMutatingRouteRule {
  readonly id: string;
  readonly method: UnsafeHttpMethod;
  readonly description: string;
  readonly matchesPathname: (normalizedPathname: string) => boolean;
}

/**
 * Exact 9 session-mutating Fastify routes tracked by `src/routes/middleware/csrf-guard.ts` (`onSend`):
 * - `session_token` mutations (`auth.ts` — 4 routes)
 * - `calendar_session` mutations (`calendar.ts` — 4 routes)
 * - `rf_sid` mutation (`feedback.ts` — 1 route)
 */
export const SESSION_MUTATING_ROUTES: readonly SessionMutatingRouteRule[] = Object.freeze([
  {
    id: 'auth_register',
    method: 'POST',
    description: 'POST /api/v1/auth/register (issues session_token)',
    matchesPathname: (p) => p === '/api/v1/auth/register',
  },
  {
    id: 'auth_login',
    method: 'POST',
    description: 'POST /api/v1/auth/login (rotates session_token)',
    matchesPathname: (p) => p === '/api/v1/auth/login',
  },
  {
    id: 'auth_logout',
    method: 'POST',
    description: 'POST /api/v1/auth/logout (clears session_token)',
    matchesPathname: (p) => p === '/api/v1/auth/logout',
  },
  {
    id: 'auth_change_password',
    method: 'POST',
    description: 'POST /api/v1/auth/change-password (revokes & rotates session_token)',
    matchesPathname: (p) =>
      p === '/api/v1/auth/change-password' || p === '/api/v1/auth/password/change',
  },
  {
    id: 'calendar_session_init',
    method: 'POST',
    description: 'POST /api/v1/calendar/session (issues calendar_session)',
    matchesPathname: (p) => p === '/api/v1/calendar/session',
  },
  {
    id: 'calendar_session_clear',
    method: 'DELETE',
    description: 'DELETE /api/v1/calendar/session (clears calendar_session)',
    matchesPathname: (p) => p === '/api/v1/calendar/session',
  },
  {
    id: 'calendar_session_create_event',
    method: 'POST',
    description: 'POST /api/v1/calendar/session/events (auto-creates calendar_session)',
    matchesPathname: (p) => p === '/api/v1/calendar/session/events',
  },
  {
    id: 'calendar_session_transfer',
    method: 'POST',
    description: 'POST /api/v1/calendar/session/transfer (clears calendar_session)',
    matchesPathname: (p) => p === '/api/v1/calendar/session/transfer',
  },
  {
    id: 'resource_feedback_submit',
    method: 'POST',
    description: 'POST /api/v1/resources/:id/feedback (issues rf_sid when anonymous)',
    matchesPathname: (p) => /^\/api\/v1\/resources\/[^/]+\/feedback$/.test(p),
  },
]);

export interface CsrfRotatedBroadcastMessage {
  type: 'CSRF_ROTATED';
  epochTimestamp: number;
}

export function normalizeApiPathname(rawPathOrUrl: string): string {
  const trimmed = rawPathOrUrl.trim();
  const withoutOrigin =
    trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed).pathname
      : trimmed.split('?')[0] ?? trimmed;
  const withLeadingSlash = withoutOrigin.startsWith('/') ? withoutOrigin : `/${withoutOrigin}`;
  const collapsed = withLeadingSlash.replace(/\/{2,}/g, '/');
  return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : collapsed;
}

export function isUnsafeHttpMethod(method: string): method is UnsafeHttpMethod {
  return UNSAFE_METHODS.has(method.toUpperCase());
}

export function isSessionMutatingRoute(method: string, pathOrUrl: string): boolean {
  const upper = method.toUpperCase();
  if (!isUnsafeHttpMethod(upper)) {
    return false;
  }
  const pathname = normalizeApiPathname(pathOrUrl);
  return SESSION_MUTATING_ROUTES.some(
    (rule) => rule.method === upper && rule.matchesPathname(pathname),
  );
}

export function isValidCsrfBroadcastPayload(
  payload: unknown,
): payload is CsrfRotatedBroadcastMessage {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return false;
  }
  const record = payload as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === 2 &&
    record.type === 'CSRF_ROTATED' &&
    typeof record.epochTimestamp === 'number' &&
    Number.isFinite(record.epochTimestamp)
  );
}

export interface CsrfManagerOptions {
  apiBasePath?: string;
  fetchImpl?: typeof fetch;
  channelFactory?: (name: string) => BroadcastChannel | null;
  nowMs?: () => number;
}

export type CsrfStateListener = (snapshot: {
  csrfEpoch: number;
  hasToken: boolean;
  lastRotatedAtMs: number | null;
}) => void;

export class CsrfManager {
  private readonly apiBasePath: string;
  private readonly fetchImpl: typeof fetch;
  private readonly nowMs: () => number;
  private channel: BroadcastChannel | null = null;

  private activeToken: string | null = null;
  private tokenExpiresAtMs: number | null = null;
  private csrfEpoch = 0;
  private lastRotatedAtMs: number | null = null;

  private inFlightBootstrap: Promise<string> | null = null;
  private transitionBarrierChain: Promise<void> = Promise.resolve();
  private activeTransitionCount = 0;
  private readonly listeners = new Set<CsrfStateListener>();

  constructor(options: CsrfManagerOptions = {}) {
    this.apiBasePath = (options.apiBasePath ?? '/api/v1').replace(/\/+$/, '');
    this.fetchImpl = options.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.nowMs = options.nowMs ?? (() => Date.now());

    const factory =
      options.channelFactory ??
      ((name: string) =>
        typeof globalThis.BroadcastChannel === 'function'
          ? new globalThis.BroadcastChannel(name)
          : null);

    this.channel = factory(CSRF_BROADCAST_CHANNEL_NAME);
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<unknown>) => {
        if (!isValidCsrfBroadcastPayload(event.data)) {
          return;
        }
        this.activeToken = null;
        this.tokenExpiresAtMs = null;
        this.inFlightBootstrap = null;
        this.csrfEpoch += 1;
        this.lastRotatedAtMs = event.data.epochTimestamp;
        this.notifyListeners();
      };
    }
  }

  public getEpoch(): number {
    return this.csrfEpoch;
  }

  public peekToken(): string | null {
    if (!this.activeToken) {
      return null;
    }
    if (this.tokenExpiresAtMs !== null && this.nowMs() >= this.tokenExpiresAtMs) {
      return null;
    }
    return this.activeToken;
  }

  public subscribe(listener: CsrfStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public dispose(): void {
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.listeners.clear();
  }

  public invalidateToken(broadcastRotation = false): void {
    this.activeToken = null;
    this.tokenExpiresAtMs = null;
    this.inFlightBootstrap = null;
    this.csrfEpoch += 1;
    this.lastRotatedAtMs = this.nowMs();
    if (broadcastRotation) {
      this.broadcastRotationSignal(this.lastRotatedAtMs);
    }
    this.notifyListeners();
  }

  public applyRotatedHeaderToken(
    rawHeaderValue: string | null | undefined,
    broadcastRotation: boolean,
  ): boolean {
    const trimmed = rawHeaderValue?.trim();
    if (!trimmed) {
      return false;
    }
    this.activeToken = trimmed;
    // Conservative 55-minute client freshness window unless explicitly refreshed sooner
    this.tokenExpiresAtMs = this.nowMs() + 55 * 60 * 1000;
    this.inFlightBootstrap = null;
    this.csrfEpoch += 1;
    this.lastRotatedAtMs = this.nowMs();
    if (broadcastRotation) {
      this.broadcastRotationSignal(this.lastRotatedAtMs);
    }
    this.notifyListeners();
    return true;
  }

  public async awaitIdleBarrier(): Promise<void> {
    if (this.activeTransitionCount > 0) {
      await this.transitionBarrierChain;
    }
  }

  /**
   * Serializes any of the 9 session-mutating routes behind a strict FIFO barrier so concurrent
   * mutations wait for cookie + X-CSRF-Token rotation to settle before reading the token.
   */
  public async runThroughTransitionBarrier<T>(operation: () => Promise<T>): Promise<T> {
    const predecessor = this.transitionBarrierChain;
    let releaseBarrier!: () => void;
    const currentGate = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });

    this.transitionBarrierChain = predecessor.then(() => currentGate);
    this.activeTransitionCount += 1;

    await predecessor;
    try {
      // Advance epoch entering session transition so pre-transition bootstrap promises cannot win
      this.csrfEpoch += 1;
      this.inFlightBootstrap = null;
      return await operation();
    } finally {
      this.activeTransitionCount -= 1;
      releaseBarrier();
    }
  }

  public async ensureValidToken(
    forceRefresh = false,
    options: { insideBarrier?: boolean } = {},
  ): Promise<string> {
    if (!options.insideBarrier) {
      await this.awaitIdleBarrier();
    }

    if (!forceRefresh) {
      const cached = this.peekToken();
      if (cached) {
        return cached;
      }
    } else {
      this.activeToken = null;
      this.tokenExpiresAtMs = null;
      this.inFlightBootstrap = null;
    }

    if (this.inFlightBootstrap) {
      return this.inFlightBootstrap;
    }

    const fetchPromise = this.fetchBootstrapTokenWithEpochFence(Boolean(options.insideBarrier));
    this.inFlightBootstrap = fetchPromise;
    try {
      return await fetchPromise;
    } finally {
      if (this.inFlightBootstrap === fetchPromise) {
        this.inFlightBootstrap = null;
      }
    }
  }

  private async fetchBootstrapTokenWithEpochFence(insideBarrier: boolean): Promise<string> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (!insideBarrier) {
        await this.awaitIdleBarrier();
      }
      const epochAtStart = this.csrfEpoch;

      const response = await this.fetchImpl(`${this.apiBasePath}/auth/csrf`, {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`CSRF bootstrap failed with HTTP ${response.status}`);
      }

      const body = (await response.json()) as ApiSuccessEnvelope<CsrfBootstrapDto>;
      const headerToken = response.headers.get(CSRF_RESPONSE_HEADER_NAME)?.trim();
      const candidateToken = headerToken || body?.data?.csrfToken?.trim();

      if (!candidateToken) {
        throw new Error('CSRF bootstrap response did not contain a valid token');
      }

      // Epoch fence: if a session transition or cross-tab rotation happened while /auth/csrf was in flight,
      // discard the stale pre-transition token and either return the newly rotated token or re-fetch.
      if (this.csrfEpoch !== epochAtStart) {
        const newerCached = this.peekToken();
        if (newerCached) {
          return newerCached;
        }
        continue;
      }

      const ttlSeconds =
        typeof body?.data?.expiresInSeconds === 'number' && body.data.expiresInSeconds > 30
          ? body.data.expiresInSeconds - 15
          : 3300;
      this.activeToken = candidateToken;
      this.tokenExpiresAtMs = this.nowMs() + ttlSeconds * 1000;
      this.notifyListeners();
      return candidateToken;
    }

    throw new Error('Unable to converge on a stable CSRF epoch after concurrent rotations');
  }

  private broadcastRotationSignal(epochTimestamp: number): void {
    if (!this.channel) {
      return;
    }
    const message: CsrfRotatedBroadcastMessage = {
      type: 'CSRF_ROTATED',
      epochTimestamp,
    };
    this.channel.postMessage(message);
  }

  private notifyListeners(): void {
    const snapshot = {
      csrfEpoch: this.csrfEpoch,
      hasToken: this.peekToken() !== null,
      lastRotatedAtMs: this.lastRotatedAtMs,
    };
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

let defaultCsrfManagerInstance: CsrfManager | null = null;

export function getDefaultCsrfManager(): CsrfManager {
  if (!defaultCsrfManagerInstance) {
    defaultCsrfManagerInstance = new CsrfManager();
  }
  return defaultCsrfManagerInstance;
}
