ALTER TABLE "time_entries" ADD COLUMN "pm_approved_by" uuid;--> statement-breakpoint
ALTER TABLE "time_entries" ADD COLUMN "pm_approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_pm_approved_by_users_id_fk" FOREIGN KEY ("pm_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;