-- Prompt 22: Contributor Finance Schema & Append-Only Ledger
-- 1. Create table community.contributor_revenue_rules
CREATE TABLE IF NOT EXISTS "community"."contributor_revenue_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(100) NOT NULL,
  "contributor_share_basis_points" integer DEFAULT 7000 NOT NULL,
  "percentage" numeric(7, 4) DEFAULT '70.0000' NOT NULL,
  "currency_code" varchar(3) DEFAULT 'KES' NOT NULL,
  "effective_from" timestamp with time zone DEFAULT now() NOT NULL,
  "effective_to" timestamp with time zone,
  "status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "chk_revenue_rules_status" CHECK ("status" IN ('ACTIVE', 'INACTIVE', 'RETIRED')),
  CONSTRAINT "chk_revenue_rules_currency" CHECK ("currency_code" = 'KES'),
  CONSTRAINT "chk_revenue_rules_bps" CHECK ("contributor_share_basis_points" >= 0 AND "contributor_share_basis_points" <= 10000),
  CONSTRAINT "chk_revenue_rules_pct" CHECK ("percentage" >= 0 AND "percentage" <= 100),
  CONSTRAINT "chk_revenue_rules_dates" CHECK ("effective_to" IS NULL OR "effective_to" >= "effective_from")
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_revenue_rules_status" ON "community"."contributor_revenue_rules" ("status", "effective_from");
--> statement-breakpoint

-- 2. Create table community.contributor_earnings
CREATE TABLE IF NOT EXISTS "community"."contributor_earnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "contributor_id" uuid NOT NULL,
  "order_id" uuid NOT NULL,
  "order_item_id" uuid NOT NULL,
  "resource_id" uuid NOT NULL,
  "revenue_rule_id" uuid NOT NULL,
  "gross_amount_minor" bigint NOT NULL,
  "platform_amount_minor" bigint NOT NULL,
  "contributor_amount_minor" bigint NOT NULL,
  "currency_code" varchar(3) DEFAULT 'KES' NOT NULL,
  "status" varchar(20) DEFAULT 'PENDING' NOT NULL,
  "matures_at" timestamp with time zone NOT NULL,
  "matured_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "uq_earnings_order_item_contributor" UNIQUE("order_item_id", "contributor_id"),
  CONSTRAINT "chk_earnings_status" CHECK ("status" IN ('PENDING', 'AVAILABLE', 'PAID', 'CANCELLED')),
  CONSTRAINT "chk_earnings_currency" CHECK ("currency_code" = 'KES'),
  CONSTRAINT "chk_earnings_amounts_positive" CHECK ("gross_amount_minor" >= 0 AND "platform_amount_minor" >= 0 AND "contributor_amount_minor" >= 0),
  CONSTRAINT "chk_earnings_zero_sum" CHECK ("gross_amount_minor" = ("platform_amount_minor" + "contributor_amount_minor")),
  CONSTRAINT "chk_earnings_maturity" CHECK (
    ("status" = 'PENDING') OR
    ("status" = 'AVAILABLE' AND "matured_at" IS NOT NULL) OR
    ("status" IN ('PAID', 'CANCELLED'))
  ),
  CONSTRAINT "fk_contributor_earnings_contributor_id" FOREIGN KEY ("contributor_id") REFERENCES "community"."contributors"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contributor_earnings_order_id" FOREIGN KEY ("order_id") REFERENCES "commerce"."orders"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contributor_earnings_order_item_id" FOREIGN KEY ("order_item_id") REFERENCES "commerce"."order_items"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contributor_earnings_resource_id" FOREIGN KEY ("resource_id") REFERENCES "content"."resources"("id") ON DELETE RESTRICT,
  CONSTRAINT "fk_contributor_earnings_revenue_rule_id" FOREIGN KEY ("revenue_rule_id") REFERENCES "community"."contributor_revenue_rules"("id") ON DELETE RESTRICT
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "idx_earnings_contributor_status" ON "community"."contributor_earnings" ("contributor_id", "status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_earnings_order_id" ON "community"."contributor_earnings" ("order_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_earnings_resource_id" ON "community"."contributor_earnings" ("resource_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_earnings_status_matures_at" ON "community"."contributor_earnings" ("status", "matures_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_earnings_created_at" ON "community"."contributor_earnings" ("created_at");
--> statement-breakpoint

-- 3. Trigger to enforce append-only ledger on community.contributor_earnings
CREATE OR REPLACE FUNCTION community.fn_prevent_earnings_tampering()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'community.contributor_earnings is an append-only ledger: deletions are strictly forbidden';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Financial facts must never be modified
    IF NEW.id <> OLD.id OR
       NEW.contributor_id <> OLD.contributor_id OR
       NEW.order_id <> OLD.order_id OR
       NEW.order_item_id <> OLD.order_item_id OR
       NEW.resource_id <> OLD.resource_id OR
       NEW.revenue_rule_id <> OLD.revenue_rule_id OR
       NEW.gross_amount_minor <> OLD.gross_amount_minor OR
       NEW.platform_amount_minor <> OLD.platform_amount_minor OR
       NEW.contributor_amount_minor <> OLD.contributor_amount_minor OR
       NEW.currency_code <> OLD.currency_code OR
       NEW.matures_at <> OLD.matures_at OR
       NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Financial facts in community.contributor_earnings are immutable';
    END IF;

    -- Only permit valid status transitions:
    -- PENDING -> AVAILABLE or CANCELLED
    -- AVAILABLE -> PAID or CANCELLED
    IF OLD.status = 'PENDING' AND NEW.status NOT IN ('PENDING', 'AVAILABLE', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid status transition from PENDING to % in community.contributor_earnings', NEW.status;
    END IF;

    IF OLD.status = 'AVAILABLE' AND NEW.status NOT IN ('AVAILABLE', 'PAID', 'CANCELLED') THEN
      RAISE EXCEPTION 'Invalid status transition from AVAILABLE to % in community.contributor_earnings', NEW.status;
    END IF;

    IF OLD.status IN ('PAID', 'CANCELLED') AND NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Terminal status % in community.contributor_earnings cannot be modified', OLD.status;
    END IF;

    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

DROP TRIGGER IF EXISTS trg_earnings_tampering ON community.contributor_earnings;
--> statement-breakpoint
CREATE TRIGGER trg_earnings_tampering
BEFORE UPDATE OR DELETE ON community.contributor_earnings
FOR EACH ROW EXECUTE FUNCTION community.fn_prevent_earnings_tampering();
--> statement-breakpoint

-- 4. Seed Canonical Initial 70/30 Revenue Rule
INSERT INTO "community"."contributor_revenue_rules" (
  "id",
  "name",
  "contributor_share_basis_points",
  "percentage",
  "currency_code",
  "effective_from",
  "effective_to",
  "status"
)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Standard Contributor Revenue Share (70/30)',
  7000,
  70.0000,
  'KES',
  '2020-01-01 00:00:00+00',
  NULL,
  'ACTIVE'
)
ON CONFLICT ("id") DO NOTHING;
