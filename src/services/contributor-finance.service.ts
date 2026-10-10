import { eq, and, sql, isNull, gt, lte, or, inArray } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { db as defaultDb } from '../db/index.js';
import * as schemas from '../db/schemas.js';
import {
  contributorRevenueRules,
  contributorEarnings,
  type ContributorRevenueRule,
  type ContributorEarning,
} from '../db/schema/community.js';
import {
  orderItems,
  products,
} from '../db/schema/commerce.js';
import { resources } from '../db/schema/resource.js';

export class ContributorFinanceError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 400,
    public readonly code: string = 'CONTRIBUTOR_FINANCE_ERROR',
  ) {
    super(message);
    this.name = 'ContributorFinanceError';
  }
}

export class OverlappingRevenueRuleError extends ContributorFinanceError {
  constructor(message = 'An active revenue rule already covers the specified effective period') {
    super(message, 409, 'OVERLAPPING_REVENUE_RULE');
  }
}

export class InvalidRevenueRuleError extends ContributorFinanceError {
  constructor(message = 'Invalid revenue rule configuration') {
    super(message, 400, 'INVALID_REVENUE_RULE');
  }
}

export class RevenueRuleNotFoundError extends ContributorFinanceError {
  constructor(message = 'Revenue rule not found') {
    super(message, 404, 'REVENUE_RULE_NOT_FOUND');
  }
}

export class ContributorEarningNotFoundError extends ContributorFinanceError {
  constructor(message = 'Contributor earning record not found') {
    super(message, 404, 'CONTRIBUTOR_EARNING_NOT_FOUND');
  }
}

export interface ContributorEarningDto {
  id: string;
  contributorId: string;
  orderId: string;
  orderItemId: string;
  resourceId: string;
  revenueRuleId: string;
  grossAmountMinor: string;
  platformAmountMinor: string;
  contributorAmountMinor: string;
  currencyCode: string;
  status: 'PENDING' | 'AVAILABLE' | 'PAID' | 'CANCELLED';
  maturesAt: string;
  maturedAt: string | null;
  createdAt: string;
}

export interface ContributorEarningsSummaryDto {
  lifetimeGrossMinor: string;
  lifetimeContributorMinor: string;
  pendingMinor: string;
  availableMinor: string;
  paidMinor: string;
}

export interface ListEarningsOptions {
  page?: number;
  limit?: number;
  status?: 'PENDING' | 'AVAILABLE' | 'PAID' | 'CANCELLED';
  from?: Date;
  to?: Date;
}

export interface AdminListEarningsOptions extends ListEarningsOptions {
  contributorId?: string;
  orderId?: string;
}

export interface CreateRevenueRuleInput {
  name: string;
  contributorShareBasisPoints?: number;
  percentage?: number;
  effectiveFrom?: Date;
  effectiveTo?: Date | null;
  status?: 'ACTIVE' | 'INACTIVE';
}

export interface ContributorFinanceService {
  recordOrderEarnings(
    tx: NodePgDatabase<typeof schemas>,
    orderId: string,
    completionTime: Date,
  ): Promise<{ earningsCreated: number }>;

  matureEligibleEarnings(asOf?: Date): Promise<{ maturedCount: number }>;

