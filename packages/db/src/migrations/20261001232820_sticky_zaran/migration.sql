CREATE TYPE "attachment_kind" AS ENUM('image', 'audio');--> statement-breakpoint
CREATE TYPE "investigation_status" AS ENUM('queued', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TYPE "message_kind" AS ENUM('client', 'admin', 'system');--> statement-breakpoint
CREATE TYPE "ticket_status" AS ENUM('received', 'investigating', 'reported', 'resolved');--> statement-breakpoint
CREATE TABLE "attachment" (
	"id" text PRIMARY KEY,
	"uploader_id" text NOT NULL,
	"message_id" text,
	"kind" "attachment_kind" NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"transcript" text,
	"transcript_english" text,
	"language" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "investigation" (
	"id" text PRIMARY KEY,
	"ticket_id" text NOT NULL,
	"status" "investigation_status" DEFAULT 'queued'::"investigation_status" NOT NULL,
	"model" text,
	"stop_reason" text,
	"report" jsonb,
	"tool_calls" jsonb,
	"snapshots" jsonb,
	"usage" jsonb,
	"error" text,
	"queued_at" timestamp DEFAULT now() NOT NULL,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "invite" (
	"id" text PRIMARY KEY,
	"token" text NOT NULL UNIQUE,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"project_ids" jsonb NOT NULL,
	"created_by" text,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message" (
	"id" text PRIMARY KEY,
	"ticket_id" text NOT NULL,
	"author_id" text,
	"kind" "message_kind" NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"runbook" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_member" (
	"user_id" text,
	"project_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "project_member_pkey" PRIMARY KEY("user_id","project_id")
);
--> statement-breakpoint
CREATE TABLE "ticket" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL,
	"author_id" text NOT NULL,
	"title" text NOT NULL,
	"status" "ticket_status" DEFAULT 'received'::"ticket_status" NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "impersonated_by" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "banned" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_reason" text;--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "ban_expires" timestamp;--> statement-breakpoint
CREATE INDEX "attachment_message_idx" ON "attachment" ("message_id");--> statement-breakpoint
CREATE INDEX "investigation_ticket_idx" ON "investigation" ("ticket_id");--> statement-breakpoint
CREATE INDEX "investigation_status_idx" ON "investigation" ("status");--> statement-breakpoint
CREATE INDEX "message_ticket_idx" ON "message" ("ticket_id");--> statement-breakpoint
CREATE INDEX "ticket_project_idx" ON "ticket" ("project_id");--> statement-breakpoint
CREATE INDEX "ticket_author_idx" ON "ticket" ("author_id");--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_id_user_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_message_id_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "message"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "investigation" ADD CONSTRAINT "investigation_ticket_id_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "invite" ADD CONSTRAINT "invite_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_ticket_id_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "message" ADD CONSTRAINT "message_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "project_member" ADD CONSTRAINT "project_member_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ticket" ADD CONSTRAINT "ticket_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;