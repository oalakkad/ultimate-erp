CREATE TABLE "announcement_emails" (
	"tenant_id" uuid NOT NULL,
	"announcement_id" uuid NOT NULL,
	"delivery_id" uuid NOT NULL,
	CONSTRAINT "announcement_emails_pkey" PRIMARY KEY("tenant_id","announcement_id","delivery_id")
);
--> statement-breakpoint
CREATE TABLE "announcements" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"body_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"recipients" integer NOT NULL,
	"published_by_user_id" uuid NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "announcements_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "announcements_recipients" CHECK ("announcements"."recipients" >= 0)
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"type" text NOT NULL,
	"in_app" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_preferences_pkey" PRIMARY KEY("tenant_id","membership_id","type")
);
--> statement-breakpoint
ALTER TABLE "announcement_emails" ADD CONSTRAINT "announcement_emails_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_emails" ADD CONSTRAINT "announcement_emails_delivery_id_email_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."email_deliveries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcement_emails" ADD CONSTRAINT "announcement_emails_announcement_fk" FOREIGN KEY ("tenant_id","announcement_id") REFERENCES "public"."announcements"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_published_by_fk" FOREIGN KEY ("tenant_id","published_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "announcements_tenant_published_idx" ON "announcements" USING btree ("tenant_id","published_at");