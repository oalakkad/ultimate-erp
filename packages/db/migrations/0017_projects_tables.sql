-- Needed first: projects reference contracts by (tenant_id, client_id, id).
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_client_id_key" UNIQUE("tenant_id","client_id","id");--> statement-breakpoint
CREATE TABLE "project_budget_revisions" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"revision_no" integer NOT NULL,
	"budget_hours" numeric(10, 2) NOT NULL,
	"budget_amount" numeric(20, 3),
	"reason" text NOT NULL,
	"changed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_budget_revisions_pkey" PRIMARY KEY("tenant_id","project_id","revision_no"),
	CONSTRAINT "project_budget_revisions_positive" CHECK ("project_budget_revisions"."revision_no" > 0),
	CONSTRAINT "project_budget_revisions_reason" CHECK (length(trim("project_budget_revisions"."reason")) between 1 and 1000)
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_documents_pkey" PRIMARY KEY("tenant_id","project_id","file_id"),
	CONSTRAINT "project_documents_tenant_file_key" UNIQUE("tenant_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_members_pkey" PRIMARY KEY("tenant_id","project_id","membership_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"client_id" uuid NOT NULL,
	"contract_id" uuid,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"description" text,
	"manager_membership_id" uuid NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"start_date" date,
	"end_date" date,
	"billing_method" text DEFAULT 'time_and_materials' NOT NULL,
	"budget_hours" numeric(10, 2) NOT NULL,
	"budget_amount" numeric(20, 3),
	"currency" text DEFAULT 'KWD' NOT NULL,
	"budget_revision" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "projects_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "projects_status_valid" CHECK ("projects"."status" in ('planned', 'active', 'on_hold', 'completed', 'cancelled')),
	CONSTRAINT "projects_billing_valid" CHECK ("projects"."billing_method" in ('fixed_price', 'time_and_materials', 'retainer', 'non_billable')),
	CONSTRAINT "projects_dates_ordered" CHECK ("projects"."end_date" is null or "projects"."start_date" is null or "projects"."end_date" >= "projects"."start_date"),
	CONSTRAINT "projects_budget_nonnegative" CHECK ("projects"."budget_hours" >= 0 and ("projects"."budget_amount" is null or "projects"."budget_amount" >= 0)),
	CONSTRAINT "projects_currency_code" CHECK ("projects"."currency" ~ '^[A-Z]{3}$')
);
--> statement-breakpoint
ALTER TABLE "project_budget_revisions" ADD CONSTRAINT "project_budget_revisions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_revisions" ADD CONSTRAINT "project_budget_revisions_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_budget_revisions" ADD CONSTRAINT "project_budget_revisions_author_fk" FOREIGN KEY ("tenant_id","changed_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_added_by_fk" FOREIGN KEY ("tenant_id","added_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_membership_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_added_by_fk" FOREIGN KEY ("tenant_id","added_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_contract_same_client_fk" FOREIGN KEY ("tenant_id","client_id","contract_id") REFERENCES "public"."contracts"("tenant_id","client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_manager_fk" FOREIGN KEY ("tenant_id","manager_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "project_members_membership_idx" ON "project_members" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "projects_tenant_client_idx" ON "projects" USING btree ("tenant_id","client_id");
