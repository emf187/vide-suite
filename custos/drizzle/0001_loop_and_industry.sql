CREATE TYPE "public"."custos_org_industry" AS ENUM('food_beverage', 'field_services', 'software_it', 'cleaning', 'retail', 'other');--> statement-breakpoint
ALTER TYPE "public"."custos_evidence_kind" ADD VALUE 'video' BEFORE 'number';--> statement-breakpoint
ALTER TYPE "public"."custos_evidence_kind" ADD VALUE 'audio' BEFORE 'number';--> statement-breakpoint
ALTER TYPE "public"."custos_evidence_kind" ADD VALUE 'document' BEFORE 'number';--> statement-breakpoint
ALTER TYPE "public"."custos_evidence_kind" ADD VALUE 'signature' BEFORE 'number';--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "industry" "custos_org_industry" DEFAULT 'other' NOT NULL;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "evidence_spec" jsonb DEFAULT '[]'::jsonb NOT NULL;