CREATE TABLE "time_entries" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"timesheet_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"work_date" date NOT NULL,
	"hours" numeric(5, 2) NOT NULL,
	"billable" boolean NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rejection_reason" text,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_entries_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "time_entries_hours_range" CHECK ("time_entries"."hours" > 0 and "time_entries"."hours" <= 24),
	CONSTRAINT "time_entries_status_valid" CHECK ("time_entries"."status" in ('draft', 'submitted', 'approved', 'rejected')),
	CONSTRAINT "time_entries_description_length" CHECK (length("time_entries"."description") <= 2000),
	CONSTRAINT "time_entries_rejection_reason" CHECK ("time_entries"."status" <> 'rejected' or "time_entries"."rejection_reason" is not null)
);
--> statement-breakpoint
CREATE TABLE "time_timers" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "time_timers_pkey" PRIMARY KEY("tenant_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "timesheets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"week_start" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"submitted_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "timesheets_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "timesheets_tenant_member_id_key" UNIQUE("tenant_id","membership_id","id"),
	CONSTRAINT "timesheets_tenant_member_week_key" UNIQUE("tenant_id","membership_id","week_start"),
	CONSTRAINT "timesheets_week_is_sunday" CHECK (extract(dow from "timesheets"."week_start") = 0),
	CONSTRAINT "timesheets_status_valid" CHECK ("timesheets"."status" in ('draft', 'submitted', 'approved', 'rejected'))
);
--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_timesheet_fk" FOREIGN KEY ("tenant_id","membership_id","timesheet_id") REFERENCES "public"."timesheets"("tenant_id","membership_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_task_fk" FOREIGN KEY ("tenant_id","project_id","task_id") REFERENCES "public"."tasks"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_allocation_fk" FOREIGN KEY ("tenant_id","task_id","membership_id") REFERENCES "public"."task_allocations"("tenant_id","task_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_timers" ADD CONSTRAINT "time_timers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_timers" ADD CONSTRAINT "time_timers_task_fk" FOREIGN KEY ("tenant_id","project_id","task_id") REFERENCES "public"."tasks"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_timers" ADD CONSTRAINT "time_timers_allocation_fk" FOREIGN KEY ("tenant_id","task_id","membership_id") REFERENCES "public"."task_allocations"("tenant_id","task_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "time_entries_timesheet_idx" ON "time_entries" USING btree ("tenant_id","timesheet_id");--> statement-breakpoint
CREATE INDEX "time_entries_project_idx" ON "time_entries" USING btree ("tenant_id","project_id","status");--> statement-breakpoint
CREATE INDEX "time_entries_task_idx" ON "time_entries" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "time_entries_member_date_idx" ON "time_entries" USING btree ("tenant_id","membership_id","work_date");