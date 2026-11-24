-- D-038: one price per person per case, with where it came from (price list line or typed in by hand).
ALTER TABLE "project_employee_rates" ADD COLUMN "label" text;--> statement-breakpoint
-- Keep only the newest price if a person has several on the same case (approved hours keep their own snapshot).
DELETE FROM "project_employee_rates" r USING "project_employee_rates" newer
WHERE r.project_id = newer.project_id AND r.user_id = newer.user_id
  AND (r.valid_from, r.id) < (newer.valid_from, newer.id);--> statement-breakpoint
CREATE UNIQUE INDEX "project_employee_rates_member_uq" ON "project_employee_rates" USING btree ("project_id","user_id");
