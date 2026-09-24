CREATE TABLE "content"."resource_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(50) NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"pillar" varchar(50) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"sequence_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_resource_types_code" UNIQUE("code"),
	CONSTRAINT "uq_resource_types_slug" UNIQUE("slug"),
	CONSTRAINT "chk_resource_types_status" CHECK ("content"."resource_types"."status" IN ('ACTIVE', 'INACTIVE')),
	CONSTRAINT "chk_resource_types_pillar" CHECK ("content"."resource_types"."pillar" IN ('PAST_PAPERS', 'LESSON_PLANS', 'SCHEMES_OF_WORK', 'NOTES_REVISION', 'SCHOOL_DOCUMENTS', 'ACADEMIC_CALENDAR', 'EDUCATION_UPDATES', 'TEACHER_RESOURCES')),
	CONSTRAINT "chk_resource_types_seq" CHECK ("content"."resource_types"."sequence_order" > 0),
	CONSTRAINT "chk_resource_types_code_not_empty" CHECK (length(trim("content"."resource_types"."code")) > 0),
	CONSTRAINT "chk_resource_types_name_not_empty" CHECK (length(trim("content"."resource_types"."name")) > 0),
	CONSTRAINT "chk_resource_types_slug_not_empty" CHECK (length(trim("content"."resource_types"."slug")) > 0)
);
--> statement-breakpoint
CREATE TABLE "content"."resource_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"resource_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"version_label" varchar(50) NOT NULL,
	"title" varchar(255) NOT NULL,
	"description" text,
	"change_summary" text,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"quality_label" varchar(20) DEFAULT 'STANDARD' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_resource_versions_resource_num" UNIQUE("resource_id","version_number"),
	CONSTRAINT "chk_resource_versions_num" CHECK ("content"."resource_versions"."version_number" > 0),
	CONSTRAINT "chk_resource_versions_title_not_empty" CHECK (length(trim("content"."resource_versions"."title")) > 0),
	CONSTRAINT "chk_resource_versions_status" CHECK ("content"."resource_versions"."status" IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REJECTED')),
	CONSTRAINT "chk_resource_versions_quality_label" CHECK ("content"."resource_versions"."quality_label" IN ('STANDARD', 'VERIFIED', 'PREMIUM')),
	CONSTRAINT "chk_resource_versions_published_at" CHECK (("content"."resource_versions"."status" = 'PUBLISHED' AND "content"."resource_versions"."published_at" IS NOT NULL) OR ("content"."resource_versions"."status" <> 'PUBLISHED'))
);
--> statement-breakpoint
CREATE TABLE "content"."resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_id" uuid NOT NULL,
	"resource_type_id" uuid NOT NULL,
	"school_id" uuid,
	"curriculum_id" uuid,
	"curriculum_version_id" uuid,
	"education_level_id" uuid,
	"grade_id" uuid,
	"pathway_id" uuid,
	"subject_id" uuid,
	"topic_id" uuid,
	"title" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(20) DEFAULT 'DRAFT' NOT NULL,
	"quality_label" varchar(20) DEFAULT 'STANDARD' NOT NULL,
	"source_name" varchar(150),
	"source_reference" varchar(255),
	"academic_year" integer,
	"term" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_resources_country_slug" UNIQUE("country_id","slug"),
	CONSTRAINT "uq_resources_id_country" UNIQUE("id","country_id"),
	CONSTRAINT "chk_resources_title_not_empty" CHECK (length(trim("content"."resources"."title")) > 0),
	CONSTRAINT "chk_resources_slug_not_empty" CHECK (length(trim("content"."resources"."slug")) > 0),
	CONSTRAINT "chk_resources_status" CHECK ("content"."resources"."status" IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED', 'REJECTED')),
	CONSTRAINT "chk_resources_quality_label" CHECK ("content"."resources"."quality_label" IN ('STANDARD', 'VERIFIED', 'PREMIUM')),
	CONSTRAINT "chk_resources_term" CHECK ("content"."resources"."term" IS NULL OR "content"."resources"."term" IN (1, 2, 3)),
	CONSTRAINT "chk_resources_academic_year" CHECK ("content"."resources"."academic_year" IS NULL OR ("content"."resources"."academic_year" >= 1970 AND "content"."resources"."academic_year" <= 2100)),
	CONSTRAINT "chk_resources_curriculum_parent_deps" CHECK (("content"."resources"."topic_id" IS NULL OR "content"."resources"."subject_id" IS NOT NULL) AND ("content"."resources"."subject_id" IS NULL OR "content"."resources"."grade_id" IS NOT NULL) AND ("content"."resources"."pathway_id" IS NULL OR "content"."resources"."grade_id" IS NOT NULL) AND ("content"."resources"."grade_id" IS NULL OR "content"."resources"."education_level_id" IS NOT NULL) AND ("content"."resources"."education_level_id" IS NULL OR "content"."resources"."curriculum_version_id" IS NOT NULL) AND ("content"."resources"."curriculum_version_id" IS NULL OR "content"."resources"."curriculum_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "content"."resource_versions" ADD CONSTRAINT "resource_versions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "content"."resources"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "platform"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_resource_type_id_resource_types_id_fk" FOREIGN KEY ("resource_type_id") REFERENCES "content"."resource_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform"."schools" ADD CONSTRAINT "uq_schools_id_country" UNIQUE("id","country_id");--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "platform"."schools"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_school_country" FOREIGN KEY ("school_id","country_id") REFERENCES "platform"."schools"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "taxonomy"."curricula"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "taxonomy"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_education_level_id_education_levels_id_fk" FOREIGN KEY ("education_level_id") REFERENCES "taxonomy"."education_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "taxonomy"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_pathway_id_pathways_id_fk" FOREIGN KEY ("pathway_id") REFERENCES "taxonomy"."pathways"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "taxonomy"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "resources_topic_id_topics_id_fk" FOREIGN KEY ("topic_id") REFERENCES "taxonomy"."topics"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_curriculum_country" FOREIGN KEY ("curriculum_id","country_id") REFERENCES "taxonomy"."curricula"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_version_country" FOREIGN KEY ("curriculum_version_id","country_id") REFERENCES "taxonomy"."curriculum_versions"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_version_curriculum" FOREIGN KEY ("curriculum_version_id","curriculum_id") REFERENCES "taxonomy"."curriculum_versions"("id","curriculum_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_level_version" FOREIGN KEY ("education_level_id","curriculum_version_id") REFERENCES "taxonomy"."education_levels"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_grade_version" FOREIGN KEY ("grade_id","curriculum_version_id") REFERENCES "taxonomy"."grades"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_grade_level" FOREIGN KEY ("grade_id","education_level_id") REFERENCES "taxonomy"."grades"("id","education_level_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_pathway_grade" FOREIGN KEY ("pathway_id","grade_id") REFERENCES "taxonomy"."pathways"("id","grade_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_subject_grade" FOREIGN KEY ("subject_id","grade_id") REFERENCES "taxonomy"."subjects"("id","grade_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content"."resources" ADD CONSTRAINT "fk_resources_topic_subject" FOREIGN KEY ("topic_id","subject_id") REFERENCES "taxonomy"."topics"("id","subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_resource_types_status_seq" ON "content"."resource_types" USING btree ("status","sequence_order");--> statement-breakpoint
CREATE INDEX "idx_resource_types_pillar" ON "content"."resource_types" USING btree ("pillar");--> statement-breakpoint
CREATE INDEX "idx_resource_versions_resource_id" ON "content"."resource_versions" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "idx_resource_versions_status" ON "content"."resource_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_resource_versions_published_at" ON "content"."resource_versions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "idx_resources_country_id" ON "content"."resources" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "idx_resources_resource_type_id" ON "content"."resources" USING btree ("resource_type_id");--> statement-breakpoint
CREATE INDEX "idx_resources_school_id" ON "content"."resources" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "idx_resources_status" ON "content"."resources" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_resources_quality_label" ON "content"."resources" USING btree ("quality_label");--> statement-breakpoint
CREATE INDEX "idx_resources_grade_id" ON "content"."resources" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "idx_resources_subject_id" ON "content"."resources" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "idx_resources_topic_id" ON "content"."resources" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "idx_resources_academic_year" ON "content"."resources" USING btree ("academic_year");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION content.fn_validate_resource_school_country()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.school_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM platform.schools s
            WHERE s.id = NEW.school_id AND s.country_id = NEW.country_id
        ) THEN
            RAISE EXCEPTION 'Resource country must match school country' USING ERRCODE = '23503';
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_validate_resource_school_country ON content.resources;
--> statement-breakpoint
CREATE TRIGGER trg_validate_resource_school_country
BEFORE INSERT OR UPDATE ON content.resources
FOR EACH ROW
EXECUTE FUNCTION content.fn_validate_resource_school_country();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION content.fn_prevent_published_resource_version_modification()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'Published resource versions are immutable and cannot be modified' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS trg_prevent_published_resource_version_modification ON content.resource_versions;--> statement-breakpoint
CREATE TRIGGER trg_prevent_published_resource_version_modification
BEFORE UPDATE ON content.resource_versions
FOR EACH ROW
EXECUTE FUNCTION content.fn_prevent_published_resource_version_modification();