import { desc, sql } from "drizzle-orm";
import { assertDatabaseConfigured, db } from "@/db";
import { submissions, type SubmissionRow } from "@/db/schema";
import { MAX_SCORE } from "@/lib/worksheet";

export interface DashboardStats {
  count: number;
  average: number;
  highest: number;
  lowest: number;
  passed: number;
  maxScore: number;
}

export const EMPTY_STATS: DashboardStats = {
  count: 0,
  average: 0,
  highest: 0,
  lowest: 0,
  passed: 0,
  maxScore: MAX_SCORE,
};

/**
 * ينشئ جدول المشاركات إن لم يكن موجوداً.
 * يضمن عمل اللوحة في أي بيئة نشر حتى لو لم تُطبَّق الهجرات عليها.
 */
export async function ensureSubmissionsTable(): Promise<void> {
  // رسالة عربية واضحة عند غياب الإعداد بدل انهيار غامض على Vercel
  assertDatabaseConfigured();
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "submissions" (
      "id" serial PRIMARY KEY,
      "student_name" varchar(120) NOT NULL,
      "student_class" varchar(40) NOT NULL DEFAULT '6/2',
      "school_name" varchar(160),
      "teacher_name" varchar(120),
      "answers" jsonb NOT NULL,
      "breakdown" jsonb NOT NULL,
      "auto_score" integer NOT NULL DEFAULT 0,
      "essay_score" integer NOT NULL DEFAULT 0,
      "total_score" integer NOT NULL DEFAULT 0,
      "max_score" integer NOT NULL DEFAULT 20,
      "correct_count" integer NOT NULL DEFAULT 0,
      "duration_seconds" integer NOT NULL DEFAULT 0,
      "teacher_reviewed" boolean NOT NULL DEFAULT false,
      "teacher_note" text,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now()
    );
  `);
  await db.execute(sql`
    ALTER TABLE "submissions"
      ADD COLUMN IF NOT EXISTS "student_name" varchar(120),
      ADD COLUMN IF NOT EXISTS "student_class" varchar(40),
      ADD COLUMN IF NOT EXISTS "school_name" varchar(160),
      ADD COLUMN IF NOT EXISTS "teacher_name" varchar(120),
      ADD COLUMN IF NOT EXISTS "answers" jsonb,
      ADD COLUMN IF NOT EXISTS "breakdown" jsonb,
      ADD COLUMN IF NOT EXISTS "auto_score" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "essay_score" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "total_score" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "max_score" integer DEFAULT 20,
      ADD COLUMN IF NOT EXISTS "correct_count" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "duration_seconds" integer DEFAULT 0,
      ADD COLUMN IF NOT EXISTS "teacher_reviewed" boolean DEFAULT false,
      ADD COLUMN IF NOT EXISTS "teacher_note" text,
      ADD COLUMN IF NOT EXISTS "created_at" timestamptz DEFAULT now(),
      ADD COLUMN IF NOT EXISTS "updated_at" timestamptz DEFAULT now();
  `);
}

export function normalizeStudentName(name: string): string {
  return name
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchDashboardData(): Promise<{
  stats: DashboardStats;
  submissions: SubmissionRow[];
}> {
  await ensureSubmissionsTable();
  const rows = await db.select().from(submissions).orderBy(desc(submissions.createdAt));

  const count = rows.length;
  const average =
    count > 0 ? rows.reduce((sum, r) => sum + r.totalScore, 0) / count : 0;
  const highest = count > 0 ? Math.max(...rows.map((r) => r.totalScore)) : 0;
  const lowest = count > 0 ? Math.min(...rows.map((r) => r.totalScore)) : 0;
  const passed = rows.filter((r) => r.totalScore >= MAX_SCORE / 2).length;

  return {
    stats: {
      count,
      average: Math.round(average * 10) / 10,
      highest,
      lowest,
      passed,
      maxScore: MAX_SCORE,
    },
    submissions: rows,
  };
}
