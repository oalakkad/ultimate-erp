ALTER TABLE "projects" ADD CONSTRAINT "projects_tenant_client_id_key" UNIQUE("tenant_id","client_id","id");
--> statement-breakpoint
CREATE TABLE "credit_notes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(20, 3) NOT NULL,
	"reason" text NOT NULL,
	"issued_on" date NOT NULL,
	"issued_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_notes_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "credit_notes_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "credit_notes_amount" CHECK ("credit_notes"."amount" > 0),
	CONSTRAINT "credit_notes_reason" CHECK (length(trim("credit_notes"."reason")) between 1 and 1000)
);
--> statement-breakpoint

CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"description" text NOT NULL,
	"quantity" numeric(12, 2) NOT NULL,
	"unit_price" numeric(20, 3) NOT NULL,
	"discount_percent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"tax_code" text,
	"amount" numeric(20, 3) NOT NULL,
	"discount" numeric(20, 3) NOT NULL,
	"tax" numeric(20, 3) NOT NULL,
	CONSTRAINT "invoice_lines_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoice_lines_values" CHECK ("invoice_lines"."quantity" > 0 and "invoice_lines"."unit_price" >= 0 and "invoice_lines"."discount_percent" between 0 and 100),
	CONSTRAINT "invoice_lines_description" CHECK (length(trim("invoice_lines"."description")) between 1 and 500)
);
--> statement-breakpoint

CREATE TABLE "invoice_time_entries" (
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"time_entry_id" uuid NOT NULL,
	CONSTRAINT "invoice_time_entries_pkey" PRIMARY KEY("tenant_id","time_entry_id")
);
--> statement-breakpoint

CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text,
	"client_id" uuid NOT NULL,
	"contract_id" uuid,
	"project_id" uuid,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" text DEFAULT 'KWD' NOT NULL,
	"issue_date" date,
	"due_date" date,
	"subtotal" numeric(20, 3) DEFAULT '0' NOT NULL,
	"discount_total" numeric(20, 3) DEFAULT '0' NOT NULL,
	"tax_total" numeric(20, 3) DEFAULT '0' NOT NULL,
	"total" numeric(20, 3) DEFAULT '0' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"void_reason" text,
	"reminder_sent_on" date,
	"created_by_user_id" uuid NOT NULL,
	"issued_by_user_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "invoices_status" CHECK ("invoices"."status" in ('draft', 'issued', 'partially_paid', 'paid', 'void')),
	CONSTRAINT "invoices_currency" CHECK ("invoices"."currency" = 'KWD'),
	CONSTRAINT "invoices_issued_has_number" CHECK ("invoices"."status" = 'draft' or ("invoices"."number" is not null and "invoices"."issue_date" is not null and "invoices"."due_date" is not null)),
	CONSTRAINT "invoices_dates" CHECK ("invoices"."due_date" is null or "invoices"."issue_date" is null or "invoices"."due_date" >= "invoices"."issue_date"),
	CONSTRAINT "invoices_void_reason" CHECK ("invoices"."status" <> 'void' or "invoices"."void_reason" is not null),
	CONSTRAINT "invoices_amounts" CHECK ("invoices"."total" >= 0 and "invoices"."subtotal" >= 0 and "invoices"."discount_total" >= 0 and "invoices"."tax_total" >= 0)
);
--> statement-breakpoint

CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(20, 3) NOT NULL,
	"currency" text DEFAULT 'KWD' NOT NULL,
	"received_on" date NOT NULL,
	"method" text NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'recorded' NOT NULL,
	"status" text DEFAULT 'recorded' NOT NULL,
	"reverse_reason" text,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "payments_amount" CHECK ("payments"."amount" > 0),
	CONSTRAINT "payments_currency" CHECK ("payments"."currency" = 'KWD'),
	CONSTRAINT "payments_reverse_reason" CHECK ("payments"."status" <> 'reversed' or "payments"."reverse_reason" is not null)
);
--> statement-breakpoint

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "credit_notes" ADD CONSTRAINT "credit_notes_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoice_time_entries" ADD CONSTRAINT "invoice_time_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoice_time_entries" ADD CONSTRAINT "invoice_time_entries_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoice_time_entries" ADD CONSTRAINT "invoice_time_entries_entry_fk" FOREIGN KEY ("tenant_id","time_entry_id") REFERENCES "public"."time_entries"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_contract_client_fk" FOREIGN KEY ("tenant_id","client_id","contract_id") REFERENCES "public"."contracts"("tenant_id","client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_client_fk" FOREIGN KEY ("tenant_id","client_id","project_id") REFERENCES "public"."projects"("tenant_id","client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "invoices" ADD CONSTRAINT "invoices_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_fk" FOREIGN KEY ("tenant_id","invoice_id") REFERENCES "public"."invoices"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("tenant_id","invoice_id");--> statement-breakpoint

CREATE INDEX "invoice_time_entries_invoice_idx" ON "invoice_time_entries" USING btree ("tenant_id","invoice_id");--> statement-breakpoint

CREATE UNIQUE INDEX "invoices_tenant_number_key" ON "invoices" USING btree ("tenant_id","number") WHERE number is not null;--> statement-breakpoint

CREATE INDEX "invoices_tenant_client_idx" ON "invoices" USING btree ("tenant_id","client_id");--> statement-breakpoint

CREATE INDEX "invoices_tenant_status_idx" ON "invoices" USING btree ("tenant_id","status","due_date");--> statement-breakpoint

CREATE INDEX "payments_invoice_idx" ON "payments" USING btree ("tenant_id","invoice_id");