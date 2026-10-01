import { describe, it, expect, vi } from 'vitest';
import { buildApp } from '../../src/app.js';
import {
  type AuthService,
  type AuthResult,
  type SessionValidationResult,
  SESSION_COOKIE_NAME,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from '../../src/services/auth.service.js';
import type { User, UserSession } from '../../src/db/schemas.js';

describe('Auth API Routes (/api/v1/auth)', () => {
  const mockUser: User = {
    id: 'u0000000-0000-0000-0000-000000000001',
    email: 'teacher@example.com',
    displayName: 'Wanjiku Teacher',
    phone: null,
    status: 'ACTIVE',
    profileData: {},
    savedResourceVersionIds: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
  };

  const mockSession: UserSession = {
    id: 's0000000-0000-0000-0000-000000000001',
    userId: mockUser.id,
    tokenHash: 'mock-sha256-hash',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    expiresAt: new Date(Date.now() + 86400000),
    revokedAt: null,
    lastSeenAt: null,
    deviceMetadata: {},
  };

  const mockAuthResult: AuthResult = {
    user: mockUser,
    sessionToken: 'mock-raw-256-bit-session-token-value',
    expiresAt: new Date(Date.now() + 86400000),
  };

  const createMockAuthService = (
    overrides: Partial<AuthService> = {},
  ): AuthService => ({
    register: vi.fn().mockResolvedValue(mockAuthResult),
    login: vi.fn().mockResolvedValue(mockAuthResult),
    logout: vi.fn().mockResolvedValue(undefined),
    validateSession: vi.fn().mockImplementation(async (token: string) => {
      if (token === 'valid-token') {
        return { user: mockUser, session: mockSession } as SessionValidationResult;
      }
      return null;
    }),
    ...overrides,
  });

  describe('POST /api/v1/auth/register', () => {
    it('returns 201 Created with user info and sets HttpOnly cookie', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'teacher@example.com',
          password: 'Password123!',
          displayName: 'Wanjiku Teacher',
        },
      });

      expect(response.statusCode).toBe(201);
      const json = response.json();
      expect(json.data.user.id).toBe(mockUser.id);
      expect(json.data.user.email).toBe(mockUser.email);
      expect(json.data.user.displayName).toBe('Wanjiku Teacher');
      expect(json.data.session.expiresAt).toBeDefined();

      // Ensure raw token is NOT in response body
      expect(json.data.sessionToken).toBeUndefined();
      expect(json.data.token).toBeUndefined();

      // Verify Set-Cookie header contains HttpOnly session cookie
      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
      expect(cookieStr).toContain(`${SESSION_COOKIE_NAME}=${mockAuthResult.sessionToken}`);
      expect(cookieStr.toLowerCase()).toContain('httponly');
      expect(cookieStr.toLowerCase()).toContain('samesite=lax');
    });

    it('returns 400 Bad Request if password is shorter than 8 characters', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'teacher@example.com',
          password: 'short',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('INVALID_REQUEST_BODY');
      expect(json.error.message).toContain('at least 8 characters');
      expect(mockService.register).not.toHaveBeenCalled();
    });

    it('returns 400 Bad Request if email format is invalid', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'not-an-email',
          password: 'ValidPassword123!',
        },
      });

      expect(response.statusCode).toBe(400);
      const json = response.json();
      expect(json.error.code).toBe('INVALID_REQUEST_BODY');
      expect(json.error.message).toContain('email');
    });

    it('returns 409 Conflict with EMAIL_ALREADY_REGISTERED on duplicate registration', async () => {
      const mockService = createMockAuthService({
        register: vi.fn().mockRejectedValue(new EmailAlreadyRegisteredError()),
      });
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: 'existing@example.com',
          password: 'ValidPassword123!',
        },
      });

      expect(response.statusCode).toBe(409);
      const json = response.json();
      expect(json.error.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(json.error.message).toBe('An account with this email address already exists.');
      expect(json.error.requestId).toBeDefined();
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('returns 200 OK and sets fresh session cookie on valid credentials', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'teacher@example.com',
          password: 'Password123!',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.user.id).toBe(mockUser.id);
      expect(json.data.session.expiresAt).toBeDefined();

      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
      expect(cookieStr).toContain(`${SESSION_COOKIE_NAME}=${mockAuthResult.sessionToken}`);
    });

    it('returns 401 Unauthorized with generic INVALID_CREDENTIALS on bad credentials', async () => {
      const mockService = createMockAuthService({
        login: vi.fn().mockRejectedValue(new InvalidCredentialsError()),
      });
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'teacher@example.com',
          password: 'WrongPassword!',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error.code).toBe('INVALID_CREDENTIALS');
      expect(json.error.message).toBe('Invalid email or password.');
      expect(json.error.requestId).toBeDefined();
    });

    it('returns 400 Bad Request when missing password or email', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: {
          email: 'teacher@example.com',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('INVALID_REQUEST_BODY');
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('returns 200 OK and clears session cookie', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        cookies: {
          [SESSION_COOKIE_NAME]: 'valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.success).toBe(true);
      expect(mockService.logout).toHaveBeenCalledWith('valid-token');

      const setCookie = response.headers['set-cookie'];
      expect(setCookie).toBeDefined();
      const cookieStr = Array.isArray(setCookie) ? setCookie[0] : (setCookie as string);
      // Cleared cookies typically have Max-Age=0 or Expires in past
      expect(cookieStr).toContain(`${SESSION_COOKIE_NAME}=;`);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns 200 OK with authenticated user profile when session cookie is valid', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        cookies: {
          [SESSION_COOKIE_NAME]: 'valid-token',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.user.id).toBe(mockUser.id);
      expect(json.data.user.email).toBe(mockUser.email);
      expect(mockService.validateSession).toHaveBeenCalledWith('valid-token');
    });

    it('returns 401 Unauthorized when token is sent in Bearer header (cookies strictly enforced)', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: {
          authorization: 'Bearer valid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error.code).toBe('UNAUTHENTICATED');
      expect(mockService.validateSession).not.toHaveBeenCalled();
    });

    it('returns 401 Unauthorized when unauthenticated (no cookie)', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error.code).toBe('UNAUTHENTICATED');
      expect(mockService.validateSession).not.toHaveBeenCalled();
    });

    it('returns 401 Unauthorized when session token is invalid or expired', async () => {
      const mockService = createMockAuthService();
      const app = buildApp({ services: { authService: mockService } });

      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        cookies: {
          [SESSION_COOKIE_NAME]: 'expired-or-invalid-token',
        },
      });

      expect(response.statusCode).toBe(401);
      const json = response.json();
      expect(json.error.code).toBe('UNAUTHENTICATED');
    });
  });
});
