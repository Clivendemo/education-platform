-- Migration 0014: Enforce 1,000 character maximum limit on resource_feedback details
ALTER TABLE "content"."resource_feedback" DROP CONSTRAINT IF EXISTS "chk_feedback_details_len";
--> statement-breakpoint
ALTER TABLE "content"."resource_feedback" ADD CONSTRAINT "chk_feedback_details_len"
  CHECK (details IS NULL OR (length(trim(details)) > 0 AND length(details) <= 1000));
