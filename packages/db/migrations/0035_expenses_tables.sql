CREATE TABLE "expense_claims" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text,
	"membership_id" uuid NOT NULL,
	"title" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'KWD' NOT NULL,
	"total" numeric(20, 3) DEFAULT '0' NOT NULL,
	"submitted_at" timestamp with time zone,
	"decided_by_membership_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"reimbursed_by_membership_id" uuid,
	"reimbursed_on" date,
	"reimbursement_method" text,
	"reimbursement_reference" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_claims_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_claims_status" CHECK ("expense_claims"."status" in ('draft', 'submitted', 'approved', 'rejected', 'reimbursed')),
	CONSTRAINT "expense_claims_currency" CHECK ("expense_claims"."currency" = 'KWD'),
	CONSTRAINT "expense_claims_total" CHECK ("expense_claims"."total" >= 0),
	CONSTRAINT "expense_claims_title" CHECK (length(trim("expense_claims"."title")) between 1 and 200),
	CONSTRAINT "expense_claims_not_own_decision" CHECK ("expense_claims"."decided_by_membership_id" is null or "expense_claims"."decided_by_membership_id" <> "expense_claims"."membership_id"),
	CONSTRAINT "expense_claims_not_own_reimbursement" CHECK ("expense_claims"."reimbursed_by_membership_id" is null or "expense_claims"."reimbursed_by_membership_id" <> "expense_claims"."membership_id"),
	CONSTRAINT "expense_claims_submitted_has_number" CHECK ("expense_claims"."status" = 'draft' or "expense_claims"."number" is not null),
	CONSTRAINT "expense_claims_rejected_note" CHECK ("expense_claims"."status" <> 'rejected' or "expense_claims"."decision_note" is not null),
	CONSTRAINT "expense_claims_reimbursed_fields" CHECK ("expense_claims"."status" <> 'reimbursed' or ("expense_claims"."reimbursed_on" is not null and "expense_claims"."reimbursement_method" is not null and "expense_claims"."reimbursed_by_membership_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "expense_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"claim_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"spent_on" date NOT NULL,
	"category" text NOT NULL,
	"description" text NOT NULL,
	"amount" numeric(20, 3) NOT NULL,
	"project_id" uuid,
	"billable" boolean DEFAULT false NOT NULL,
	"receipt_file_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "expense_lines_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "expense_lines_amount" CHECK ("expense_lines"."amount" > 0 and "expense_lines"."amount" <= 100000),
	CONSTRAINT "expense_lines_description" CHECK (length(trim("expense_lines"."description")) between 1 and 500),
	CONSTRAINT "expense_lines_billable_project" CHECK (not "expense_lines"."billable" or "expense_lines"."project_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "invoice_expense_lines" (
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"expense_line_id" uuid NOT NULL,
	CONSTRAINT "invoice_expense_lines_pkey" PRIMARY KEY("tenant_id","expense_line_id")
);
--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_member_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_decider_fk" FOREIGN KEY ("tenant_id","decided_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_claims" ADD CONSTRAINT "expense_claims_reimburser_fk" FOREIGN KEY ("tenant_id","reimbursed_by_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_claim_fk" FOREIGN KEY ("tenant_id","claim_id") REFERENCES "public"."expense_claims"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_lines" ADD CONSTRAINT "expense_lines_receipt_fk" FOREIGN KEY ("tenant_id","receipt_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_expense_lines" ADD CONSTRAINT "invoice_expense_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_expense_lines" ADD CONSTRAINT "invoice_expense_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_expense_lines" ADD CONSTRAINT "invoice_expense_lines_line_fk" FOREIGN KEY ("tenant_id","expense_line_id") REFERENCES "public"."expense_lines"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_claims_tenant_number_key" ON "expense_claims" USING btree ("tenant_id","number") WHERE number is not null;--> statement-breakpoint
CREATE INDEX "expense_claims_tenant_member_idx" ON "expense_claims" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "expense_claims_tenant_status_idx" ON "expense_claims" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "expense_lines_claim_idx" ON "expense_lines" USING btree ("tenant_id","claim_id");--> statement-breakpoint
CREATE INDEX "expense_lines_project_idx" ON "expense_lines" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "invoice_expense_lines_invoice_idx" ON "invoice_expense_lines" USING btree ("tenant_id","invoice_id");