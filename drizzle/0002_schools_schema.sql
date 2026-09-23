CREATE TABLE "platform"."schools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_id" uuid NOT NULL,
	"administrative_area_id" uuid,
	"name" varchar(255) NOT NULL,
	"code" varchar(100),
	"school_type" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_schools_country_code" UNIQUE("country_id","code"),
	CONSTRAINT "chk_schools_name_not_empty" CHECK (length(trim("platform"."schools"."name")) > 0),
	CONSTRAINT "chk_schools_type" CHECK ("platform"."schools"."school_type" IN ('PRIMARY', 'JUNIOR_SCHOOL', 'SECONDARY', 'SENIOR_SCHOOL', 'INTEGRATED')),
	CONSTRAINT "chk_schools_status" CHECK ("platform"."schools"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "platform"."schools" ADD CONSTRAINT "schools_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "platform"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."schools" ADD CONSTRAINT "schools_administrative_area_id_administrative_areas_id_fk" FOREIGN KEY ("administrative_area_id") REFERENCES "platform"."administrative_areas"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."schools" ADD CONSTRAINT "fk_schools_area_country" FOREIGN KEY ("administrative_area_id","country_id") REFERENCES "platform"."administrative_areas"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_schools_country_id" ON "platform"."schools" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "idx_schools_administrative_area_id" ON "platform"."schools" USING btree ("administrative_area_id");--> statement-breakpoint
CREATE INDEX "idx_schools_school_type" ON "platform"."schools" USING btree ("school_type");--> statement-breakpoint
CREATE INDEX "idx_schools_status" ON "platform"."schools" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_schools_code" ON "platform"."schools" USING btree ("code");--> statement-breakpoint
CREATE OR REPLACE FUNCTION platform.fn_validate_school_geography()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.administrative_area_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM platform.administrative_areas a
            WHERE a.id = NEW.administrative_area_id AND a.country_id = NEW.country_id
        ) THEN
            RAISE EXCEPTION 'School country must match administrative area country' USING ERRCODE = '23503';
        END IF;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_validate_school_geography ON platform.schools;--> statement-breakpoint
CREATE TRIGGER trg_validate_school_geography
BEFORE INSERT OR UPDATE ON platform.schools
FOR EACH ROW
EXECUTE FUNCTION platform.fn_validate_school_geography();
