ALTER TABLE "expenses" ADD COLUMN "bill_amount" bigint;--> statement-breakpoint
ALTER TABLE "mileage_rates" ADD COLUMN "customer_rate" bigint DEFAULT 450 NOT NULL;--> statement-breakpoint
UPDATE "expenses" e SET "bill_amount" = round(e."km" * r."customer_rate") FROM "mileage_rates" r WHERE e."kind" = 'mileage' AND e."km" IS NOT NULL AND e."bill_amount" IS NULL AND r."tenant_id" = e."tenant_id" AND r."year" = extract(year from e."date")::int;
