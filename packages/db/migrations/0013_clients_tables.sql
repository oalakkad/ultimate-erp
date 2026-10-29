CREATE TABLE "client_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" text,
	"email" text,
	"phone" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"is_authorized_representative" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_contacts_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_contacts_tenant_client_id_key" UNIQUE("tenant_id","client_id","id")
);
--> statement-breakpoint
CREATE TABLE "client_documents" (
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_documents_pkey" PRIMARY KEY("tenant_id","client_id","file_id"),
	CONSTRAINT "client_documents_tenant_id_file_key" UNIQUE("tenant_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "client_interactions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"contact_id" uuid,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"summary" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "client_interactions_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "client_interactions_kind_valid" CHECK ("client_interactions"."kind" in ('note', 'call', 'meeting', 'email')),
	CONSTRAINT "client_interactions_summary_length" CHECK (length("client_interactions"."summary") between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"number" text NOT NULL,
	"type" text DEFAULT 'company' NOT NULL,
	"legal_name_en" text NOT NULL,
	"legal_name_ar" text NOT NULL,
	"name_key" text NOT NULL,
	"commercial_registration" text,
	"industry" text,
	"email" text,
	"phone" text,
	"website" text,
	"address_line" text,
	"city" text,
	"country" text DEFAULT 'KW' NOT NULL,
	"status" text DEFAULT 'prospect' NOT NULL,
	"account_manager_membership_id" uuid,
	"archived_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "clients_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "clients_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "clients_type_valid" CHECK ("clients"."type" in ('company', 'individual', 'government')),
	CONSTRAINT "clients_status_valid" CHECK ("clients"."status" in ('prospect', 'active', 'inactive')),
	CONSTRAINT "clients_country_code" CHECK ("clients"."country" ~ '^[A-Z]{2}$'),
	CONSTRAINT "clients_names_present" CHECK (length(trim("clients"."legal_name_en")) > 0 and length(trim("clients"."legal_name_ar")) > 0)
);
--> statement-breakpoint
CREATE TABLE "number_sequences" (
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"next_value" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "number_sequences_pkey" PRIMARY KEY("tenant_id","name"),
	CONSTRAINT "number_sequences_positive" CHECK ("number_sequences"."next_value" > 0)
);
--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_documents" ADD CONSTRAINT "client_documents_added_by_fk" FOREIGN KEY ("tenant_id","added_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_contact_fk" FOREIGN KEY ("tenant_id","client_id","contact_id") REFERENCES "public"."client_contacts"("tenant_id","client_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_interactions" ADD CONSTRAINT "client_interactions_author_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_account_manager_fk" FOREIGN KEY ("tenant_id","account_manager_membership_id") REFERENCES "public"."memberships"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "number_sequences" ADD CONSTRAINT "number_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "client_contacts_one_primary" ON "client_contacts" USING btree ("tenant_id","client_id") WHERE "client_contacts"."is_primary" and "client_contacts"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "client_interactions_client_idx" ON "client_interactions" USING btree ("tenant_id","client_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "clients_tenant_cr_key" ON "clients" USING btree ("tenant_id","commercial_registration") WHERE "clients"."commercial_registration" is not null;--> statement-breakpoint
CREATE INDEX "clients_tenant_name_key_idx" ON "clients" USING btree ("tenant_id","name_key");--> statement-breakpoint
CREATE INDEX "clients_tenant_created_idx" ON "clients" USING btree ("tenant_id","created_at" DESC NULLS LAST);