CREATE TABLE IF NOT EXISTS "repair_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"repair_request_id" uuid NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"payload" jsonb,
	"actor" text DEFAULT 'webhook' NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repair_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"machine_id" uuid,
	"machine_snapshot" jsonb,
	"fault_event_id" uuid,
	"work_order_id" uuid,
	"brief" jsonb NOT NULL,
	"confirmed_brief" jsonb,
	"urgency" text DEFAULT 'medium' NOT NULL,
	"compiled_by" uuid,
	"status" text DEFAULT 'compiled' NOT NULL,
	"marketplace_request_id" text,
	"technician_id" uuid,
	"quote_kobo" integer,
	"quote_currency" text,
	"eta_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"accepted_at" timestamp with time zone,
	"en_route_at" timestamp with time zone,
	"on_site_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"outcome_summary" text,
	"rating" integer,
	"rating_note" text,
	"cancelled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "technician_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"marketplace_technician_id" text NOT NULL,
	"display_name" text NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rating_avg" numeric(3, 2),
	"jobs_completed" integer DEFAULT 0 NOT NULL,
	"verified_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_request_events" ADD CONSTRAINT "repair_request_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_request_events" ADD CONSTRAINT "repair_request_events_repair_request_id_repair_requests_id_fk" FOREIGN KEY ("repair_request_id") REFERENCES "public"."repair_requests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_machine_id_machines_id_fk" FOREIGN KEY ("machine_id") REFERENCES "public"."machines"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_fault_event_id_fault_events_id_fk" FOREIGN KEY ("fault_event_id") REFERENCES "public"."fault_events"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_work_order_id_work_orders_id_fk" FOREIGN KEY ("work_order_id") REFERENCES "public"."work_orders"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_compiled_by_users_id_fk" FOREIGN KEY ("compiled_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_technician_id_technician_profiles_id_fk" FOREIGN KEY ("technician_id") REFERENCES "public"."technician_profiles"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "technician_profiles" ADD CONSTRAINT "technician_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_request_events_req_idx" ON "repair_request_events" USING btree ("repair_request_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_requests_org_status_idx" ON "repair_requests" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repair_requests_org_machine_idx" ON "repair_requests" USING btree ("organization_id","machine_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repair_requests_mrqid_key" ON "repair_requests" USING btree ("marketplace_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "technician_profiles_org_mid_key" ON "technician_profiles" USING btree ("organization_id","marketplace_technician_id");