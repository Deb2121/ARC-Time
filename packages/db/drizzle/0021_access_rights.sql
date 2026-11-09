CREATE TABLE "user_rights" (
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"right" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_rights_user_id_right_pk" PRIMARY KEY("user_id","right")
);
--> statement-breakpoint
ALTER TABLE "user_rights" ADD CONSTRAINT "user_rights_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_rights" ADD CONSTRAINT "user_rights_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;