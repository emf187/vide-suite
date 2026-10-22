CREATE TABLE IF NOT EXISTS "fault_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid,
	"vide_machine_name" text NOT NULL,
	"fault_type" text NOT NULL,
	"severity" text DEFAULT 'warning' NOT NULL,
	"description" text,
	"flagged_at" timestamp with time zone DEFAULT now() NOT NULL,
	"wo_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"acknowledged_by" uuid,
	"acknowledged_at" timestamp with time zone,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "vide_cache" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fault_events" ADD CONSTRAINT "fault_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fault_events" ADD CONSTRAINT "fault_events_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fault_events" ADD CONSTRAINT "fault_events_wo_id_work_orders_id_fk" FOREIGN KEY ("wo_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "fault_events" ADD CONSTRAINT "fault_events_acknowledged_by_users_id_fk" FOREIGN KEY ("acknowledged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "vide_cache" ADD CONSTRAINT "vide_cache_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fault_events_org_status_idx" ON "fault_events" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fault_events_org_created_idx" ON "fault_events" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "fault_events_machine_idx" ON "fault_events" USING btree ("machine_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "vide_cache_org_key_key" ON "vide_cache" USING btree ("organization_id","key");