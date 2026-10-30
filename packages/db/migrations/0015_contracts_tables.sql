CREATE TABLE "contract_templates" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"body_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"archived_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_templates_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "contract_templates_kind_valid" CHECK ("contract_templates"."kind" in ('contract', 'engagement_letter')),
	CONSTRAINT "contract_templates_body_length" CHECK (length("contract_templates"."body_en") <= 100000 and length("contract_templates"."body_ar") <= 100000)
);
--> statement-breakpoint
CREATE TABLE "contract_versions" (
	"tenant_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"body_en" text NOT NULL,
	"body_ar" text NOT NULL,
	"change_note" text,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contract_versions_pkey" PRIMARY KEY("tenant_id","contract_id","version_no"),
	CONSTRAINT "contract_versions_positive" CHECK ("contract_versions"."version_no" > 0),
	CONSTRAINT "contract_versions_body_length" CHECK (length("contract_versions"."body_en") <= 100000 and length("contract_versions"."body_ar") <= 100000)
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"number" text NOT NULL,
	"client_id" uuid NOT NULL,
	"template_id" uuid,
	"title_en" text NOT NULL,
	"title_ar" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"start_date" date,
	"end_date" date,
	"value_amount" numeric(20, 3),
	"currency" text DEFAULT 'KWD' NOT NULL,
	"payment_terms" text,
	"renewal_notice_days" integer DEFAULT 30 NOT NULL,
	"current_version" integer DEFAULT 0 NOT NULL,
	"submitted_by_user_id" uuid,
	"approved_by_user_id" uuid,
	"approved_at" timestamp with time zone,
	"review_note" text,
	"sent_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_file_id" uuid,
	"activated_at" timestamp with time zone,
	"terminated_at" timestamp with time zone,
	"termination_reason" text,
	"renewal_notified_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "contracts_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "contracts_kind_valid" CHECK ("contracts"."kind" in ('contract', 'engagement_letter')),
	CONSTRAINT "contracts_status_valid" CHECK ("contracts"."status" in ('draft', 'in_review', 'approved', 'sent', 'signed', 'active', 'expired', 'terminated')),
	CONSTRAINT "contracts_dates_ordered" CHECK ("contracts"."end_date" is null or "contracts"."start_date" is null or "contracts"."end_date" >= "contracts"."start_date"),
	CONSTRAINT "contracts_value_nonnegative" CHECK ("contracts"."value_amount" is null or "contracts"."value_amount" >= 0),
	CONSTRAINT "contracts_currency_code" CHECK ("contracts"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "contracts_notice_days" CHECK ("contracts"."renewal_notice_days" between 0 and 365),
	CONSTRAINT "contracts_approver_not_submitter" CHECK ("contracts"."approved_by_user_id" is null or "contracts"."submitted_by_user_id" is null or "contracts"."approved_by_user_id" <> "contracts"."submitted_by_user_id"),
	CONSTRAINT "contracts_signed_needs_file" CHECK ("contracts"."signed_at" is null or "contracts"."signed_file_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "contract_templates" ADD CONSTRAINT "contract_templates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_contract_fk" FOREIGN KEY ("tenant_id","contract_id") REFERENCES "public"."contracts"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_versions" ADD CONSTRAINT "contract_versions_author_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_template_fk" FOREIGN KEY ("tenant_id","template_id") REFERENCES "public"."contract_templates"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_signed_file_fk" FOREIGN KEY ("tenant_id","signed_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_submitted_by_fk" FOREIGN KEY ("tenant_id","submitted_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_approved_by_fk" FOREIGN KEY ("tenant_id","approved_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contracts_tenant_client_idx" ON "contracts" USING btree ("tenant_id","client_id");--> statement-breakpoint
CREATE INDEX "contracts_tenant_status_end_idx" ON "contracts" USING btree ("tenant_id","status","end_date");