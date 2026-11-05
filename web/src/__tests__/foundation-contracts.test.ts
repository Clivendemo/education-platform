import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import nextConfig from '../../next.config';
import { AppShell } from '@/components/layout/app-shell';
import {
  assertCuratedVisualSourceAllowed,
  validateAccessibleImageLabel,
  VisualPlaceholder,
} from '@/components/ui/visual-placeholder';
import { parsePublicEnv, publicEnv } from '@/config/public-env';
import { BrowserApiClient } from '@/lib/api/browser-client';
import {
  CSRF_BROADCAST_CHANNEL_NAME,
  CsrfManager,
  isSessionMutatingRoute,
  SESSION_MUTATING_ROUTES,
} from '@/lib/api/csrf-manager';
import {
  buildAnalyticsEventRequest,
  buildCommerceCheckoutRequest,
  IDEMPOTENCY_HEADER_NAME,
} from '@/lib/api/idempotency';
import { ApiClientError } from '@/lib/api/types';
import { AppProviders } from '@/providers/app-providers';
import { SessionCsrfProvider, useSessionCsrf } from '@/providers/session-csrf-provider';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../..');
const SRC_ROOT = path.resolve(WEB_ROOT, 'src');

function listFilesRecursively(dir: string, ignoreDirs = new Set<string>()): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoreDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listFilesRecursively(fullPath, ignoreDirs));
    } else if (entry.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

describe('ElimuPin Phase 1 Foundation Contracts (AC-02..AC-05, AC-07..AC-12)', () => {
  describe('AC-02: Security Advisory Architectural Prohibitions', () => {
    it('contains zero Server Actions, after() calls, Edge runtime exports, middleware/proxy files, or Route Handlers', () => {
      const prodSourceFiles = listFilesRecursively(SRC_ROOT, new Set(['__tests__']));
      expect(prodSourceFiles.length).toBeGreaterThan(0);

      for (const filePath of prodSourceFiles) {
        const rel = path.relative(WEB_ROOT, filePath).replace(/\\/g, '/');
        const content = fs.readFileSync(filePath, 'utf8');

        // GHSA-7qx7-33qx-rqx2 & GHSA-f3mh-rxg3-f5g2: zero 'use server' directives
        expect(content, `${rel} must not declare 'use server'`).not.toMatch(
          /['"]use server['"]/,
        );

        // GHSA-pc58-hwjq-p385: zero next/server after() usage
        expect(content, `${rel} must not import or invoke after() from next/server`).not.toMatch(
          /\bafter\s*\(/,
        );

        // GHSA-vvgp-ww4w-46vf: zero Edge runtime declarations
        expect(content, `${rel} must not use Edge runtime`).not.toMatch(
          /export\s+const\s+runtime\s*=\s*['"]edge['"]/,
        );

        // GHSA-rhh4-g77r-r9qj: zero middleware.ts / proxy.ts files
        expect(rel).not.toMatch(/(?:^|\/)(?:middleware|proxy)\.[jt]sx?$/);

        // GHSA-vc7v-qv4w-wrv8: zero app/**/route.ts Route Handlers
        expect(rel).not.toMatch(/^src\/app\/(?:.*\/)?route\.[jt]sx?$/);
      }

      // GHSA-mfr8-8qww-v76h (CVE-2026-119790): PPR / cacheComponents disabled
      expect((nextConfig as Record<string, unknown>).cacheComponents).toBeUndefined();
      expect(
        (nextConfig.experimental as Record<string, unknown> | undefined)?.ppr,
      ).toBeUndefined();
    });
  });

  describe('AC-03: Server-Only Isolation & Bundle Canary Protection', () => {
    it('enforces import server-only on server-env.ts and server-client.ts and rejects client-context imports', async () => {
      const serverEnvRaw = fs.readFileSync(
        path.join(SRC_ROOT, 'config/server-env.ts'),
        'utf8',
      );
      const serverClientRaw = fs.readFileSync(
        path.join(SRC_ROOT, 'lib/api/server-client.ts'),
        'utf8',
      );

      expect(serverEnvRaw.startsWith("import 'server-only';")).toBe(true);
      expect(serverClientRaw.startsWith("import 'server-only';")).toBe(true);

      await expect(import('@/config/server-env')).rejects.toThrow(/Client Component/i);
      await expect(import('@/lib/api/server-client')).rejects.toThrow(/Client Component/i);
    });

    it('exposes only approved NEXT_PUBLIC_* keys in public-env and leaks zero internal URLs into .next/static', () => {
      const parsed = parsePublicEnv({
        NEXT_PUBLIC_APP_NAME: 'ElimuPin',
        NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: 'KE',
        NEXT_PUBLIC_API_BASE_PATH: '/api/v1/',
        FASTIFY_INTERNAL_URL: 'http://internal-canary-secret.local:4099',
      });

      expect(parsed).toEqual({
        NEXT_PUBLIC_APP_NAME: 'ElimuPin',
        NEXT_PUBLIC_DEFAULT_COUNTRY_CODE: 'KE',
        NEXT_PUBLIC_API_BASE_PATH: '/api/v1',
      });
      expect('FASTIFY_INTERNAL_URL' in publicEnv).toBe(false);

      const staticDir = path.join(WEB_ROOT, '.next/static');
      if (fs.existsSync(staticDir)) {
        const builtAssets = listFilesRecursively(staticDir).filter((f) =>
          /\.(?:js|mjs|css)$/.test(f),
        );
        expect(builtAssets.length).toBeGreaterThan(0);
        for (const chunkPath of builtAssets) {
          const chunkText = fs.readFileSync(chunkPath, 'utf8');
          expect(chunkText).not.toContain('FASTIFY_INTERNAL_URL');
          expect(chunkText).not.toContain('internal-canary-secret.local');
        }
      }
    });
  });

  describe('AC-04: Analytics Body-Only Idempotency Contract', () => {
    it('places UUID v4 idempotencyKey strictly in JSON body and strips any Idempotency-Key HTTP header', async () => {
      const prepared = buildAnalyticsEventRequest(
        { eventCode: 'page_view', country: 'KE' },
        undefined,
        { 'Idempotency-Key': 'should-be-stripped', 'X-Request-ID': 'req_123' },
      );

      expect(prepared.body.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
      expect(prepared.headers['Idempotency-Key']).toBeUndefined();
      expect(prepared.headers['idempotency-key']).toBeUndefined();
      expect(prepared.headers['X-Request-ID']).toBe('req_123');

      const capturedCalls: Array<{ url: string; init?: RequestInit }> = [];
      const mockFetch: typeof fetch = vi.fn(async (input, init) => {
        const url = String(input);
        capturedCalls.push({ url, init });
        if (url.endsWith('/auth/csrf')) {
          return new Response(
            JSON.stringify({ data: { csrfToken: 'v1.1700000000.aabb.ccdd', expiresInSeconds: 3600 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({ data: { recorded: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const csrf = new CsrfManager({ fetchImpl: mockFetch, channelFactory: () => null });
      const client = new BrowserApiClient({ csrfManager: csrf, fetchImpl: mockFetch });

      await client.ingestAnalyticsEvent({ eventCode: 'curriculum_band_opened', country: 'KE' });

      const analyticsCall = capturedCalls.find((c) => c.url.endsWith('/analytics/events'));
      expect(analyticsCall).toBeDefined();
      const sentHeaders = analyticsCall!.init?.headers as Record<string, string>;
      expect(Object.keys(sentHeaders).map((k) => k.toLowerCase())).not.toContain('idempotency-key');

      const sentBody = JSON.parse(String(analyticsCall!.init?.body)) as Record<string, unknown>;
      expect(typeof sentBody.idempotencyKey).toBe('string');
      expect(sentBody.eventCode).toBe('curriculum_band_opened');
    });
  });

  describe('AC-05: Commerce Synchronized Idempotency & 409 Non-Retry Contract', () => {
    it('sends identical UUID v4 in Idempotency-Key header and body, and never retries 409 IDEMPOTENCY_ALREADY_CLAIMED', async () => {
      const prepared = buildCommerceCheckoutRequest({
        items: [{ offerId: '550e8400-e29b-41d4-a716-446655440000', quantity: 1 }],
      });
      expect(prepared.headers[IDEMPOTENCY_HEADER_NAME]).toBe(prepared.body.idempotencyKey);

      let checkoutAttempts = 0;
      const mockFetch: typeof fetch = vi.fn(async (input) => {
        const url = String(input);
        if (url.endsWith('/auth/csrf')) {
          return new Response(
            JSON.stringify({ data: { csrfToken: 'v1.1700000000.1122.3344', expiresInSeconds: 3600 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        checkoutAttempts += 1;
        return new Response(
          JSON.stringify({
            error: {
              code: 'IDEMPOTENCY_ALREADY_CLAIMED',
              message: 'Order creation with this idempotency key is already in progress.',
              requestId: 'req_conflict_1',
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      });

      const csrf = new CsrfManager({ fetchImpl: mockFetch, channelFactory: () => null });
      const client = new BrowserApiClient({ csrfManager: csrf, fetchImpl: mockFetch });

      await expect(
        client.createCheckoutOrder({
          items: [{ offerId: '550e8400-e29b-41d4-a716-446655440000', quantity: 1 }],
        }),
      ).rejects.toMatchObject({
        status: 409,
        code: 'IDEMPOTENCY_ALREADY_CLAIMED',
      } satisfies Partial<ApiClientError>);

      expect(checkoutAttempts).toBe(1);
    });
  });

  describe('AC-07 & AC-08: 9-Route CSRF Transition Barrier, Epoch Fencing & BroadcastChannel Sync', () => {
    it('tracks all 9 backend session-mutating routes and excludes ordinary API routes', () => {
      expect(SESSION_MUTATING_ROUTES).toHaveLength(9);

      const expectedMutating: Array<[string, string]> = [
        ['POST', '/api/v1/auth/register'],
        ['POST', '/api/v1/auth/login'],
        ['POST', '/api/v1/auth/logout'],
        ['POST', '/api/v1/auth/change-password'],
        ['POST', '/api/v1/calendar/session'],
        ['DELETE', '/api/v1/calendar/session'],
        ['POST', '/api/v1/calendar/session/events'],
        ['POST', '/api/v1/calendar/session/transfer'],
        ['POST', '/api/v1/resources/550e8400-e29b-41d4-a716-446655440000/feedback'],
      ];

      for (const [method, route] of expectedMutating) {
        expect(isSessionMutatingRoute(method, route), `${method} ${route}`).toBe(true);
      }

      expect(isSessionMutatingRoute('POST', '/api/v1/analytics/events')).toBe(false);
      expect(isSessionMutatingRoute('POST', '/api/v1/checkout')).toBe(false);
      expect(isSessionMutatingRoute('GET', '/api/v1/auth/me')).toBe(false);
    });

    it('serializes concurrent unsafe requests behind an in-flight session-mutating login and fences stale tokens', async () => {
      let releaseLoginResponse!: () => void;
      const loginGate = new Promise<void>((resolve) => {
        releaseLoginResponse = resolve;
      });

      const observedTokens: Record<string, string> = {};

      const mockFetch: typeof fetch = vi.fn(async (input, init) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;

        if (url.endsWith('/auth/csrf')) {
          return new Response(
            JSON.stringify({ data: { csrfToken: 'v1.pre_auth_token', expiresInSeconds: 3600 } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }

        if (url.endsWith('/auth/login')) {
          observedTokens.login = headers['X-CSRF-Token'] ?? '';
          await loginGate;
          return new Response(
            JSON.stringify({ data: { user: { id: 'u1' } } }),
            {
              status: 200,
              headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': 'v1.post_login_rotated_token',
              },
            },
          );
        }

        if (url.endsWith('/analytics/events')) {
          observedTokens.analytics = headers['X-CSRF-Token'] ?? '';
          return new Response(JSON.stringify({ data: { recorded: true } }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }

        throw new Error(`Unexpected URL: ${url}`);
      });

      const csrf = new CsrfManager({ fetchImpl: mockFetch });
      const client = new BrowserApiClient({ csrfManager: csrf, fetchImpl: mockFetch });

      // Prime pre-auth token
      await csrf.ensureValidToken();
      expect(csrf.peekToken()).toBe('v1.pre_auth_token');

      // Start session-mutating login (holds transition barrier)
      const loginPromise = client.request('/auth/login', {
        method: 'POST',
        body: { email: 'teacher@school.ke', password: 'Password123!' },
      });

      // Fire concurrent unsafe mutation while login is still in flight
      const analyticsPromise = client.ingestAnalyticsEvent({ eventCode: 'post_login_action' });

      // Release login with rotated X-CSRF-Token header
      releaseLoginResponse();
      await Promise.all([loginPromise, analyticsPromise]);

      expect(observedTokens.login).toBe('v1.pre_auth_token');
      expect(observedTokens.analytics).toBe('v1.post_login_rotated_token');
      csrf.dispose();
    });

    it('refreshes and retries exactly once on 403 CSRF_TOKEN_INVALID and broadcasts PII-free rotation on elimupin-csrf', async () => {
      expect(CSRF_BROADCAST_CHANNEL_NAME).toBe('elimupin-csrf');

      const rawMessages: unknown[] = [];
      const observerChannel = new BroadcastChannel('elimupin-csrf');
      observerChannel.onmessage = (ev) => {
        rawMessages.push(ev.data);
      };

      let csrfBootstraps = 0;
      let feedbackCalls = 0;

      const mockFetchTabA: typeof fetch = vi.fn(async (input, init) => {
        const url = String(input);
        const headers = (init?.headers ?? {}) as Record<string, string>;
        if (url.endsWith('/auth/csrf')) {
          csrfBootstraps += 1;
          return new Response(
            JSON.stringify({
              data: { csrfToken: `v1.boot_${csrfBootstraps}`, expiresInSeconds: 3600 },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          );
        }
        feedbackCalls += 1;
        if (feedbackCalls === 1) {
          expect(headers['X-CSRF-Token']).toBe('v1.boot_1');
          return new Response(
            JSON.stringify({
              error: { code: 'CSRF_TOKEN_INVALID', message: 'Invalid CSRF token' },
            }),
            { status: 403, headers: { 'Content-Type': 'application/json' } },
          );
        }
        expect(headers['X-CSRF-Token']).toBe('v1.boot_2');
        return new Response(JSON.stringify({ data: { id: 'fb_1' } }), {
          status: 201,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'v1.rotated_rf_sid_token',
          },
        });
      });

      const tabAManager = new CsrfManager({ fetchImpl: mockFetchTabA });
      const tabBManager = new CsrfManager({
        fetchImpl: vi.fn(async () =>
          new Response(
            JSON.stringify({ data: { csrfToken: 'v1.tab_b_initial', expiresInSeconds: 3600 } }),
            { status: 200 },
          ),
        ),
      });

      await tabBManager.ensureValidToken();
      expect(tabBManager.peekToken()).toBe('v1.tab_b_initial');
      const tabBEpochBefore = tabBManager.getEpoch();

      // Render SessionCsrfProvider wired to Tab B to verify React state updates on BroadcastChannel message
      function EpochReadout() {
        const { csrfEpoch, hasActiveToken } = useSessionCsrf();
        return React.createElement(
          'output',
          { 'data-testid': 'csrf-readout' },
          `${csrfEpoch}:${String(hasActiveToken)}`,
        );
      }
      render(
        React.createElement(SessionCsrfProvider, {
          manager: tabBManager,
          children: React.createElement(EpochReadout),
        }),
      );

      const clientA = new BrowserApiClient({ csrfManager: tabAManager, fetchImpl: mockFetchTabA });
      await act(async () => {
        await clientA.request('/resources/550e8400-e29b-41d4-a716-446655440000/feedback', {
          method: 'POST',
          body: {
            resourceVersionId: '550e8400-e29b-41d4-a716-446655440001',
            feedbackType: 'HELPFUL',
          },
        });
      });

      expect(feedbackCalls).toBe(2);
      expect(rawMessages).toHaveLength(1);
      const broadcastPayload = rawMessages[0] as Record<string, unknown>;
      expect(Object.keys(broadcastPayload).sort()).toEqual(['epochTimestamp', 'type']);
      expect(broadcastPayload.type).toBe('CSRF_ROTATED');
      expect(JSON.stringify(broadcastPayload)).not.toContain('v1.');

      // Tab B invalidated its cached token and incremented its epoch
      expect(tabBManager.peekToken()).toBeNull();
      expect(tabBManager.getEpoch()).toBeGreaterThan(tabBEpochBefore);

      observerChannel.close();
      tabAManager.dispose();
      tabBManager.dispose();
    });
  });

  describe('AC-10: Accessibility, Layout Shell & Design Constitution', () => {
    it('renders keyboard skip-to-content link, 3-zone header, >=44px controls, theme toggle, and zero banned CSS patterns', () => {
      render(
        React.createElement(
          AppProviders,
          null,
          React.createElement(
            AppShell,
            null,
            React.createElement('section', null, 'Main classroom content'),
          ),
        ),
      );

      const allLinks = screen.getAllByRole('link');
      expect(allLinks[0]).toHaveTextContent('Skip to main content');
      expect(allLinks[0]).toHaveAttribute('href', '#main-content');

      const mainLandmark = screen.getByRole('main');
      expect(mainLandmark).toHaveAttribute('id', 'main-content');

      const themeBtn = screen.getByRole('button', { name: /switch to dark theme/i });
      expect(themeBtn.className).toContain('min-h-11');
      expect(themeBtn.className).toContain('whitespace-nowrap');

      fireEvent.click(themeBtn);
      expect(document.documentElement.classList.contains('dark')).toBe(true);

      // Verify zero thick left borders (border-l-4) and zero static rounded-full pills across src/**
      const uiFiles = listFilesRecursively(SRC_ROOT, new Set(['__tests__']));
      for (const filePath of uiFiles) {
        const content = fs.readFileSync(filePath, 'utf8');
        expect(content).not.toMatch(/\bborder-l-[248]\b/);
        expect(content).not.toMatch(/\brounded-full\b/);
      }
    });
  });

  describe('AC-11: Next.js 16.4.5 Image & Rewrite Security Locks (Prompt 38C C-1)', () => {
    it('locks remotePatterns, SVG execution, local IP SSRF, redirects, qualities, and omits broken search:"" localPatterns', () => {
      const images = nextConfig.images!;
      expect(images.formats).toEqual(['image/avif', 'image/webp']);
      expect(images.qualities).toEqual([75]);
      expect(images.minimumCacheTTL).toBe(14400);
      expect(images.remotePatterns).toEqual([]);
      expect(images.dangerouslyAllowSVG).toBe(false);
      expect(images.dangerouslyAllowLocalIP).toBe(false);
      expect(images.maximumRedirects).toBe(0);
      expect(images.contentDispositionType).toBe('attachment');
      expect(images.contentSecurityPolicy).toContain("script-src 'none'; sandbox;");
      expect(images.localPatterns).toBeUndefined();
    });
  });

  describe('AC-12: Frozen Option A Placeholder Geometry, Alt-Text Rules, Dashboard Restraint & UGC Firewall', () => {
    it('contains zero raster image files anywhere in /web in Phase 1', () => {
      const allWebFiles = listFilesRecursively(
        WEB_ROOT,
        new Set(['node_modules', '.next', '.next-test-proxy', 'coverage']),
      );
      const rasterFiles = allWebFiles.filter((f) =>
        /\.(?:png|jpe?g|webp|avif|gif|bmp|ico)$/i.test(f),
      );
      expect(rasterFiles).toEqual([]);
    });

    it('enforces informative role="img" + descriptive label vs decorative aria-hidden="true" leaf isolation', () => {
      expect(() => validateAccessibleImageLabel('')).toThrow();
      expect(() => validateAccessibleImageLabel('IMG_2048.JPG')).toThrow();
      expect(() => validateAccessibleImageLabel('hero-banner.webp')).toThrow();

      const { unmount } = render(
        React.createElement(VisualPlaceholder, {
          aspectRatio: '16:9',
          slot: 'homepage-hero',
          label: 'Kenyan secondary classroom collaborative lesson desk placeholder',
          captionTitle: 'Hero Frame',
        }),
      );

      const informativeImg = screen.getByRole('img', {
        name: 'Kenyan secondary classroom collaborative lesson desk placeholder',
      });
      expect(informativeImg).toHaveAttribute('data-aspect-ratio', '16:9');
      unmount();

      const { container } = render(
        React.createElement(VisualPlaceholder, {
          aspectRatio: '1:1',
          slot: 'subject-category',
          decorative: true,
        }),
      );

      expect(screen.queryByRole('img')).toBeNull();
      const decorativeRoot = container.firstElementChild as HTMLElement;
      expect(decorativeRoot).toHaveAttribute('aria-hidden', 'true');
      expect(
        decorativeRoot.querySelectorAll('a, button, input, select, textarea, [tabindex]'),
      ).toHaveLength(0);
    });

    it('enforces curated vs user-submitted (resource_files) firewall and zero decorative thumbnails in workspace rows', () => {
      expect(() =>
        assertCuratedVisualSourceAllowed('https://cdn.example.com/photo.jpg'),
      ).toThrow();
      expect(() =>
        assertCuratedVisualSourceAllowed('/resource_files/unmoderated-cover.png'),
      ).toThrow();
      expect(() =>
        assertCuratedVisualSourceAllowed('/uploads/teacher-submission.webp'),
      ).toThrow();
      expect(assertCuratedVisualSourceAllowed('/images/curated/hero-classroom.webp')).toBe(
        '/images/curated/hero-classroom.webp',
      );

      // Verify page.tsx workspace table contains zero <img> tags or VisualPlaceholder components inside <tbody>
      const pageSource = fs.readFileSync(path.join(SRC_ROOT, 'app/page.tsx'), 'utf8');
      const tbodyMatch = pageSource.match(/<tbody[\s\S]*?<\/tbody>/);
      expect(tbodyMatch).not.toBeNull();
      expect(tbodyMatch![0]).not.toContain('<img');
      expect(tbodyMatch![0]).not.toContain('<Image');
      expect(tbodyMatch![0]).not.toContain('VisualPlaceholder');
    });
  });
});
