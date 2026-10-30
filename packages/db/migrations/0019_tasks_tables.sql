CREATE TABLE "task_allocations" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"hours" numeric(10, 2) NOT NULL,
	"allocated_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_allocations_pkey" PRIMARY KEY("tenant_id","task_id","membership_id"),
	CONSTRAINT "task_allocations_hours_nonnegative" CHECK ("task_allocations"."hours" >= 0)
);
--> statement-breakpoint
CREATE TABLE "task_comments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_comments_tenant_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "task_comments_body_length" CHECK (length(trim("task_comments"."body")) between 1 and 4000)
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"blocked_by_task_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_dependencies_pkey" PRIMARY KEY("tenant_id","task_id","blocked_by_task_id"),
	CONSTRAINT "task_dependencies_not_self" CHECK ("task_dependencies"."task_id" <> "task_dependencies"."blocked_by_task_id")
);
--> statement-breakpoint
CREATE TABLE "task_documents" (
	"tenant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"file_id" uuid NOT NULL,
	"added_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_documents_pkey" PRIMARY KEY("tenant_id","task_id","file_id"),
	CONSTRAINT "task_documents_tenant_file_key" UNIQUE("tenant_id","file_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"number" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'backlog' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"start_date" date,
	"due_date" date,
	"estimated_hours" numeric(10, 2),
	"completed_at" timestamp with time zone,
	"overdue_notified_on" date,
	"created_by_user_id" uuid NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_tenant_id_id_key" UNIQUE("tenant_id","id"),
	CONSTRAINT "tasks_tenant_project_id_key" UNIQUE("tenant_id","project_id","id"),
	CONSTRAINT "tasks_tenant_number_key" UNIQUE("tenant_id","number"),
	CONSTRAINT "tasks_status_valid" CHECK ("tasks"."status" in ('backlog', 'ready', 'in_progress', 'in_review', 'completed', 'cancelled')),
	CONSTRAINT "tasks_priority_valid" CHECK ("tasks"."priority" in ('low', 'normal', 'high', 'urgent')),
	CONSTRAINT "tasks_dates_ordered" CHECK ("tasks"."due_date" is null or "tasks"."start_date" is null or "tasks"."due_date" >= "tasks"."start_date"),
	CONSTRAINT "tasks_estimate_nonnegative" CHECK ("tasks"."estimated_hours" is null or "tasks"."estimated_hours" >= 0),
	CONSTRAINT "tasks_title_length" CHECK (length(trim("tasks"."title")) between 1 and 300)
);
--> statement-breakpoint
ALTER TABLE "task_allocations" ADD CONSTRAINT "task_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_allocations" ADD CONSTRAINT "task_allocations_task_fk" FOREIGN KEY ("tenant_id","project_id","task_id") REFERENCES "public"."tasks"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_allocations" ADD CONSTRAINT "task_allocations_team_fk" FOREIGN KEY ("tenant_id","project_id","membership_id") REFERENCES "public"."project_members"("tenant_id","project_id","membership_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_allocations" ADD CONSTRAINT "task_allocations_by_fk" FOREIGN KEY ("tenant_id","allocated_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_author_fk" FOREIGN KEY ("tenant_id","author_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_fk" FOREIGN KEY ("tenant_id","project_id","task_id") REFERENCES "public"."tasks"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_blocker_fk" FOREIGN KEY ("tenant_id","project_id","blocked_by_task_id") REFERENCES "public"."tasks"("tenant_id","project_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_task_fk" FOREIGN KEY ("tenant_id","task_id") REFERENCES "public"."tasks"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_documents" ADD CONSTRAINT "task_documents_added_by_fk" FOREIGN KEY ("tenant_id","added_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_project_fk" FOREIGN KEY ("tenant_id","project_id") REFERENCES "public"."projects"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_created_by_fk" FOREIGN KEY ("tenant_id","created_by_user_id") REFERENCES "public"."memberships"("tenant_id","user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_allocations_project_idx" ON "task_allocations" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "task_allocations_membership_idx" ON "task_allocations" USING btree ("tenant_id","membership_id");--> statement-breakpoint
CREATE INDEX "task_comments_task_idx" ON "task_comments" USING btree ("tenant_id","task_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_project_idx" ON "tasks" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE INDEX "tasks_tenant_due_idx" ON "tasks" USING btree ("tenant_id","due_date");