import pg from 'pg';
import { env } from '../../config/env.js';
import type { ResourceDetailSurface } from './recommendation-scoring.service.js';

export const DEFAULT_CACHE_MAX_ENTRIES = 1000;
export const DEFAULT_CACHE_TTL_MS = 300_000; // 300 seconds
export const RECOMMENDATION_NOTIFY_CHANNEL = 'rec_invalid';

export interface CachedRecommendationTuple<TCard = unknown> {
  resourceId: string;
  isPinned: boolean;
  ruleScopeRank: 1 | 2 | null;
  priority: number | null;
  algorithmicScore: number;
  card?: TCard;
}

export interface CacheEntryMetadata {
  countryId: string;
  sourceResourceId?: string | null;
  sourceTopicIds?: string[];
  candidateIds: string[];
  candidateTopicIds?: string[];
}

interface InternalCacheEntry {
  key: string;
  tuples: CachedRecommendationTuple[];
  countryId: string;
  sourceResourceId: string | null;
  topicIds: Set<string>;
  candidateIds: Set<string>;
  expiresAt: number;
}

export interface InvalidationNotificationPayload {
  scope?: string;
  op?: string;
  country_id?: string | null;
  source_resource_id?: string | null;
  source_topic_id?: string | null;
  related_topic_id?: string | null;
  target_resource_id?: string | null;
}

export interface RecommendationCacheOptions {
  maxEntries?: number;
  ttlMs?: number;
  nowFn?: () => number;
  connectionString?: string;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
}

export type ListenerState = 'IDLE' | 'CONNECTED' | 'DISCONNECTED' | 'STOPPED';

export function resolveDirectListenConnectionString(rawConnStr?: string): string | undefined {
  if (!rawConnStr) return undefined;
  try {
    const parsed = new URL(rawConnStr);
    if (parsed.hostname.endsWith('.neon.tech') && parsed.hostname.includes('-pooler.')) {
      parsed.hostname = parsed.hostname.replace('-pooler.', '.');
      return parsed.toString();
    }
    return rawConnStr;
  } catch {
    return rawConnStr;
  }
}

export class RecommendationCacheService {
  private readonly maxEntries: number;
  private readonly ttlMs: number;
  private readonly nowFn: () => number;
  private readonly connectionString: string | undefined;
  private readonly reconnectBaseMs: number;
  private readonly reconnectMaxMs: number;

  private readonly store = new Map<string, InternalCacheEntry>();
  private readonly keysBySourceResource = new Map<string, Set<string>>();
  private readonly keysByCandidateResource = new Map<string, Set<string>>();
  private readonly keysByTopic = new Map<string, Set<string>>();
  private readonly keysByCountry = new Map<string, Set<string>>();

  private listenerClient: pg.Client | null = null;
  private listenerState: ListenerState = 'IDLE';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private listenerDesired = false;

  constructor(options: RecommendationCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_CACHE_MAX_ENTRIES;
    this.ttlMs = options.ttlMs ?? DEFAULT_CACHE_TTL_MS;
    this.nowFn = options.nowFn ?? (() => Date.now());
    this.connectionString = resolveDirectListenConnectionString(
      options.connectionString ?? process.env.DATABASE_DIRECT_URL ?? env.DATABASE_URL,
    );
    this.reconnectBaseMs = options.reconnectBaseMs ?? 500;
    this.reconnectMaxMs = options.reconnectMaxMs ?? 10_000;
  }

  static buildResourceKey(
    countryId: string,
    surface: ResourceDetailSurface,
    sourceResourceId: string,
    limit: number,
  ): string {
    return `rec:res:${countryId}:${surface}:${sourceResourceId}:${limit}`;
  }

  static buildColdStartKey(countryId: string, limit: number): string {
    return `rec:cold:${countryId}:${limit}`;
  }

  getListenerState(): ListenerState {
    return this.listenerState;
  }

  size(): number {
    return this.store.size;
  }

  /**
   * Returns cached tuples if present, unexpired, and listener is not in degraded DISCONNECTED state.
   */
  get(key: string): CachedRecommendationTuple[] | null {
    if (this.listenerState === 'DISCONNECTED') {
      return null;
    }

    const entry = this.store.get(key);
    if (!entry) {
      return null;
    }

    const now = this.nowFn();
    if (now >= entry.expiresAt) {
      this.deleteKey(key);
      return null;
    }

    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);

