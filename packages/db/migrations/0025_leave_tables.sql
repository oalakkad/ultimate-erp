CREATE TABLE "leave_ledger" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"kind" text NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"request_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_ledger_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "leave_ledger_request_kind_year_key" UNIQUE("tenant_id","request_id","kind","year"),
	CONSTRAINT "leave_ledger_kind_valid" CHECK ("leave_ledger"."kind" in ('taken', 'restored', 'adjustment')),
	CONSTRAINT "leave_ledger_sign" CHECK (("leave_ledger"."kind" = 'taken' and "leave_ledger"."days" < 0) or ("leave_ledger"."kind" = 'restored' and "leave_ledger"."days" > 0) or "leave_ledger"."kind" = 'adjustment'),
	CONSTRAINT "leave_ledger_request_needed" CHECK ("leave_ledger"."kind" = 'adjustment' or "leave_ledger"."request_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "leave_requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"leave_type_id" uuid NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"half_day" text DEFAULT 'none' NOT NULL,
	"days" numeric(6, 2) NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"file_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_requests_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "leave_requests_dates" CHECK ("leave_requests"."end_date" >= "leave_requests"."start_date"),
	CONSTRAINT "leave_requests_half_day" CHECK ("leave_requests"."half_day" = 'none' or "leave_requests"."start_date" = "leave_requests"."end_date"),
	CONSTRAINT "leave_requests_days" CHECK ("leave_requests"."days" > 0),
	CONSTRAINT "leave_requests_status_valid" CHECK ("leave_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn', 'cancelled')),
	CONSTRAINT "leave_requests_reason_length" CHECK (length("leave_requests"."reason") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "leave_types" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"paid" boolean DEFAULT true NOT NULL,
	"deducts_balance" boolean DEFAULT true NOT NULL,
	"annual_days" numeric(6, 2) DEFAULT '0' NOT NULL,
	"accrual" text DEFAULT 'yearly' NOT NULL,
	"allow_half_day" boolean DEFAULT true NOT NULL,
	"requires_document" boolean DEFAULT false NOT NULL,
	"allow_negative" boolean DEFAULT false NOT NULL,
	"to_verify" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "leave_types_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "leave_types_tenant_code_key" UNIQUE("tenant_id","code"),
	CONSTRAINT "leave_types_accrual_valid" CHECK ("leave_types"."accrual" in ('none', 'monthly', 'yearly')),
	CONSTRAINT "leave_types_days" CHECK ("leave_types"."annual_days" >= 0 and "leave_types"."annual_days" <= 366),
	CONSTRAINT "leave_types_code" CHECK ("leave_types"."code" ~ '^[a-z][a-z0-9_]{1,39}$')
);
--> statement-breakpoint
CREATE TABLE "public_holidays" (
	"tenant_id" uuid NOT NULL,
	"date" date NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	CONSTRAINT "public_holidays_pkey" PRIMARY KEY("tenant_id","date")
);
--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_type_fk" FOREIGN KEY ("tenant_id","leave_type_id") REFERENCES "public"."leave_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_request_fk" FOREIGN KEY ("tenant_id","request_id") REFERENCES "public"."leave_requests"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_fk" FOREIGN KEY ("tenant_id","membership_id") REFERENCES "public"."employees"("tenant_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_type_fk" FOREIGN KEY ("tenant_id","leave_type_id") REFERENCES "public"."leave_types"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_decided_by_fk" FOREIGN KEY ("tenant_id","decided_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leave_types" ADD CONSTRAINT "leave_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public_holidays" ADD CONSTRAINT "public_holidays_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "leave_ledger_member_idx" ON "leave_ledger" USING btree ("tenant_id","membership_id","leave_type_id","year");--> statement-breakpoint
CREATE INDEX "leave_requests_member_idx" ON "leave_requests" USING btree ("tenant_id","membership_id","start_date");--> statement-breakpoint
CREATE INDEX "leave_requests_dates_idx" ON "leave_requests" USING btree ("tenant_id","start_date","end_date");