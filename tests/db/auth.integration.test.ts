import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { db, closeDatabase } from '../../src/db/index.js';
import {
  users,
  authIdentities,
  userSessions,
} from '../../src/db/schemas.js';
import {
  DefaultAuthService,
  EmailAlreadyRegisteredError,
  InvalidCredentialsError,
} from '../../src/services/auth.service.js';
import { withDbRetry } from '../helpers/db-retry.js';

const isDbAvailable = Boolean(process.env.DATABASE_TEST_URL || process.env.DATABASE_URL);

describe.skipIf(!isDbAvailable)('Auth Service Neon PostgreSQL Integration Tests', () => {
  const authService = new DefaultAuthService(db);
  const createdUserIds: string[] = [];

  const testEmailPrefix = `test_auth_${Date.now()}`;

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await withDbRetry(async () => {
        // Cascade delete will remove auth_identities and user_sessions
        await db.delete(users).where(inArray(users.id, createdUserIds));
      });
    }
    await closeDatabase();
  });

  describe('1. Transactional Registration', () => {
    it('atomically creates users, auth_identities, and user_sessions in a single transaction', async () => {
      const email = `${testEmailPrefix}_reg1@example.com`;
      const password = 'StrongPassword123!';
      const displayName = 'Grace Ogot';

      const result = await withDbRetry(() =>
        authService.register({
          email,
          password,
          displayName,
          deviceMetadata: { userAgent: 'Vitest/Test' },
        }),
      );

      expect(result.user).toBeDefined();
      expect(result.user.id).toBeDefined();
      createdUserIds.push(result.user.id);

      expect(result.user.email).toBe(email.toLowerCase());
      expect(result.user.displayName).toBe(displayName);
      expect(result.user.status).toBe('ACTIVE');
      expect(result.sessionToken).toBeDefined();
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // 1. Verify users record
      const dbUsers = await withDbRetry(async () =>
        db.select().from(users).where(eq(users.id, result.user.id)),
      );
      expect(dbUsers).toHaveLength(1);
      expect(dbUsers[0].deletedAt).toBeNull();

      // 2. Verify auth_identities record
      const dbIdentities = await withDbRetry(async () =>
        db.select().from(authIdentities).where(eq(authIdentities.userId, result.user.id)),
      );
      expect(dbIdentities).toHaveLength(1);
      expect(dbIdentities[0].provider).toBe('LOCAL_PASSWORD');
      expect(dbIdentities[0].providerSubject).toBe(email.toLowerCase());
      expect(dbIdentities[0].passwordHash).toMatch(/^\$argon2id\$/);

      // 3. Verify user_sessions record
      const expectedTokenHash = crypto
        .createHash('sha256')
        .update(result.sessionToken)
        .digest('hex');

      const dbSessions = await withDbRetry(async () =>
        db.select().from(userSessions).where(eq(userSessions.userId, result.user.id)),
      );
      expect(dbSessions).toHaveLength(1);
      expect(dbSessions[0].tokenHash).toBe(expectedTokenHash);
      expect(dbSessions[0].revokedAt).toBeNull();

      // Ensure plaintext session token is NEVER stored in database
      expect(dbSessions[0].tokenHash).not.toBe(result.sessionToken);
    });
  });

  describe('2. Race-Safe Duplicate Email Handling', () => {
    it('rejects duplicate email with EmailAlreadyRegisteredError via DB uniqueness constraint', async () => {
      const email = `${testEmailPrefix}_dupe@example.com`;
      const password = 'Password123!';

      const first = await withDbRetry(() =>
        authService.register({
          email,
          password,
          displayName: 'First User',
        }),
      );
      createdUserIds.push(first.user.id);

      // Register same email with uppercase variation
      await expect(
        authService.register({
          email: email.toUpperCase(),
          password: 'AnotherPassword456!',
          displayName: 'Second User',
        }),
      ).rejects.toThrow(EmailAlreadyRegisteredError);
    });

    it('handles concurrent registration race condition safely', async () => {
      const email = `${testEmailPrefix}_race@example.com`;
      const password = 'PasswordRace123!';

      // Attempt two parallel registrations of the exact same email
      const results = await Promise.allSettled([
        authService.register({ email, password, displayName: 'Racer 1' }),
        authService.register({ email, password, displayName: 'Racer 2' }),
      ]);

      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      // Exactly one must succeed, and one must be rejected with 409
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);

      if (fulfilled[0].status === 'fulfilled') {
        createdUserIds.push(fulfilled[0].value.user.id);
      }

      if (rejected[0].status === 'rejected') {
        expect(rejected[0].reason).toBeInstanceOf(EmailAlreadyRegisteredError);
      }
    });
  });

  describe('3. Login and Credential Verification', () => {
    const loginEmail = `${testEmailPrefix}_login@example.com`;
    const password = 'CorrectPassword999!';

    beforeAll(async () => {
      const reg = await authService.register({
        email: loginEmail,
        password,
        displayName: 'Login Test User',
      });
      createdUserIds.push(reg.user.id);
    });

    it('authenticates valid credentials and returns a fresh session', async () => {
      const result = await authService.login({
        email: loginEmail,
        password,
      });

      expect(result.user).toBeDefined();
      expect(result.user.email).toBe(loginEmail.toLowerCase());
      expect(result.sessionToken).toBeDefined();

      // Session can be validated
      const sessionValidation = await authService.validateSession(result.sessionToken);
      expect(sessionValidation).not.toBeNull();
      expect(sessionValidation?.user.id).toBe(result.user.id);
    });

    it('authenticates case-insensitively for email', async () => {
      const result = await authService.login({
        email: loginEmail.toUpperCase(),
        password,
      });

      expect(result.user.email).toBe(loginEmail.toLowerCase());
    });

    it('rejects incorrect password with generic InvalidCredentialsError', async () => {
      await expect(
        authService.login({
          email: loginEmail,
          password: 'WrongPassword!',
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });

    it('rejects non-existent email with generic InvalidCredentialsError', async () => {
      await expect(
        authService.login({
          email: 'nonexistent@example.com',
          password: 'AnyPassword!',
        }),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('4. Logout and Session Revocation', () => {
    it('revokes session on logout and rejects subsequent validation', async () => {
      const email = `${testEmailPrefix}_logout@example.com`;
      const reg = await authService.register({
        email,
        password: 'Password123!',
      });
      createdUserIds.push(reg.user.id);

      // Validate session works before logout
      const beforeLogout = await authService.validateSession(reg.sessionToken);
      expect(beforeLogout).not.toBeNull();

      // Perform logout
      await authService.logout(reg.sessionToken);

      // Session is now revoked
      const afterLogout = await authService.validateSession(reg.sessionToken);
      expect(afterLogout).toBeNull();
    });
  });

  describe('5. Account Deletion and Status Enforcement (Reviewer Mandatory Requirements)', () => {
    it('rejects login and invalidates active session when account is logically deleted (deleted_at != null)', async () => {
      const email = `${testEmailPrefix}_deleted@example.com`;
      const password = 'Password123!';

      // 1. Register and get an active session
      const reg = await authService.register({ email, password });
      createdUserIds.push(reg.user.id);

      // Session is initially valid
      const validBefore = await authService.validateSession(reg.sessionToken);
      expect(validBefore).not.toBeNull();

      // 2. Soft-delete account (deleted_at != null while status remains ACTIVE)
      await withDbRetry(async () => {
        await db
          .update(users)
          .set({ deletedAt: new Date() })
          .where(eq(users.id, reg.user.id));
      });

      // 3. Login must be rejected
      await expect(
        authService.login({ email, password }),
      ).rejects.toThrow(InvalidCredentialsError);

      // 4. Existing active session in DB must be rejected by validateSession()
      const validAfter = await authService.validateSession(reg.sessionToken);
      expect(validAfter).toBeNull();
    });

    it('invalidates active session and rejects login when account becomes SUSPENDED', async () => {
      const email = `${testEmailPrefix}_suspended@example.com`;
      const password = 'Password123!';

      // 1. Register and get active session
      const reg = await authService.register({ email, password });
      createdUserIds.push(reg.user.id);

      // 2. Suspend account
      await withDbRetry(async () => {
        await db
          .update(users)
          .set({ status: 'SUSPENDED' })
          .where(eq(users.id, reg.user.id));
      });

      // 3. Login must be rejected
      await expect(
        authService.login({ email, password }),
      ).rejects.toThrow(InvalidCredentialsError);

      // 4. Existing session must be invalidated
      const validation = await authService.validateSession(reg.sessionToken);
      expect(validation).toBeNull();
    });

    it('invalidates active session and rejects login when account becomes DISABLED', async () => {
      const email = `${testEmailPrefix}_disabled@example.com`;
      const password = 'Password123!';

      // 1. Register and get active session
      const reg = await authService.register({ email, password });
      createdUserIds.push(reg.user.id);

      // 2. Disable account
      await withDbRetry(async () => {
        await db
          .update(users)
          .set({ status: 'DISABLED' })
          .where(eq(users.id, reg.user.id));
      });

      // 3. Login must be rejected
      await expect(
        authService.login({ email, password }),
      ).rejects.toThrow(InvalidCredentialsError);

      // 4. Existing session must be invalidated
      const validation = await authService.validateSession(reg.sessionToken);
      expect(validation).toBeNull();
    });
  });
});
