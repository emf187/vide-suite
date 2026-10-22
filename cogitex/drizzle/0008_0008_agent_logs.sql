CREATE TABLE IF NOT EXISTS "agent_tool_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid,
	"status" text DEFAULT 'read' NOT NULL,
	"tool" text NOT NULL,
	"args" jsonb,
	"result" jsonb,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"via" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tool_logs" ADD CONSTRAINT "agent_tool_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "agent_tool_logs" ADD CONSTRAINT "agent_tool_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_logs_org_created_idx" ON "agent_tool_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_tool_logs_user_idx" ON "agent_tool_logs" USING btree ("user_id");