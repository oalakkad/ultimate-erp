CREATE TABLE "platform_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" text NOT NULL,
	"target_tenant_id" uuid,
	"request_id" text,
	"ip_address" "inet",
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "platform_audit_events_action_format" CHECK ("platform_audit_events"."action" ~ '^platform(\.[a-z_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "platform_operators" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'founder' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"granted_by" text NOT NULL,
	CONSTRAINT "platform_operators_role_valid" CHECK ("platform_operators"."role" in ('founder'))
);
--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_audit_events" ADD CONSTRAINT "platform_audit_events_target_tenant_id_tenants_id_fk" FOREIGN KEY ("target_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_operators" ADD CONSTRAINT "platform_operators_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_audit_events_time_idx" ON "platform_audit_events" USING btree ("occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);