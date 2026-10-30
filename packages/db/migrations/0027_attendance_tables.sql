CREATE TABLE "attendance_code_uses" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"window" bigint NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_code_uses_pkey" PRIMARY KEY("tenant_id","membership_id","site_id","window")
);
--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attendance_corrections_kind" CHECK ("attendance_corrections"."kind" in ('in', 'out')),
	CONSTRAINT "attendance_corrections_status" CHECK ("attendance_corrections"."status" in ('pending', 'approved', 'rejected')),
	CONSTRAINT "attendance_corrections_reason" CHECK (length(trim("attendance_corrections"."reason")) between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "attendance_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"site_id" uuid,
	"correction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_events_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "attendance_events_correction_key" UNIQUE("tenant_id","correction_id"),
	CONSTRAINT "attendance_events_kind" CHECK ("attendance_events"."kind" in ('in', 'out')),
	CONSTRAINT "attendance_events_method" CHECK ("attendance_events"."method" in ('qr', 'web', 'manual')),
	CONSTRAINT "attendance_events_qr_site" CHECK ("attendance_events"."method" <> 'qr' or "attendance_events"."site_id" is not null),
	CONSTRAINT "attendance_events_manual" CHECK (("attendance_events"."method" = 'manual') = ("attendance_events"."correction_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "attendance_sites" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_sites_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "company_settings" (
	"tenant_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_settings_pkey" PRIMARY KEY("tenant_id","key"),
	CONSTRAINT "company_settings_key" CHECK ("company_settings"."key" ~ '^[a-z][a-z0-9_.]{1,79}$')
);
--> statement-breakpoint
CREATE TABLE "shift_assignments" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"shift_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shift_assignments_pkey" PRIMARY KEY("tenant_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "shifts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	"grace_minutes" integer DEFAULT 10 NOT NULL,
	"break_minutes" integer DEFAULT 60 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shifts_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "shifts_order" CHECK ("shifts"."end_time" > "shifts"."start_time"),
	CONSTRAINT "shifts_minutes" CHECK ("shifts"."grace_minutes" between 0 and 240 and "shifts"."break_minutes" between 0 and 480)
);
--> statement-breakpoint
ALTER TABLE "attendance_code_uses" ADD CONSTRAINT "attendance_code_uses_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_code_uses" ADD CONSTRAINT "attendance_code_uses_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."attendance_sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_site_fk" FOREIGN KEY ("tenant_id","site_id") REFERENCES "public"."attendance_sites"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_events" ADD CONSTRAINT "attendance_events_correction_fk" FOREIGN KEY ("tenant_id","correction_id") REFERENCES "public"."attendance_corrections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sites" ADD CONSTRAINT "attendance_sites_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_assignments" ADD CONSTRAINT "shift_assignments_shift_fk" FOREIGN KEY ("tenant_id","shift_id") REFERENCES "public"."shifts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_member_idx" ON "attendance_corrections" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "attendance_events_member_at_idx" ON "attendance_events" USING btree ("tenant_id","membership_id","at");