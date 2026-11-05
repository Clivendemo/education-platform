import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import { z } from 'zod';

const webRootDir = path.dirname(fileURLToPath(import.meta.url));

const InternalOriginSchema = z
  .string()
  .trim()
  .url('FASTIFY_INTERNAL_URL must be a valid HTTP or HTTPS URL')
  .refine((val) => {
    const parsed = new URL(val);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  }, 'FASTIFY_INTERNAL_URL must use http: or https: protocol')
  .transform((val) => val.replace(/\/+$/, ''));

export function resolveFastifyInternalOrigin(
  envMap: NodeJS.ProcessEnv = process.env,
): string {
  const raw = envMap.FASTIFY_INTERNAL_URL;
  if (!raw || raw.trim() === '') {
    if (envMap.NODE_ENV === 'production' && envMap.ALLOW_DEFAULT_FASTIFY_INTERNAL_URL !== 'true') {
      return InternalOriginSchema.parse('http://127.0.0.1:3000');
    }
    return 'http://127.0.0.1:3000';
  }
  return InternalOriginSchema.parse(raw);
}

const fastifyOrigin = resolveFastifyInternalOrigin(process.env);

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  outputFileTracingRoot: webRootDir,
  turbopack: {
    root: webRootDir,
  },
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    formats: ['image/avif', 'image/webp'],
    qualities: [75],
    minimumCacheTTL: 14400,
    deviceSizes: [640, 750, 828, 1080, 1200, 1440],
    imageSizes: [32, 48, 64, 96, 128, 256, 384],
    remotePatterns: [],
    dangerouslyAllowLocalIP: false,
    maximumRedirects: 0,
    dangerouslyAllowSVG: false,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
  },
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${fastifyOrigin}/api/v1/:path*`,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
