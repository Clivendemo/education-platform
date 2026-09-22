CREATE SCHEMA IF NOT EXISTS "analytics";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "calendar";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "commerce";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "community";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "content";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "files";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "governance";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "identity";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "platform";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "system";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "taxonomy";
--> statement-breakpoint
CREATE TABLE "platform"."administrative_area_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"hierarchy_level" integer NOT NULL,
	"parent_type_id" uuid,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_area_types_id_country" UNIQUE("id","country_id"),
	CONSTRAINT "uq_area_types_id_parent_type" UNIQUE("id","parent_type_id"),
	CONSTRAINT "uq_area_types_country_slug" UNIQUE("country_id","slug"),
	CONSTRAINT "uq_area_types_country_level" UNIQUE("country_id","hierarchy_level"),
	CONSTRAINT "chk_area_types_level" CHECK ("platform"."administrative_area_types"."hierarchy_level" > 0),
	CONSTRAINT "chk_area_types_parent_level" CHECK (("platform"."administrative_area_types"."hierarchy_level" = 1 AND "platform"."administrative_area_types"."parent_type_id" IS NULL) OR ("platform"."administrative_area_types"."hierarchy_level" > 1 AND "platform"."administrative_area_types"."parent_type_id" IS NOT NULL)),
	CONSTRAINT "chk_area_types_status" CHECK ("platform"."administrative_area_types"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "platform"."administrative_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_id" uuid NOT NULL,
	"type_id" uuid NOT NULL,
	"parent_type_id" uuid,
	"parent_id" uuid,
	"name" varchar(150) NOT NULL,
	"code" varchar(50),
	"slug" varchar(150) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_areas_id_country" UNIQUE("id","country_id"),
	CONSTRAINT "uq_areas_id_type" UNIQUE("id","type_id"),
	CONSTRAINT "uq_areas_country_type_slug" UNIQUE("country_id","type_id","slug"),
	CONSTRAINT "chk_areas_no_self_parent" CHECK ("platform"."administrative_areas"."parent_id" IS NULL OR "platform"."administrative_areas"."parent_id" <> "platform"."administrative_areas"."id"),
	CONSTRAINT "chk_areas_parent_presence" CHECK (("platform"."administrative_areas"."parent_type_id" IS NULL AND "platform"."administrative_areas"."parent_id" IS NULL) OR ("platform"."administrative_areas"."parent_type_id" IS NOT NULL AND "platform"."administrative_areas"."parent_id" IS NOT NULL)),
	CONSTRAINT "chk_areas_status" CHECK ("platform"."administrative_areas"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "platform"."countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(100) NOT NULL,
	"iso_code" varchar(3) NOT NULL,
	"url_prefix" varchar(10) NOT NULL,
	"default_language_code" varchar(10) DEFAULT 'en' NOT NULL,
	"currency_code" varchar(3) DEFAULT 'KES' NOT NULL,
	"education_terminology_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"payment_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"policy_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_countries_iso_code" UNIQUE("iso_code"),
	CONSTRAINT "uq_countries_url_prefix" UNIQUE("url_prefix"),
	CONSTRAINT "chk_countries_iso_code_upper" CHECK ("platform"."countries"."iso_code" = upper("platform"."countries"."iso_code")),
	CONSTRAINT "chk_countries_url_prefix_lower" CHECK ("platform"."countries"."url_prefix" = lower("platform"."countries"."url_prefix")),
	CONSTRAINT "chk_countries_status" CHECK ("platform"."countries"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "platform"."administrative_area_types" ADD CONSTRAINT "administrative_area_types_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "platform"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."administrative_area_types" ADD CONSTRAINT "fk_area_types_parent_country" FOREIGN KEY ("parent_type_id","country_id") REFERENCES "platform"."administrative_area_types"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."administrative_areas" ADD CONSTRAINT "administrative_areas_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "platform"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."administrative_areas" ADD CONSTRAINT "fk_areas_type_country" FOREIGN KEY ("type_id","country_id") REFERENCES "platform"."administrative_area_types"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."administrative_areas" ADD CONSTRAINT "fk_areas_type_parent_type" FOREIGN KEY ("type_id","parent_type_id") REFERENCES "platform"."administrative_area_types"("id","parent_type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."administrative_areas" ADD CONSTRAINT "fk_areas_parent_country" FOREIGN KEY ("parent_id","country_id") REFERENCES "platform"."administrative_areas"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."administrative_areas" ADD CONSTRAINT "fk_areas_parent_area_type" FOREIGN KEY ("parent_id","parent_type_id") REFERENCES "platform"."administrative_areas"("id","type_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_areas_country_id" ON "platform"."administrative_areas" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "idx_areas_type_id" ON "platform"."administrative_areas" USING btree ("type_id");--> statement-breakpoint
CREATE INDEX "idx_areas_parent_id" ON "platform"."administrative_areas" USING btree ("parent_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform.fn_validate_administrative_area_hierarchy()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.parent_id IS NOT NULL AND NEW.parent_id = NEW.id THEN
        RAISE EXCEPTION 'An administrative area cannot parent itself' USING ERRCODE = '23514';
    END IF;

    IF NEW.parent_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM platform.administrative_areas p
            WHERE p.id = NEW.parent_id AND p.country_id = NEW.country_id
        ) THEN
            RAISE EXCEPTION 'Parent administrative area must belong to the same country' USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_validate_administrative_area_hierarchy ON platform.administrative_areas;--> statement-breakpoint
CREATE TRIGGER trg_validate_administrative_area_hierarchy
BEFORE INSERT OR UPDATE ON platform.administrative_areas
FOR EACH ROW
EXECUTE FUNCTION platform.fn_validate_administrative_area_hierarchy();
