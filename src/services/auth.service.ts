import crypto from 'node:crypto';
import argon2 from 'argon2';
import { eq, and, gt, isNull } from 'drizzle-orm';
import { env } from '../config/env.js';
import { db as defaultDb, type AppDatabase } from '../db/index.js';
import {
  users,
  authIdentities,
  userSessions,
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

        return {
          user,
          sessionToken: rawSessionToken,
          expiresAt,
        };
      });
    } catch (err: any) {
      // PostgreSQL unique constraint violation error code: 23505 (direct or wrapped in DrizzleQueryError)
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

    // Query auth identity joined with user profile
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
      // Run dummy verification to ensure constant-time response against user enumeration
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

    // Strict account state validation:
    // User must be ACTIVE and deleted_at must be NULL
    if (user.deletedAt !== null || user.status !== 'ACTIVE' || authIdentity.status !== 'ACTIVE') {
      throw new InvalidCredentialsError();
    }

    // Generate fresh session (session fixation protection)
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

    // Every authenticated request must verify that user is ACTIVE and NOT logically deleted
    if (user.deletedAt !== null || user.status !== 'ACTIVE') {
      return null;
    }

    // Touch lastSeenAt asynchronously without blocking
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
