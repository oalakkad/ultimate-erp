CREATE TABLE "payroll_inputs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"value" numeric(20, 3) NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_inputs_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payroll_inputs_kind" CHECK ("payroll_inputs"."kind" in ('overtime_hours', 'bonus', 'advance', 'addition', 'deduction')),
	CONSTRAINT "payroll_inputs_value" CHECK ("payroll_inputs"."value" > 0)
);
--> statement-breakpoint
CREATE TABLE "payroll_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"effective_from" date NOT NULL,
	"rules" jsonb NOT NULL,
	"to_verify" boolean DEFAULT true NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_rule_sets_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payroll_rule_sets_tenant_version_key" UNIQUE("tenant_id","version")
);
--> statement-breakpoint
CREATE TABLE "payroll_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"period" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"rule_set_id" uuid,
	"prepared_by_user_id" uuid NOT NULL,
	"calculated_at" timestamp with time zone,
	"submitted_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"paid_by_user_id" uuid,
	"paid_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payroll_runs_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payroll_runs_period" CHECK ("payroll_runs"."period" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "payroll_runs_status" CHECK ("payroll_runs"."status" in ('draft', 'calculated', 'submitted', 'approved', 'paid', 'cancelled')),
	CONSTRAINT "payroll_runs_approver_not_preparer" CHECK ("payroll_runs"."approved_by_user_id" is null or "payroll_runs"."approved_by_user_id" <> "payroll_runs"."prepared_by_user_id"),
	CONSTRAINT "payroll_runs_payer_not_preparer" CHECK ("payroll_runs"."paid_by_user_id" is null or "payroll_runs"."paid_by_user_id" <> "payroll_runs"."prepared_by_user_id"),
	CONSTRAINT "payroll_runs_paid_needs_approval" CHECK ("payroll_runs"."status" <> 'paid' or ("payroll_runs"."approved_by_user_id" is not null and "payroll_runs"."paid_by_user_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"salary_record_id" uuid NOT NULL,
	"gross" numeric(20, 3) NOT NULL,
	"deductions" numeric(20, 3) NOT NULL,
	"net" numeric(20, 3) NOT NULL,
	"currency" text DEFAULT 'KWD' NOT NULL,
	"lines" jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payslips_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payslips_run_member_key" UNIQUE("tenant_id","run_id","membership_id"),
	CONSTRAINT "payslips_net" CHECK ("payslips"."net" >= 0)
);
--> statement-breakpoint
CREATE TABLE "salary_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"effective_from" date NOT NULL,
	"basic" numeric(20, 3) NOT NULL,
	"currency" text DEFAULT 'KWD' NOT NULL,
	"allowances" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"social_insurance" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "salary_records_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "salary_records_member_effective_key" UNIQUE("tenant_id","membership_id","effective_from"),
	CONSTRAINT "salary_records_basic" CHECK ("salary_records"."basic" >= 0),
	CONSTRAINT "salary_records_currency" CHECK ("salary_records"."currency" = 'KWD')
);
--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."payroll_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_inputs" ADD CONSTRAINT "payroll_inputs_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_rule_sets" ADD CONSTRAINT "payroll_rule_sets_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_rule_set_fk" FOREIGN KEY ("tenant_id","rule_set_id") REFERENCES "public"."payroll_rule_sets"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_prepared_by_fk" FOREIGN KEY ("tenant_id","prepared_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_fk" FOREIGN KEY ("tenant_id","run_id") REFERENCES "public"."payroll_runs"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_salary_fk" FOREIGN KEY ("tenant_id","salary_record_id") REFERENCES "public"."salary_records"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "salary_records" ADD CONSTRAINT "salary_records_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payroll_inputs_run_idx" ON "payroll_inputs" USING btree ("tenant_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payroll_runs_tenant_period_live_key" ON "payroll_runs" USING btree ("tenant_id","period") WHERE status <> 'cancelled';