CREATE TYPE "public"."expense_kind" AS ENUM('expense', 'mileage');--> statement-breakpoint
ALTER TYPE "public"."invoice_line_kind" ADD VALUE 'expense' BEFORE 'milestone';--> statement-breakpoint
CREATE TABLE "expense_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"vat_bp" integer DEFAULT 2500 NOT NULL,
	"vat_deductible_bp" integer DEFAULT 10000 NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"date" date NOT NULL,
	"kind" "expense_kind" NOT NULL,
	"project_id" uuid,
	"expense_type_id" uuid,
	"description" text NOT NULL,
	"currency" char(3) DEFAULT 'DKK' NOT NULL,
	"gross_amount" bigint NOT NULL,
	"vat_amount" bigint DEFAULT 0 NOT NULL,
	"net_amount" bigint NOT NULL,
	"cost_amount" bigint NOT NULL,
	"billable" boolean DEFAULT false NOT NULL,
	"markup_bp" integer DEFAULT 0 NOT NULL,
	"km" numeric(8, 1),
	"from_place" text,
	"to_place" text,
	"receipt_file_id" uuid,
	"status" "entry_status" DEFAULT 'draft' NOT NULL,
	"reject_comment" text,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"invoice_line_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expenses_billable_needs_project" CHECK (not "expenses"."billable" or "expenses"."project_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mileage_rates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"high_rate" bigint NOT NULL,
	"low_rate" bigint NOT NULL,
	"threshold_km" integer DEFAULT 20000 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_types" ADD CONSTRAINT "expense_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_expense_type_id_expense_types_id_fk" FOREIGN KEY ("expense_type_id") REFERENCES "public"."expense_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_file_id_files_id_fk" FOREIGN KEY ("receipt_file_id") REFERENCES "public"."files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mileage_rates" ADD CONSTRAINT "mileage_rates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_user_date_idx" ON "expenses" USING btree ("tenant_id","user_id","date");--> statement-breakpoint
CREATE INDEX "expenses_project_idx" ON "expenses" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mileage_rates_tenant_year_uq" ON "mileage_rates" USING btree ("tenant_id","year");