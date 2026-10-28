CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_user_id" uuid,
	"actor_membership_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"request_id" text,
	"ip_address" "inet",
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "audit_events_action_format" CHECK ("audit_events"."action" ~ '^[a-z_]+(\.[a-z_]+)+$')
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"invited_by_membership_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_membership_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invitations_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invitations_email_lowercase" CHECK ("invitations"."email" = lower("invitations"."email")),
	CONSTRAINT "invitations_role_format" CHECK ("invitations"."role" ~ '^[a-z_]{2,40}$'),
	CONSTRAINT "invitations_status_valid" CHECK ("invitations"."status" in ('pending', 'accepted', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "membership_roles" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"role" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "membership_roles_tenant_id_membership_id_role_pk" PRIMARY KEY("tenant_id","membership_id","role"),
	CONSTRAINT "membership_roles_role_format" CHECK ("membership_roles"."role" ~ '^[a-z_]{2,40}$')
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_fk" FOREIGN KEY ("tenant_id","invited_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_membership_fk" FOREIGN KEY ("tenant_id","accepted_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_roles" ADD CONSTRAINT "membership_roles_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_tenant_time_idx" ON "audit_events" USING btree ("tenant_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "invitations_tenant_email_idx" ON "invitations" USING btree ("tenant_id","email");