ALTER TABLE "tenants" ADD COLUMN "go_live_date" date DEFAULT current_date NOT NULL;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "approval_mode" text DEFAULT 'line_manager' NOT NULL;