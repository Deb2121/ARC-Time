CREATE TYPE "public"."vehicle" AS ENUM('own', 'company');--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "vehicle" "vehicle";--> statement-breakpoint
UPDATE "expenses" SET "vehicle" = 'own' WHERE "kind" = 'mileage' AND "vehicle" IS NULL;--> statement-breakpoint
UPDATE "contracts" SET "name" = 'Medgået tid' WHERE "name" = 'Regning';