  getContributorEarnings(
    contributorId: string,
    options?: ListEarningsOptions,
  ): Promise<{
    data: ContributorEarningDto[];
    summary: ContributorEarningsSummaryDto;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>;

  getAdminEarnings(
    options?: AdminListEarningsOptions,
  ): Promise<{
    data: ContributorEarningDto[];
    summary: ContributorEarningsSummaryDto;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }>;

  listRevenueRules(): Promise<ContributorRevenueRule[]>;

  createRevenueRule(
    input: CreateRevenueRuleInput,
  ): Promise<ContributorRevenueRule>;
}

export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class DefaultContributorFinanceService implements ContributorFinanceService {
  private readonly db: NodePgDatabase<typeof schemas>;

  constructor(dbInstance?: NodePgDatabase<typeof schemas>) {
    this.db = dbInstance ?? defaultDb;
  }

  /**
   * Safe integer calculations for revenue splits using basis points.
   * Contributor share = floor(gross * basisPoints / 10000)
   * Platform share = gross - contributor share
   * Guarantees contributor + platform === gross exactly.
   */
  static calculateSplit(
    grossAmountMinor: bigint,
    contributorShareBasisPoints = 7000,
  ): { contributorAmountMinor: bigint; platformAmountMinor: bigint } {
    if (grossAmountMinor < 0n) {
      throw new InvalidRevenueRuleError('Gross amount cannot be negative');
    }
    if (contributorShareBasisPoints < 0 || contributorShareBasisPoints > 10000) {
      throw new InvalidRevenueRuleError('Basis points must be between 0 and 10000');
    }

    const bps = BigInt(contributorShareBasisPoints);
    const contributorAmountMinor = (grossAmountMinor * bps) / 10000n;
    const platformAmountMinor = grossAmountMinor - contributorAmountMinor;

    return {
      contributorAmountMinor,
      platformAmountMinor,
    };
  }

  /**
   * Resolves the effective revenue rule for a given timestamp.
   * Falls back to the default canonical 70/30 rule if none is explicitly found.
   */
  async getEffectiveRevenueRule(
    tx: NodePgDatabase<typeof schemas>,
    completionTime: Date,
  ): Promise<ContributorRevenueRule> {
    const [rule] = await tx
      .select()
      .from(contributorRevenueRules)
      .where(
        and(
          eq(contributorRevenueRules.status, 'ACTIVE'),
          lte(contributorRevenueRules.effectiveFrom, completionTime),
          or(
            isNull(contributorRevenueRules.effectiveTo),
            gt(contributorRevenueRules.effectiveTo, completionTime),
          ),
        ),
      )
      .orderBy(sql`${contributorRevenueRules.effectiveFrom} DESC`)
      .limit(1);

    if (rule) {
      return rule;
    }

    // Default canonical fallback (7000 bps = 70%)
    const [existingDefault] = await tx
      .select()
      .from(contributorRevenueRules)
      .where(eq(contributorRevenueRules.name, 'Standard Contributor Revenue Share (70/30)'))
      .limit(1);

    if (existingDefault) {
      return existingDefault;
    }

    // If table is completely empty, insert canonical rule
    const [createdDefault] = await tx
      .insert(contributorRevenueRules)
      .values({
        name: 'Standard Contributor Revenue Share (70/30)',
        contributorShareBasisPoints: 7000,
        percentage: '70.0000',
        currencyCode: 'KES',
        effectiveFrom: new Date('2020-01-01T00:00:00Z'),
        status: 'ACTIVE',
      })
      .returning();

    return createdDefault;
  }

  /**
   * Transactional integration: records earnings for eligible order items.
   * Only attributes items whose resource has an existing contributorId.
   * Idempotent: duplicate calls skip already-recorded items via UNIQUE(order_item_id, contributor_id).
   */
  async recordOrderEarnings(
    tx: NodePgDatabase<typeof schemas>,
    orderId: string,
    completionTime: Date,
  ): Promise<{ earningsCreated: number }> {
    // 1. Fetch order items joined with product and resource
    const items = await tx
      .select({
        orderItem: orderItems,
        product: products,
        resource: resources,
      })
      .from(orderItems)
      .innerJoin(products, eq(orderItems.productId, products.id))
      .innerJoin(resources, eq(products.resourceId, resources.id))
      .where(eq(orderItems.orderId, orderId));

    if (items.length === 0) {
      return { earningsCreated: 0 };
    }

    // 2. Filter items attributed to a contributor
    const eligibleItems = items.filter(
      (entry) => entry.resource.contributorId !== null,
    );

    if (eligibleItems.length === 0) {
      return { earningsCreated: 0 };
    }

    // 3. Resolve authoritative effective revenue rule
    const revenueRule = await this.getEffectiveRevenueRule(tx, completionTime);
    const maturesAt = new Date(completionTime.getTime() + SEVEN_DAYS_MS);

    let earningsCreated = 0;

    for (const entry of eligibleItems) {
      const contributorId = entry.resource.contributorId!;
      const grossMinor = BigInt(entry.orderItem.totalMinor);

      const { contributorAmountMinor, platformAmountMinor } =
        DefaultContributorFinanceService.calculateSplit(
          grossMinor,
          revenueRule.contributorShareBasisPoints,
        );

      const inserted = await tx
        .insert(contributorEarnings)
        .values({
          contributorId,
          orderId,
          orderItemId: entry.orderItem.id,
          resourceId: entry.resource.id,
          revenueRuleId: revenueRule.id,
          grossAmountMinor: grossMinor,
          platformAmountMinor,
          contributorAmountMinor,
          currencyCode: 'KES',
          status: 'PENDING',
          maturesAt,
          createdAt: completionTime,
          updatedAt: completionTime,
        })
        .onConflictDoNothing({
          target: [contributorEarnings.orderItemId, contributorEarnings.contributorId],
        })
        .returning();

      if (inserted.length > 0) {
        earningsCreated++;
      }
    }

    return { earningsCreated };
  }

  /**
   * Idempotently matures eligible PENDING earnings whose 7-day maturity period has passed.
   * Transitions status to AVAILABLE and records matured_at.
   */
  async matureEligibleEarnings(asOf: Date = new Date()): Promise<{ maturedCount: number }> {
    return await this.db.transaction(async (tx) => {
      const eligible = await tx
        .select({ id: contributorEarnings.id })
        .from(contributorEarnings)
        .where(
          and(
            eq(contributorEarnings.status, 'PENDING'),
            lte(contributorEarnings.maturesAt, asOf),
          ),
        );

      if (eligible.length === 0) {
        return { maturedCount: 0 };
      }

      const eligibleIds = eligible.map((e) => e.id);

      const updated = await tx
        .update(contributorEarnings)
        .set({
          status: 'AVAILABLE',
          maturedAt: asOf,
          updatedAt: asOf,
        })
        .where(inArray(contributorEarnings.id, eligibleIds))
        .returning();

      return { maturedCount: updated.length };
    });
  }

  /**
   * Retrieves paginated earnings ledger for a specific contributor.
   */
  async getContributorEarnings(
    contributorId: string,
    options: ListEarningsOptions = {},
  ): Promise<{
    data: ContributorEarningDto[];
    summary: ContributorEarningsSummaryDto;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [eq(contributorEarnings.contributorId, contributorId)];

    if (options.status) {
      conditions.push(eq(contributorEarnings.status, options.status));
    }
    if (options.from) {
      conditions.push(sql`${contributorEarnings.createdAt} >= ${options.from}`);
    }
    if (options.to) {
      conditions.push(sql`${contributorEarnings.createdAt} <= ${options.to}`);
    }

    const whereClause = and(...conditions);

    // 1. Fetch total count
    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributorEarnings)
      .where(whereClause);

    const total = countResult?.count ?? 0;
    const totalPages = Math.ceil(total / limit) || 1;

    // 2. Fetch records
    const rows = await this.db
      .select()
      .from(contributorEarnings)
      .where(whereClause)
      .orderBy(sql`${contributorEarnings.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    // 3. Compute aggregate summary across all earnings for this contributor
    const summaryRows = await this.db
      .select({
        status: contributorEarnings.status,
        totalGross: sql<string>`coalesce(sum(${contributorEarnings.grossAmountMinor}), 0)::text`,
        totalContributor: sql<string>`coalesce(sum(${contributorEarnings.contributorAmountMinor}), 0)::text`,
      })
      .from(contributorEarnings)
      .where(eq(contributorEarnings.contributorId, contributorId))
      .groupBy(contributorEarnings.status);

    let lifetimeGross = 0n;
    let lifetimeContributor = 0n;
    let pending = 0n;
    let available = 0n;
    let paid = 0n;

    for (const s of summaryRows) {
      const g = BigInt(s.totalGross);
      const c = BigInt(s.totalContributor);
      lifetimeGross += g;
      lifetimeContributor += c;

      if (s.status === 'PENDING') pending += c;
      if (s.status === 'AVAILABLE') available += c;
      if (s.status === 'PAID') paid += c;
    }

    return {
      data: rows.map(this.mapEarning),
      summary: {
        lifetimeGrossMinor: lifetimeGross.toString(),
        lifetimeContributorMinor: lifetimeContributor.toString(),
        pendingMinor: pending.toString(),
        availableMinor: available.toString(),
        paidMinor: paid.toString(),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Administrative view of contributor earnings across all contributors.
   */
  async getAdminEarnings(
    options: AdminListEarningsOptions = {},
  ): Promise<{
    data: ContributorEarningDto[];
    summary: ContributorEarningsSummaryDto;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const page = Math.max(1, options.page ?? 1);
    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const offset = (page - 1) * limit;

    const conditions = [];

    if (options.contributorId) {
      conditions.push(eq(contributorEarnings.contributorId, options.contributorId));
    }
    if (options.orderId) {
      conditions.push(eq(contributorEarnings.orderId, options.orderId));
    }
    if (options.status) {
      conditions.push(eq(contributorEarnings.status, options.status));
    }
    if (options.from) {
      conditions.push(sql`${contributorEarnings.createdAt} >= ${options.from}`);
    }
    if (options.to) {
      conditions.push(sql`${contributorEarnings.createdAt} <= ${options.to}`);
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(contributorEarnings)
      .where(whereClause);

    const total = countResult?.count ?? 0;
    const totalPages = Math.ceil(total / limit) || 1;

    const rows = await this.db
      .select()
      .from(contributorEarnings)
      .where(whereClause)
      .orderBy(sql`${contributorEarnings.createdAt} DESC`)
      .limit(limit)
      .offset(offset);

    const summaryRows = await this.db
      .select({
        status: contributorEarnings.status,
        totalGross: sql<string>`coalesce(sum(${contributorEarnings.grossAmountMinor}), 0)::text`,
        totalContributor: sql<string>`coalesce(sum(${contributorEarnings.contributorAmountMinor}), 0)::text`,
      })
      .from(contributorEarnings)
      .where(whereClause)
      .groupBy(contributorEarnings.status);

    let lifetimeGross = 0n;
    let lifetimeContributor = 0n;
    let pending = 0n;
    let available = 0n;
    let paid = 0n;

    for (const s of summaryRows) {
      const g = BigInt(s.totalGross);
      const c = BigInt(s.totalContributor);
      lifetimeGross += g;
      lifetimeContributor += c;

      if (s.status === 'PENDING') pending += c;
      if (s.status === 'AVAILABLE') available += c;
      if (s.status === 'PAID') paid += c;
    }

    return {
      data: rows.map(this.mapEarning),
      summary: {
        lifetimeGrossMinor: lifetimeGross.toString(),
        lifetimeContributorMinor: lifetimeContributor.toString(),
        pendingMinor: pending.toString(),
        availableMinor: available.toString(),
        paidMinor: paid.toString(),
      },
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    };
  }

  /**
   * Lists all historical and active revenue rules.
   */
  async listRevenueRules(): Promise<ContributorRevenueRule[]> {
    return await this.db
      .select()
      .from(contributorRevenueRules)
      .orderBy(sql`${contributorRevenueRules.effectiveFrom} DESC`);
  }

  /**
   * Creates a new revenue rule.
   * Enforces that active rules do not have overlapping effective date ranges.
   */
  async createRevenueRule(input: CreateRevenueRuleInput): Promise<ContributorRevenueRule> {
    if (!input.name || input.name.trim().length === 0) {
      throw new InvalidRevenueRuleError('Rule name cannot be empty');
    }

    const effectiveFrom = input.effectiveFrom ?? new Date();
    const effectiveTo = input.effectiveTo ?? null;

    if (effectiveTo && effectiveTo < effectiveFrom) {
      throw new InvalidRevenueRuleError('effectiveTo cannot be before effectiveFrom');
    }

    let bps = 7000;
    if (typeof input.contributorShareBasisPoints === 'number') {
      bps = input.contributorShareBasisPoints;
    } else if (typeof input.percentage === 'number') {
      bps = Math.round(input.percentage * 100);
    }

    if (bps < 0 || bps > 10000) {
      throw new InvalidRevenueRuleError('Contributor share basis points must be between 0 and 10000');
    }

    const status = input.status ?? 'ACTIVE';

    return await this.db.transaction(async (tx) => {
      if (status === 'ACTIVE') {
        // Check for overlapping active rules
        const activeRules = await tx
          .select()
          .from(contributorRevenueRules)
          .where(eq(contributorRevenueRules.status, 'ACTIVE'));

        for (const existing of activeRules) {
          const existingFrom = new Date(existing.effectiveFrom);
          const existingTo = existing.effectiveTo ? new Date(existing.effectiveTo) : null;

          // Two intervals [A_from, A_to) and [B_from, B_to) overlap if:
          // A_from < (B_to ?? infinity) AND (A_to ?? infinity) > B_from
          const aFrom = effectiveFrom.getTime();
          const aTo = effectiveTo ? effectiveTo.getTime() : Infinity;
          const bFrom = existingFrom.getTime();
          const bTo = existingTo ? existingTo.getTime() : Infinity;

          if (aFrom < bTo && aTo > bFrom) {
            throw new OverlappingRevenueRuleError(
              `Active rule "${existing.name}" already overlaps with the specified period (${existing.effectiveFrom.toISOString()} - ${existing.effectiveTo ? existing.effectiveTo.toISOString() : 'indefinite'})`,
            );
          }
        }
      }

      const pctStr = (bps / 100).toFixed(4);

      const [created] = await tx
        .insert(contributorRevenueRules)
        .values({
          name: input.name.trim(),
          contributorShareBasisPoints: bps,
          percentage: pctStr,
          currencyCode: 'KES',
          effectiveFrom,
          effectiveTo,
          status,
        })
        .returning();

      return created;
    });
  }

  private mapEarning(row: ContributorEarning): ContributorEarningDto {
    return {
      id: row.id,
      contributorId: row.contributorId,
      orderId: row.orderId,
      orderItemId: row.orderItemId,
      resourceId: row.resourceId,
      revenueRuleId: row.revenueRuleId,
      grossAmountMinor: row.grossAmountMinor.toString(),
      platformAmountMinor: row.platformAmountMinor.toString(),
      contributorAmountMinor: row.contributorAmountMinor.toString(),
      currencyCode: row.currencyCode,
      status: row.status as 'PENDING' | 'AVAILABLE' | 'PAID' | 'CANCELLED',
      maturesAt: row.maturesAt.toISOString(),
      maturedAt: row.maturedAt ? row.maturedAt.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export const defaultContributorFinanceService = new DefaultContributorFinanceService();
