// @vitest-environment node
import { type ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '../..');
const PROXY_DIST_DIR = '.next-test-proxy';
const PROXY_DIST_ABS = path.join(WEB_ROOT, PROXY_DIST_DIR);

interface CapturedUpstreamRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  bodyText: string;
}

async function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as AddressInfo;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
    srv.on('error', reject);
  });
}

async function runNextCliBuild(envOverrides: Record<string, string>): Promise<void> {
  const nextBin = path.join(WEB_ROOT, 'node_modules/next/dist/bin/next');
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [nextBin, 'build'], {
      cwd: WEB_ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        NEXT_TELEMETRY_DISABLED: '1',
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    let stdout = '';
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`next build exited with code ${code}\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
      }
    });
  });
}

/**
 * Cross-platform process-tree teardown (Prompt 38A §3 / AC-06):
 * - Windows (`win32`): `taskkill /PID <pid> /T /F`
 * - POSIX: `process.kill(-pid, 'SIGTERM')` with timed escalation to `SIGKILL`
 * Always awaits `child` `'close'` before removing `.next-test-proxy`.
 */
async function terminateProcessTreeAndWaitClose(child: ChildProcess | null): Promise<void> {
  if (!child || child.pid === undefined) {
    return;
  }

  const closePromise =
    child.exitCode !== null || child.signalCode !== null
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          child.once('close', () => resolve());
        });

  const pid = child.pid;

  if (process.platform === 'win32') {
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
      });
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
    });
  } else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // Process already exited
      }
    }

    const gracefulTimeout = setTimeout(() => {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // Process already exited
        }
      }
    }, 3000);

    try {
      await closePromise;
    } finally {
      clearTimeout(gracefulTimeout);
    }
    return;
  }

  await closePromise;
}

describe('AC-06: Live Next.js /api/v1 Rewrite Proxy Integration & Clean Process Teardown', () => {
  const capturedRequests: CapturedUpstreamRequest[] = [];
  let upstreamServer: http.Server | null = null;
  let nextProcess: ChildProcess | null = null;
  let nextBaseUrl = '';

  beforeAll(async () => {
    await fs.rm(PROXY_DIST_ABS, { recursive: true, force: true });

    upstreamServer = http.createServer((req, res) => {
      let bodyText = '';
      req.setEncoding('utf8');
      req.on('data', (chunk) => {
        bodyText += chunk;
      });
      req.on('end', () => {
        capturedRequests.push({
          method: req.method ?? 'GET',
          url: req.url ?? '/',
          headers: req.headers,
          bodyText,
        });

        if (req.url === '/api/v1/health' && req.method === 'GET') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(
            JSON.stringify({
              data: {
                status: 'ok',
                timestamp: '2026-11-04T12:00:00.000Z',
              },
            }),
          );
          return;
        }

        if (req.url === '/api/v1/analytics/events' && req.method === 'POST') {
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-CSRF-Token': 'v1.1700000999.rotated.hmac',
          });
          res.end(JSON.stringify({ data: { recorded: true } }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not found' } }));
      });
    });

    const upstreamPort = await new Promise<number>((resolve, reject) => {
      upstreamServer!.listen(0, '127.0.0.1', () => {
        resolve((upstreamServer!.address() as AddressInfo).port);
      });
      upstreamServer!.on('error', reject);
    });

    const nextPort = await allocateFreePort();
    const fastifyInternalUrl = `http://127.0.0.1:${upstreamPort}`;

    await runNextCliBuild({
      NEXT_DIST_DIR: PROXY_DIST_DIR,
      FASTIFY_INTERNAL_URL: fastifyInternalUrl,
    });

    const nextBin = path.join(WEB_ROOT, 'node_modules/next/dist/bin/next');
    nextProcess = spawn(
      process.execPath,
      [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(nextPort)],
      {
        cwd: WEB_ROOT,
        detached: process.platform !== 'win32',
        env: {
          ...process.env,
          NODE_ENV: 'production',
          NEXT_TELEMETRY_DISABLED: '1',
          NEXT_DIST_DIR: PROXY_DIST_DIR,
          FASTIFY_INTERNAL_URL: fastifyInternalUrl,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    nextBaseUrl = `http://127.0.0.1:${nextPort}`;

    // Poll until Next.js server responds
    const deadline = Date.now() + 25_000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        const probe = await fetch(`${nextBaseUrl}/api/v1/health`);
        if (probe.ok) {
          ready = true;
          break;
        }
      } catch {
        // Server still booting
      }
      await new Promise((r) => setTimeout(r, 250));
    }

    if (!ready) {
      throw new Error('Timed out waiting for isolated next start server to become ready');
    }
  }, 120_000);

  afterAll(async () => {
    await terminateProcessTreeAndWaitClose(nextProcess);
    nextProcess = null;

    if (upstreamServer) {
      await new Promise<void>((resolve) => upstreamServer!.close(() => resolve()));
      upstreamServer = null;
    }

    await fs.rm(PROXY_DIST_ABS, { recursive: true, force: true });
  }, 60_000);

  it('applies Next.js security headers on GET / and proxies GET /api/v1/health + POST /api/v1/analytics/events to FASTIFY_INTERNAL_URL', async () => {
    // 1. Verify Next.js App Router security headers on GET /
    const pageRes = await fetch(`${nextBaseUrl}/`);
    expect(pageRes.status).toBe(200);
    expect(pageRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(pageRes.headers.get('x-frame-options')).toBe('DENY');
    expect(pageRes.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(pageRes.headers.get('x-powered-by')).toBeNull();

    // 2. Verify /api/v1/* rewrite forwarding and upstream response header pass-through
    capturedRequests.length = 0;

    const healthRes = await fetch(`${nextBaseUrl}/api/v1/health`, {
      headers: { Accept: 'application/json' },
    });
    expect(healthRes.status).toBe(200);
    expect(healthRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(healthRes.headers.get('x-powered-by')).toBeNull();

    const healthJson = (await healthRes.json()) as { data: { status: string } };
    expect(healthJson.data.status).toBe('ok');

    const postRes = await fetch(`${nextBaseUrl}/api/v1/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': 'v1.1700000000.testnonce.testhmac',
        Cookie: 'csrf_ctx=opaque_ctx_cookie',
      },
      body: JSON.stringify({
        eventCode: 'foundation_proxy_probe',
        idempotencyKey: '550e8400-e29b-41d4-a716-446655440099',
      }),
    });

    expect(postRes.status).toBe(200);
    expect(postRes.headers.get('x-csrf-token')).toBe('v1.1700000999.rotated.hmac');

    const upstreamPost = capturedRequests.find(
      (r) => r.method === 'POST' && r.url === '/api/v1/analytics/events',
    );
    expect(upstreamPost).toBeDefined();
    expect(upstreamPost!.headers['x-csrf-token']).toBe('v1.1700000000.testnonce.testhmac');
    expect(upstreamPost!.headers.cookie).toContain('csrf_ctx=opaque_ctx_cookie');
    expect(JSON.parse(upstreamPost!.bodyText)).toMatchObject({
      eventCode: 'foundation_proxy_probe',
      idempotencyKey: '550e8400-e29b-41d4-a716-446655440099',
    });
  });
});
