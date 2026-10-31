import crypto from 'node:crypto';
import argon2 from 'argon2';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  users,
  authIdentities,
  userSessions,
  roles,
  userRoles,
  type User,
  type UserSession,
} from '../db/schemas.js';

// Default session TTL: 30 days
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE_NAME = env.SESSION_COOKIE_NAME;

export interface RegisterInput {
  email: string;
  password: string;
  displayName?: string | null;
  deviceMetadata?: Record<string, unknown>;
}

export interface LoginInput {
  email: string;
  password: string;
  deviceMetadata?: Record<string, unknown>;
}

export interface ChangePasswordInput {
  userId: string;
  currentPassword: string;
  newPassword: string;
  deviceMetadata?: Record<string, unknown>;
}

export interface AuthResult {
  user: User;
  sessionToken: string;
  expiresAt: Date;
}

export interface SessionValidationResult {
  user: User;
  session: UserSession;
}

export class AuthError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = 'AuthError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export class EmailAlreadyRegisteredError extends AuthError {
  constructor(message = 'An account with this email address already exists.') {
    super(message, 409, 'EMAIL_ALREADY_REGISTERED');
  }
}

export class InvalidCredentialsError extends AuthError {
  constructor(message = 'Invalid email or password.') {
    super(message, 401, 'INVALID_CREDENTIALS');
  }
}

export class AuthenticationRequiredError extends AuthError {
  constructor(message = 'Authentication is required to access this resource.') {
    super(message, 401, 'UNAUTHENTICATED');
  }
}

export const UnauthenticatedError = AuthenticationRequiredError;

export interface AuthService {
  register(input: RegisterInput): Promise<AuthResult>;
  login(input: LoginInput): Promise<AuthResult>;
  logout(rawToken: string): Promise<void>;
  validateSession(rawToken: string): Promise<SessionValidationResult | null>;
  changePassword?(input: ChangePasswordInput): Promise<AuthResult>;
  revokeAllUserSessions?(userId: string): Promise<number>;
}

export class DefaultAuthService implements AuthService {
  private dummyHash: string | null = null;

  constructor(private readonly db: AppDatabase = defaultDb) {}

  /**
   * Lazily initialized dummy Argon2id hash used to mitigate timing attacks
   * when an unknown email is submitted to login.
   */
  private async getDummyHash(): Promise<string> {
    if (!this.dummyHash) {
      this.dummyHash = await argon2.hash('ElimuPinDummyPasswordTimingMitigation123!', {
        type: argon2.argon2id,
      });
    }
    return this.dummyHash;
  }

  /**
   * Hashes raw session token with SHA-256 for secure DB persistence.
   * Neither raw session tokens nor token hashes are ever logged.
   */
  public hashSessionToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Generates a cryptographically secure 256-bit random session token.
   */
  public generateSessionToken(): string {
    return crypto.randomBytes(32).toString('hex');
  }

  /**
   * Register a new user atomically in a single database transaction.
   * Race-safe against duplicate emails via database unique constraints.
   */
  async register(input: RegisterInput): Promise<AuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();
    const trimmedDisplayName = input.displayName?.trim() || null;

