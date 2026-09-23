CREATE TABLE "taxonomy"."curricula" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"code" varchar(50),
	"description" text,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_curricula_country_slug" UNIQUE("country_id","slug"),
	CONSTRAINT "uq_curricula_id_country" UNIQUE("id","country_id"),
	CONSTRAINT "chk_curricula_name_not_empty" CHECK (length(trim("taxonomy"."curricula"."name")) > 0),
	CONSTRAINT "chk_curricula_slug_not_empty" CHECK (length(trim("taxonomy"."curricula"."slug")) > 0),
	CONSTRAINT "chk_curricula_status" CHECK ("taxonomy"."curricula"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "taxonomy"."curriculum_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_id" uuid NOT NULL,
	"country_id" uuid NOT NULL,
	"version_name" varchar(100) NOT NULL,
	"version_code" varchar(50),
	"slug" varchar(100) NOT NULL,
	"effective_from" date,
	"effective_to" date,
	"status" varchar(20) DEFAULT 'CURRENT' NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_curriculum_versions_curriculum_slug" UNIQUE("curriculum_id","slug"),
	CONSTRAINT "uq_curriculum_versions_id_curriculum" UNIQUE("id","curriculum_id"),
	CONSTRAINT "uq_curriculum_versions_id_country" UNIQUE("id","country_id"),
	CONSTRAINT "chk_curriculum_versions_name_not_empty" CHECK (length(trim("taxonomy"."curriculum_versions"."version_name")) > 0),
	CONSTRAINT "chk_curriculum_versions_slug_not_empty" CHECK (length(trim("taxonomy"."curriculum_versions"."slug")) > 0),
	CONSTRAINT "chk_curriculum_versions_status" CHECK ("taxonomy"."curriculum_versions"."status" IN ('DRAFT', 'PLANNED', 'CURRENT', 'HISTORICAL', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "taxonomy"."education_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"code" varchar(50),
	"description" text,
	"sequence_order" integer NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_education_levels_version_slug" UNIQUE("curriculum_version_id","slug"),
	CONSTRAINT "uq_education_levels_version_seq" UNIQUE("curriculum_version_id","sequence_order"),
	CONSTRAINT "uq_education_levels_id_version" UNIQUE("id","curriculum_version_id"),
	CONSTRAINT "chk_education_levels_seq" CHECK ("taxonomy"."education_levels"."sequence_order" > 0),
	CONSTRAINT "chk_education_levels_name_not_empty" CHECK (length(trim("taxonomy"."education_levels"."name")) > 0),
	CONSTRAINT "chk_education_levels_status" CHECK ("taxonomy"."education_levels"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "taxonomy"."grades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"education_level_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"code" varchar(50),
	"description" text,
	"sequence_order" integer NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_grades_version_slug" UNIQUE("curriculum_version_id","slug"),
	CONSTRAINT "uq_grades_version_seq" UNIQUE("curriculum_version_id","sequence_order"),
	CONSTRAINT "uq_grades_id_version" UNIQUE("id","curriculum_version_id"),
	CONSTRAINT "uq_grades_id_level" UNIQUE("id","education_level_id"),
	CONSTRAINT "chk_grades_seq" CHECK ("taxonomy"."grades"."sequence_order" > 0),
	CONSTRAINT "chk_grades_name_not_empty" CHECK (length(trim("taxonomy"."grades"."name")) > 0),
	CONSTRAINT "chk_grades_status" CHECK ("taxonomy"."grades"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "taxonomy"."pathways" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"education_level_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"name" varchar(100) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"code" varchar(50),
	"description" text,
	"sequence_order" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_pathways_grade_slug" UNIQUE("grade_id","slug"),
	CONSTRAINT "uq_pathways_grade_seq" UNIQUE("grade_id","sequence_order"),
	CONSTRAINT "uq_pathways_id_grade" UNIQUE("id","grade_id"),
	CONSTRAINT "uq_pathways_id_version" UNIQUE("id","curriculum_version_id"),
	CONSTRAINT "chk_pathways_seq" CHECK ("taxonomy"."pathways"."sequence_order" > 0),
	CONSTRAINT "chk_pathways_name_not_empty" CHECK (length(trim("taxonomy"."pathways"."name")) > 0),
	CONSTRAINT "chk_pathways_status" CHECK ("taxonomy"."pathways"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "taxonomy"."subjects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"education_level_id" uuid NOT NULL,
	"grade_id" uuid NOT NULL,
	"pathway_id" uuid,
	"name" varchar(150) NOT NULL,
	"slug" varchar(100) NOT NULL,
	"code" varchar(50),
	"description" text,
	"sequence_order" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_subjects_id_version" UNIQUE("id","curriculum_version_id"),
	CONSTRAINT "uq_subjects_id_grade" UNIQUE("id","grade_id"),
	CONSTRAINT "chk_subjects_seq" CHECK ("taxonomy"."subjects"."sequence_order" > 0),
	CONSTRAINT "chk_subjects_name_not_empty" CHECK (length(trim("taxonomy"."subjects"."name")) > 0),
	CONSTRAINT "chk_subjects_status" CHECK ("taxonomy"."subjects"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
CREATE TABLE "taxonomy"."topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"curriculum_version_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" varchar(255) NOT NULL,
	"slug" varchar(150) NOT NULL,
	"code" varchar(50),
	"description" text,
	"sequence_order" integer DEFAULT 1 NOT NULL,
	"status" varchar(20) DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_topics_id_subject" UNIQUE("id","subject_id"),
	CONSTRAINT "chk_topics_no_self_parent" CHECK ("taxonomy"."topics"."id" <> "taxonomy"."topics"."parent_id"),
	CONSTRAINT "chk_topics_seq" CHECK ("taxonomy"."topics"."sequence_order" > 0),
	CONSTRAINT "chk_topics_name_not_empty" CHECK (length(trim("taxonomy"."topics"."name")) > 0),
	CONSTRAINT "chk_topics_status" CHECK ("taxonomy"."topics"."status" IN ('ACTIVE', 'INACTIVE'))
);
--> statement-breakpoint
ALTER TABLE "taxonomy"."curricula" ADD CONSTRAINT "curricula_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "platform"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."curriculum_versions" ADD CONSTRAINT "curriculum_versions_curriculum_id_curricula_id_fk" FOREIGN KEY ("curriculum_id") REFERENCES "taxonomy"."curricula"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."curriculum_versions" ADD CONSTRAINT "curriculum_versions_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "platform"."countries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."curriculum_versions" ADD CONSTRAINT "fk_curriculum_versions_curriculum_country" FOREIGN KEY ("curriculum_id","country_id") REFERENCES "taxonomy"."curricula"("id","country_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."education_levels" ADD CONSTRAINT "education_levels_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "taxonomy"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."grades" ADD CONSTRAINT "grades_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "taxonomy"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."grades" ADD CONSTRAINT "grades_education_level_id_education_levels_id_fk" FOREIGN KEY ("education_level_id") REFERENCES "taxonomy"."education_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."grades" ADD CONSTRAINT "fk_grades_level_version" FOREIGN KEY ("education_level_id","curriculum_version_id") REFERENCES "taxonomy"."education_levels"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."pathways" ADD CONSTRAINT "pathways_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "taxonomy"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."pathways" ADD CONSTRAINT "pathways_education_level_id_education_levels_id_fk" FOREIGN KEY ("education_level_id") REFERENCES "taxonomy"."education_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."pathways" ADD CONSTRAINT "pathways_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "taxonomy"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."pathways" ADD CONSTRAINT "fk_pathways_grade_level" FOREIGN KEY ("grade_id","education_level_id") REFERENCES "taxonomy"."grades"("id","education_level_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."pathways" ADD CONSTRAINT "fk_pathways_grade_version" FOREIGN KEY ("grade_id","curriculum_version_id") REFERENCES "taxonomy"."grades"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."subjects" ADD CONSTRAINT "subjects_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "taxonomy"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."subjects" ADD CONSTRAINT "subjects_education_level_id_education_levels_id_fk" FOREIGN KEY ("education_level_id") REFERENCES "taxonomy"."education_levels"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."subjects" ADD CONSTRAINT "subjects_grade_id_grades_id_fk" FOREIGN KEY ("grade_id") REFERENCES "taxonomy"."grades"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."subjects" ADD CONSTRAINT "subjects_pathway_id_pathways_id_fk" FOREIGN KEY ("pathway_id") REFERENCES "taxonomy"."pathways"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."subjects" ADD CONSTRAINT "fk_subjects_grade_level" FOREIGN KEY ("grade_id","education_level_id") REFERENCES "taxonomy"."grades"("id","education_level_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."subjects" ADD CONSTRAINT "fk_subjects_grade_version" FOREIGN KEY ("grade_id","curriculum_version_id") REFERENCES "taxonomy"."grades"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."subjects" ADD CONSTRAINT "fk_subjects_pathway_grade" FOREIGN KEY ("pathway_id","grade_id") REFERENCES "taxonomy"."pathways"("id","grade_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."topics" ADD CONSTRAINT "topics_curriculum_version_id_curriculum_versions_id_fk" FOREIGN KEY ("curriculum_version_id") REFERENCES "taxonomy"."curriculum_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."topics" ADD CONSTRAINT "topics_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "taxonomy"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."topics" ADD CONSTRAINT "fk_topics_subject_version" FOREIGN KEY ("subject_id","curriculum_version_id") REFERENCES "taxonomy"."subjects"("id","curriculum_version_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "taxonomy"."topics" ADD CONSTRAINT "fk_topics_parent_subject" FOREIGN KEY ("parent_id","subject_id") REFERENCES "taxonomy"."topics"("id","subject_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_curricula_country_id" ON "taxonomy"."curricula" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "idx_curricula_slug" ON "taxonomy"."curricula" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_curricula_status" ON "taxonomy"."curricula" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_curriculum_versions_curriculum_id" ON "taxonomy"."curriculum_versions" USING btree ("curriculum_id");--> statement-breakpoint
CREATE INDEX "idx_curriculum_versions_country_id" ON "taxonomy"."curriculum_versions" USING btree ("country_id");--> statement-breakpoint
CREATE INDEX "idx_curriculum_versions_status" ON "taxonomy"."curriculum_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_curriculum_versions_slug" ON "taxonomy"."curriculum_versions" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "idx_education_levels_version_id" ON "taxonomy"."education_levels" USING btree ("curriculum_version_id");--> statement-breakpoint
CREATE INDEX "idx_education_levels_seq" ON "taxonomy"."education_levels" USING btree ("sequence_order");--> statement-breakpoint
CREATE INDEX "idx_education_levels_status" ON "taxonomy"."education_levels" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_grades_version_id" ON "taxonomy"."grades" USING btree ("curriculum_version_id");--> statement-breakpoint
CREATE INDEX "idx_grades_level_id" ON "taxonomy"."grades" USING btree ("education_level_id");--> statement-breakpoint
CREATE INDEX "idx_grades_seq" ON "taxonomy"."grades" USING btree ("sequence_order");--> statement-breakpoint
CREATE INDEX "idx_grades_status" ON "taxonomy"."grades" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_pathways_grade_id" ON "taxonomy"."pathways" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "idx_pathways_version_id" ON "taxonomy"."pathways" USING btree ("curriculum_version_id");--> statement-breakpoint
CREATE INDEX "idx_pathways_status" ON "taxonomy"."pathways" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subjects_grade_no_pathway_slug" ON "taxonomy"."subjects" USING btree ("grade_id","slug") WHERE "taxonomy"."subjects"."pathway_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subjects_grade_pathway_slug" ON "taxonomy"."subjects" USING btree ("grade_id","pathway_id","slug") WHERE "taxonomy"."subjects"."pathway_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subjects_grade_no_pathway_seq" ON "taxonomy"."subjects" USING btree ("grade_id","sequence_order") WHERE "taxonomy"."subjects"."pathway_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_subjects_grade_pathway_seq" ON "taxonomy"."subjects" USING btree ("grade_id","pathway_id","sequence_order") WHERE "taxonomy"."subjects"."pathway_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_subjects_grade_id" ON "taxonomy"."subjects" USING btree ("grade_id");--> statement-breakpoint
CREATE INDEX "idx_subjects_pathway_id" ON "taxonomy"."subjects" USING btree ("pathway_id");--> statement-breakpoint
CREATE INDEX "idx_subjects_version_id" ON "taxonomy"."subjects" USING btree ("curriculum_version_id");--> statement-breakpoint
CREATE INDEX "idx_subjects_status" ON "taxonomy"."subjects" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_topics_subject_no_parent_slug" ON "taxonomy"."topics" USING btree ("subject_id","slug") WHERE "taxonomy"."topics"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_topics_parent_slug" ON "taxonomy"."topics" USING btree ("parent_id","slug") WHERE "taxonomy"."topics"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_topics_subject_no_parent_seq" ON "taxonomy"."topics" USING btree ("subject_id","sequence_order") WHERE "taxonomy"."topics"."parent_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_topics_parent_seq" ON "taxonomy"."topics" USING btree ("parent_id","sequence_order") WHERE "taxonomy"."topics"."parent_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "idx_topics_subject_id" ON "taxonomy"."topics" USING btree ("subject_id");--> statement-breakpoint
CREATE INDEX "idx_topics_parent_id" ON "taxonomy"."topics" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "idx_topics_version_id" ON "taxonomy"."topics" USING btree ("curriculum_version_id");--> statement-breakpoint
CREATE INDEX "idx_topics_status" ON "taxonomy"."topics" USING btree ("status");