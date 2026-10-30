CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "departments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "departments_names" CHECK (length(trim("departments"."name_en")) between 1 and 200 and length(trim("departments"."name_ar")) between 1 and 200)
);
--> statement-breakpoint
CREATE TABLE "employee_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"done_at" timestamp with time zone,
	"done_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_checklist_items_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "employee_checklist_items_kind_valid" CHECK ("employee_checklist_items"."kind" in ('onboarding', 'offboarding'))
);
--> statement-breakpoint
CREATE TABLE "employee_documents" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"confidential" boolean DEFAULT true NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_documents_pkey" PRIMARY KEY("tenant_id","membership_id","file_id"),
	CONSTRAINT "employee_documents_tenant_file_key" UNIQUE("tenant_id","file_id"),
	CONSTRAINT "employee_documents_category_valid" CHECK ("employee_documents"."category" in ('contract', 'identity', 'certificate', 'other'))
);
--> statement-breakpoint
CREATE TABLE "employee_emergency_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"sealed" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_emergency_contacts_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "employee_history" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"changes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"changed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_history_tenant_id_key" UNIQUE("tenant_id","id")
);
--> statement-breakpoint
CREATE TABLE "employee_private" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"sealed" text NOT NULL,
	"civil_id_hash" text,
	"updated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employee_private_pkey" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "employee_private_civil_id_key" UNIQUE("tenant_id","civil_id_hash")
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"number" text NOT NULL,
	"job_title_en" text DEFAULT '' NOT NULL,
	"job_title_ar" text DEFAULT '' NOT NULL,
	"department_id" uuid,
	"manager_membership_id" uuid,
	"status" text DEFAULT 'onboarding' NOT NULL,
	"employment_type" text DEFAULT 'full_time' NOT NULL,
	"join_date" date,
	"leave_date" date,
	"weekly_hours" numeric(5, 2) DEFAULT '40' NOT NULL,
	"work_days" integer[] DEFAULT '{0,1,2,3,4}'::integer[] NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_pkey" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "employees_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "employees_not_own_manager" CHECK ("employees"."manager_membership_id" is null or "employees"."manager_membership_id" <> "employees"."membership_id"),
	CONSTRAINT "employees_status_valid" CHECK ("employees"."status" in ('onboarding', 'active', 'on_leave', 'offboarding', 'left')),
	CONSTRAINT "employees_type_valid" CHECK ("employees"."employment_type" in ('full_time', 'part_time', 'contractor', 'intern')),
	CONSTRAINT "employees_dates_ordered" CHECK ("employees"."leave_date" is null or "employees"."join_date" is null or "employees"."leave_date" >= "employees"."join_date"),
	CONSTRAINT "employees_left_has_date" CHECK ("employees"."status" <> 'left' or "employees"."leave_date" is not null),
	CONSTRAINT "employees_weekly_hours" CHECK ("employees"."weekly_hours" >= 0 and "employees"."weekly_hours" <= 80),
	CONSTRAINT "employees_work_days" CHECK ("employees"."work_days" <@ '{0,1,2,3,4,5,6}'::integer[])
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"tenant_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_members_pkey" PRIMARY KEY("tenant_id","team_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"department_id" uuid,
	"lead_membership_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teams_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "teams_names" CHECK (length(trim("teams"."name_en")) between 1 and 200 and length(trim("teams"."name_ar")) between 1 and 200)
);
--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_checklist_items" ADD CONSTRAINT "employee_checklist_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_checklist_items" ADD CONSTRAINT "employee_checklist_items_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_emergency_contacts" ADD CONSTRAINT "employee_emergency_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_emergency_contacts" ADD CONSTRAINT "employee_emergency_contacts_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_history" ADD CONSTRAINT "employee_history_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_private" ADD CONSTRAINT "employee_private_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_private" ADD CONSTRAINT "employee_private_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_manager_fk" FOREIGN KEY ("tenant_id","manager_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_department_fk" FOREIGN KEY ("tenant_id","department_id") REFERENCES "public"."departments"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_lead_fk" FOREIGN KEY ("tenant_id","lead_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_checklist_items_member_idx" ON "employee_checklist_items" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "employee_history_member_idx" ON "employee_history" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "employees_manager_idx" ON "employees" USING btree ("tenant_id","manager_membership_id");--> statement-breakpoint
CREATE INDEX "team_members_membership_idx" ON "team_members" USING btree ("tenant_id","membership_id");