    // Hash password with Argon2id before beginning transaction
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
    });

    const rawSessionToken = this.generateSessionToken();
    const tokenHash = this.hashSessionToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    try {
      return await this.db.transaction(async (tx) => {
        // 1. Create central user profile
        const [user] = await tx
          .insert(users)
          .values({
            email: normalizedEmail,
            displayName: trimmedDisplayName,
            status: 'ACTIVE',
          })
          .returning();

        // 2. Create authentication identity
        await tx.insert(authIdentities).values({
          userId: user.id,
          provider: 'LOCAL_PASSWORD',
          providerSubject: normalizedEmail,
          email: normalizedEmail,
          passwordHash,
          status: 'ACTIVE',
        });

        // 3. Create server-side session
        await tx.insert(userSessions).values({
          userId: user.id,
          tokenHash,
          expiresAt,
          deviceMetadata: input.deviceMetadata ?? {},
        });

        // 4. Assign default standard_user role atomically (Prompt 14 Correction 3)
        const [standardRole] = await tx
          .select({ id: roles.id })
          .from(roles)
          .where(eq(roles.slug, 'standard_user'))
          .limit(1);

        if (standardRole) {
          await tx.insert(userRoles).values({
            userId: user.id,
            roleId: standardRole.id,
            scopeType: null,
            scopeId: null,
            status: 'ACTIVE',
          });
        }

        return {
          user,
          sessionToken: rawSessionToken,
          expiresAt,
        };
      });
    } catch (err: any) {
      const isUniqueViolation =
        err?.code === '23505' ||
        err?.cause?.code === '23505' ||
        err?.cause?.cause?.code === '23505' ||
        (typeof err?.message === 'string' &&
          err.message.includes('duplicate key value violates unique constraint'));

      if (isUniqueViolation) {
        throw new EmailAlreadyRegisteredError();
      }
      throw err;
    }
  }

  /**
   * Authenticate user with email and password.
   * Timing-safe, respects account status and logical deletion (deleted_at).
   */
  async login(input: LoginInput): Promise<AuthResult> {
    const normalizedEmail = input.email.trim().toLowerCase();

    const records = await this.db
      .select({
        authIdentity: authIdentities,
        user: users,
      })
      .from(authIdentities)
      .innerJoin(users, eq(authIdentities.userId, users.id))
      .where(
        and(
          eq(authIdentities.provider, 'LOCAL_PASSWORD'),
          eq(authIdentities.providerSubject, normalizedEmail),
        ),
      )
      .limit(1);

    if (records.length === 0) {
      await argon2.verify(await this.getDummyHash(), input.password);
      throw new InvalidCredentialsError();
    }

    const { authIdentity, user } = records[0];

    if (!authIdentity.passwordHash) {
      await argon2.verify(await this.getDummyHash(), input.password);
      throw new InvalidCredentialsError();
    }

    const passwordMatches = await argon2.verify(
      authIdentity.passwordHash,
      input.password,
    );

    if (!passwordMatches) {
      throw new InvalidCredentialsError();
    }

    if (user.deletedAt !== null || user.status !== 'ACTIVE' || authIdentity.status !== 'ACTIVE') {
      throw new InvalidCredentialsError();
    }

    const rawSessionToken = this.generateSessionToken();
    const tokenHash = this.hashSessionToken(rawSessionToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.db.insert(userSessions).values({
      userId: user.id,
      tokenHash,
      expiresAt,
      deviceMetadata: input.deviceMetadata ?? {},
    });

    return {
      user,
      sessionToken: rawSessionToken,
      expiresAt,
    };
  }

  /**
   * Atomically updates a user's password, revokes ALL active sessions across every device,
   * and issues one fresh rotated session for the authenticated caller (W1-AC-10).
   */
  async changePassword(input: ChangePasswordInput): Promise<AuthResult> {
    const records = await this.db
      .select({
        authIdentity: authIdentities,
        user: users,
      })
      .from(authIdentities)
      .innerJoin(users, eq(authIdentities.userId, users.id))
      .where(
        and(
          eq(authIdentities.userId, input.userId),
          eq(authIdentities.provider, 'LOCAL_PASSWORD'),
        ),
      )
      .limit(1);

    if (records.length === 0) {
      await argon2.verify(await this.getDummyHash(), input.currentPassword);
      throw new InvalidCredentialsError('Current password is invalid.');
    }

    const { authIdentity, user } = records[0];

    if (
      !authIdentity.passwordHash ||
      user.deletedAt !== null ||
      user.status !== 'ACTIVE' ||
      authIdentity.status !== 'ACTIVE'
    ) {
      await argon2.verify(await this.getDummyHash(), input.currentPassword);
      throw new InvalidCredentialsError('Current password is invalid.');
    }

    const currentMatches = await argon2.verify(
      authIdentity.passwordHash,
      input.currentPassword,
    );
    if (!currentMatches) {
      throw new InvalidCredentialsError('Current password is invalid.');
    }

    if (input.currentPassword === input.newPassword) {
      throw new AuthError(
        'New password must differ from the current password.',
        400,
        'PASSWORD_UNCHANGED',
      );
    }

    const newPasswordHash = await argon2.hash(input.newPassword, {
      type: argon2.argon2id,
    });
    const rawSessionToken = this.generateSessionToken();
    const tokenHash = this.hashSessionToken(rawSessionToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

    await this.db.transaction(async (tx) => {
      await tx
        .update(authIdentities)
        .set({
          passwordHash: newPasswordHash,
          updatedAt: now,
        })
        .where(eq(authIdentities.id, authIdentity.id));

      // Revoke ALL existing active sessions for this user across all devices (W1-AC-10)
      await tx
        .update(userSessions)
        .set({ revokedAt: now })
        .where(
          and(
            eq(userSessions.userId, user.id),
            isNull(userSessions.revokedAt),
          ),
        );

      // Issue a single fresh rotated session for the caller
      await tx.insert(userSessions).values({
        userId: user.id,
        tokenHash,
        expiresAt,
        deviceMetadata: input.deviceMetadata ?? {},
      });
    });

    return {
      user,
      sessionToken: rawSessionToken,
      expiresAt,
    };
  }

  /**
   * Revokes all active sessions for a user (used on administrative password reset / credential compromise).
   */
  async revokeAllUserSessions(userId: string): Promise<number> {
    const now = new Date();
    const revoked = await this.db
      .update(userSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(userSessions.userId, userId),
          isNull(userSessions.revokedAt),
        ),
      )
      .returning({ id: userSessions.id });

    return revoked.length;
  }

  /**
   * Validates an active session token and verifies user status.
   * Returns null if session is expired, revoked, or if user account is deleted/suspended/disabled.
   */
  async validateSession(rawToken: string): Promise<SessionValidationResult | null> {
    if (!rawToken || typeof rawToken !== 'string') {
      return null;
    }

    const tokenHash = this.hashSessionToken(rawToken);
    const now = new Date();

    const records = await this.db
      .select({
        session: userSessions,
        user: users,
      })
      .from(userSessions)
      .innerJoin(users, eq(userSessions.userId, users.id))
      .where(
        and(
          eq(userSessions.tokenHash, tokenHash),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, now),
        ),
      )
      .limit(1);

    if (records.length === 0) {
      return null;
    }

    const { session, user } = records[0];

    if (user.deletedAt !== null || user.status !== 'ACTIVE') {
      return null;
    }

    this.db
      .update(userSessions)
      .set({ lastSeenAt: now })
      .where(eq(userSessions.id, session.id))
      .catch(() => {
        // Non-critical background timestamp update failure ignored
      });

    return { session, user };
  }

  /**
   * Revoke an active session.
   */
  async logout(rawToken: string): Promise<void> {
    if (!rawToken || typeof rawToken !== 'string') {
      return;
    }

    const tokenHash = this.hashSessionToken(rawToken);
    await this.db
      .update(userSessions)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(userSessions.tokenHash, tokenHash),
          isNull(userSessions.revokedAt),
        ),
      );
  }
}

export const defaultAuthService: AuthService = new DefaultAuthService();