    return entry.tuples.map((t) => ({ ...t }));
  }

  /**
   * Stores ranked tuples and updates reverse lookup sets atomically.
   * Bypassed while listener is in degraded DISCONNECTED state so stale rules cannot be cached.
   */
  set(key: string, tuples: CachedRecommendationTuple[], meta: CacheEntryMetadata): void {
    if (this.listenerState === 'DISCONNECTED') {
      return;
    }

    if (this.store.has(key)) {
      this.deleteKey(key);
    }

    while (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey === undefined) break;
      this.deleteKey(oldestKey);
    }

    const topicIds = new Set<string>();
    for (const tid of meta.sourceTopicIds ?? []) {
      if (tid) topicIds.add(tid);
    }
    for (const tid of meta.candidateTopicIds ?? []) {
      if (tid) topicIds.add(tid);
    }

    const candidateIds = new Set<string>();
    for (const cid of meta.candidateIds) {
      if (cid) candidateIds.add(cid);
    }
    for (const tuple of tuples) {
      if (tuple.resourceId) candidateIds.add(tuple.resourceId);
    }

    const entry: InternalCacheEntry = {
      key,
      tuples: tuples.map((t) => ({ ...t })),
      countryId: meta.countryId,
      sourceResourceId: meta.sourceResourceId ?? null,
      topicIds,
      candidateIds,
      expiresAt: this.nowFn() + this.ttlMs,
    };

    this.store.set(key, entry);

    this.addReverseIndex(this.keysByCountry, entry.countryId, key);
    if (entry.sourceResourceId) {
      this.addReverseIndex(this.keysBySourceResource, entry.sourceResourceId, key);
    }
    for (const candidateId of candidateIds) {
      this.addReverseIndex(this.keysByCandidateResource, candidateId, key);
    }
    for (const topicId of topicIds) {
      this.addReverseIndex(this.keysByTopic, topicId, key);
    }
  }

  deleteKey(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;

    this.store.delete(key);

    this.removeReverseIndex(this.keysByCountry, entry.countryId, key);
    if (entry.sourceResourceId) {
      this.removeReverseIndex(this.keysBySourceResource, entry.sourceResourceId, key);
    }
    for (const candidateId of entry.candidateIds) {
      this.removeReverseIndex(this.keysByCandidateResource, candidateId, key);
    }
    for (const topicId of entry.topicIds) {
      this.removeReverseIndex(this.keysByTopic, topicId, key);
    }
    return true;
  }

  clearAll(): void {
    this.store.clear();
    this.keysBySourceResource.clear();
    this.keysByCandidateResource.clear();
    this.keysByTopic.clear();
    this.keysByCountry.clear();
  }

  /**
   * Deterministic invalidation handler matching Section 6.2 of the Prompt 30 specification.
   */
  handleInvalidationPayload(rawPayload: string): void {
    if (!rawPayload) {
      this.clearAll();
      return;
    }

    let parsed: InvalidationNotificationPayload;
    try {
      parsed = JSON.parse(rawPayload) as InvalidationNotificationPayload;
    } catch {
      this.clearAll();
      return;
    }

    if (!parsed || typeof parsed !== 'object' || !parsed.scope) {
      this.clearAll();
      return;
    }

    this.handleInvalidationEvent(parsed);
  }

  handleInvalidationEvent(payload: InvalidationNotificationPayload): void {
    const scope = payload.scope;

    if (!scope || scope === 'global_type') {
      this.clearAll();
      return;
    }

    if (scope === 'country') {
      if (payload.country_id) {
        this.evictSet(this.keysByCountry.get(payload.country_id));
      } else {
        this.clearAll();
      }
      return;
    }

    if (
      scope === 'topic' ||
      scope === 'resource' ||
      scope === 'version' ||
      scope === 'verification' ||
      scope === 'file'
    ) {
      if (payload.source_resource_id) {
        this.evictSet(this.keysBySourceResource.get(payload.source_resource_id));
      }
      if (payload.target_resource_id) {
        this.evictSet(this.keysByCandidateResource.get(payload.target_resource_id));
      }
      if (payload.source_topic_id) {
        this.evictSet(this.keysByTopic.get(payload.source_topic_id));
      }
      if (payload.related_topic_id) {
        this.evictSet(this.keysByTopic.get(payload.related_topic_id));
      }
      if (payload.country_id) {
        this.evictSet(this.keysByCountry.get(payload.country_id));
      }
      return;
    }

    if (scope === 'rule') {
      if (payload.source_resource_id) {
        this.evictSet(this.keysBySourceResource.get(payload.source_resource_id));
      }
      if (payload.source_topic_id) {
        this.evictSet(this.keysByTopic.get(payload.source_topic_id));
        if (payload.country_id) {
          this.evictSet(this.keysByCountry.get(payload.country_id));
        }
      }
      if (payload.target_resource_id) {
        this.evictSet(this.keysByCandidateResource.get(payload.target_resource_id));
      }
      if (payload.country_id) {
        this.evictColdKeysForCountry(payload.country_id);
      }
      return;
    }

    this.clearAll();
  }

  /**
   * Starts a dedicated PostgreSQL LISTEN client outside the query pool for cross-instance invalidation.
   */
  async startListener(): Promise<void> {
    if (!this.connectionString) {
      return;
    }
    this.listenerDesired = true;
    if (this.listenerState === 'CONNECTED' && this.listenerClient) {
      return;
    }
    await this.connectListenerInternal();
  }

  /**
   * Stops the dedicated PostgreSQL LISTEN client cleanly.
   */
  async stopListener(): Promise<void> {
    this.listenerDesired = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const client = this.listenerClient;
    this.listenerClient = null;
    this.listenerState = 'STOPPED';
    if (client) {
      client.removeAllListeners();
      try {
        await client.end();
      } catch {
        // Ignore socket shutdown errors
      }
    }
  }

  /**
   * Test hook to deterministically simulate an unexpected listener connection drop
   * and trigger degraded-mode purge + exponential backoff reconnection.
   */
  async simulateDisconnect(): Promise<void> {
    const client = this.listenerClient;
    this.listenerClient = null;
    if (client) {
      client.removeAllListeners();
      try {
        await client.end();
      } catch {
        // Ignore close errors
      }
    }
    this.onListenerDisconnected();
  }

  private async connectListenerInternal(): Promise<void> {
    if (!this.listenerDesired || !this.connectionString) {
      return;
    }

    const client = new pg.Client({
      connectionString: this.connectionString,
      keepAlive: true,
      connectionTimeoutMillis: 15000,
    });

    client.on('notification', (msg) => {
      if (msg.channel === RECOMMENDATION_NOTIFY_CHANNEL) {
        this.handleInvalidationPayload(msg.payload ?? '');
      }
    });

    const handleDisconnect = () => {
      if (this.listenerClient === client) {
        this.listenerClient = null;
        this.onListenerDisconnected();
      }
    };

    client.on('error', handleDisconnect);
    client.on('end', handleDisconnect);

    try {
      await client.connect();
      await client.query(`LISTEN ${RECOMMENDATION_NOTIFY_CHANNEL}`);
      // Purge any entries that could have changed before subscription completed
      this.clearAll();
      this.listenerClient = client;
      this.listenerState = 'CONNECTED';
      this.reconnectAttempts = 0;
    } catch {
      client.removeAllListeners();
      try {
        await client.end();
      } catch {
        // Ignore cleanup errors
      }
      this.onListenerDisconnected();
    }
  }

  private onListenerDisconnected(): void {
    this.clearAll();
    if (!this.listenerDesired) {
      this.listenerState = 'STOPPED';
      return;
    }

    this.listenerState = 'DISCONNECTED';
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    const expDelay = Math.min(
      this.reconnectMaxMs,
      this.reconnectBaseMs * Math.pow(2, this.reconnectAttempts),
    );
    this.reconnectAttempts += 1;
    const jitterFactor = 0.8 + Math.random() * 0.4; // +/- 20% jitter
    const delayMs = Math.max(10, Math.round(expDelay * jitterFactor));

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connectListenerInternal();
    }, delayMs);
    if (typeof this.reconnectTimer.unref === 'function') {
      this.reconnectTimer.unref();
    }
  }

  private evictSet(keys: Set<string> | undefined): void {
    if (!keys || keys.size === 0) return;
    for (const key of Array.from(keys)) {
      this.deleteKey(key);
    }
  }

  private evictColdKeysForCountry(countryId: string): void {
    const countryKeys = this.keysByCountry.get(countryId);
    if (!countryKeys) return;
    const prefix = `rec:cold:${countryId}:`;
    for (const key of Array.from(countryKeys)) {
      if (key.startsWith(prefix)) {
        this.deleteKey(key);
      }
    }
  }

  private addReverseIndex(map: Map<string, Set<string>>, id: string, key: string): void {
    let bucket = map.get(id);
    if (!bucket) {
      bucket = new Set<string>();
      map.set(id, bucket);
    }
    bucket.add(key);
  }

  private removeReverseIndex(map: Map<string, Set<string>>, id: string, key: string): void {
    const bucket = map.get(id);
    if (!bucket) return;
    bucket.delete(key);
    if (bucket.size === 0) {
      map.delete(id);
    }
  }
}

export const defaultRecommendationCacheService = new RecommendationCacheService();
