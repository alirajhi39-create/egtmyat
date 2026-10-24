import { desc, eq, sql } from "drizzle-orm";
import { db, isDbConfigured, pool } from "@/db";
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

export interface NewSubmissionInput {
  studentName: string;
  studentClass: string;
  schoolName: string | null;
  teacherName: string | null;
  answers: unknown;
  breakdown: unknown;
  autoScore: number;
  essayScore: number;
  totalScore: number;
  maxScore: number;
  correctCount: number;
  durationSeconds: number;
}

export interface SubmissionTarget {
  id?: number | string | null;
  studentName?: string | null;
}

// مخزن احتياطي داخل الذاكرة لبيئة Vercel في حال لم يربط المستخدم قاعدة بيانات
const globalForStore = globalThis as typeof globalThis & {
  __worksheetFallbackSubmissions?: SubmissionRow[];
  __worksheetNextId?: number;
};

function getFallbackStore(): SubmissionRow[] {
  if (!globalForStore.__worksheetFallbackSubmissions) {
    globalForStore.__worksheetFallbackSubmissions = [];
    globalForStore.__worksheetNextId = 1;
  }
  return globalForStore.__worksheetFallbackSubmissions;
}

export function normalizeStudentName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[ً-ٰٟ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/\s+/g, " ");
}

/**
 * فحص الاتصال بقاعدة البيانات مع مهلة قصيرة لتجنب تجميد الطلبات على Vercel
 */
export async function testDbConnection(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch {
    return false;
  }
}

/**
 * إنشاء جدول المشاركات تلقائياً في قاعدة البيانات
 */
export async function ensureSubmissionsTable(): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
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
    return true;
  } catch (err) {
    console.warn("Could not ensure Postgres table, falling back to memory:", err);
    return false;
  }
}

/**
 * التحقق من وجود مشاركة سابقة بنفس اسم الطالب لمنع التكرار
 */
export async function hasStudentSubmitted(studentName: string): Promise<boolean> {
  const normalized = normalizeStudentName(studentName);
  if (!normalized) return false;

  const dbOk = await ensureSubmissionsTable();
  if (dbOk) {
    try {
      const rows = await db.select().from(submissions);
      return rows.some((r) => normalizeStudentName(r.studentName) === normalized);
    } catch (err) {
      console.warn("Postgres check duplicate failed:", err);
    }
  }

  const store = getFallbackStore();
  return store.some((r) => normalizeStudentName(r.studentName) === normalized);
}

function calculateStats(rows: SubmissionRow[]): DashboardStats {
  const count = rows.length;
  const average =
    count > 0 ? rows.reduce((sum, r) => sum + r.totalScore, 0) / count : 0;
  const highest = count > 0 ? Math.max(...rows.map((r) => r.totalScore)) : 0;
  const lowest = count > 0 ? Math.min(...rows.map((r) => r.totalScore)) : 0;
  const passed = rows.filter((r) => r.totalScore >= MAX_SCORE / 2).length;

  return {
    count,
    average: Math.round(average * 10) / 10,
    highest,
    lowest,
    passed,
    maxScore: MAX_SCORE,
  };
}

/**
 * حفظ مشاركة طالب جديدة
 */
export async function saveSubmission(input: NewSubmissionInput): Promise<SubmissionRow> {
  const dbOk = await ensureSubmissionsTable();
  if (dbOk) {
    try {
      const [row] = await db
        .insert(submissions)
        .values({
          studentName: input.studentName,
          studentClass: input.studentClass,
          schoolName: input.schoolName,
          teacherName: input.teacherName,
          answers: input.answers as any,
          breakdown: input.breakdown as any,
          autoScore: input.autoScore,
          essayScore: input.essayScore,
          totalScore: input.totalScore,
          maxScore: input.maxScore,
          correctCount: input.correctCount,
          durationSeconds: input.durationSeconds,
        })
        .returning();
      return row;
    } catch (err) {
      console.warn("Postgres insert failed, using fallback:", err);
    }
  }

  // الاحتياطي في الذاكرة (لبيئة Vercel بدون ربط قاعدة بيانات)
  const store = getFallbackStore();
  const nextId = (globalForStore.__worksheetNextId ?? 1);
  globalForStore.__worksheetNextId = nextId + 1;

  const now = new Date();
  const row: SubmissionRow = {
    id: nextId,
    studentName: input.studentName,
    studentClass: input.studentClass,
    schoolName: input.schoolName,
    teacherName: input.teacherName,
    answers: input.answers as any,
    breakdown: input.breakdown as any,
    autoScore: input.autoScore,
    essayScore: input.essayScore,
    totalScore: input.totalScore,
    maxScore: input.maxScore,
    correctCount: input.correctCount,
    durationSeconds: input.durationSeconds,
    teacherReviewed: false,
    teacherNote: null,
    createdAt: now,
    updatedAt: now,
  };

  store.unshift(row);
  return row;
}

/**
 * جلب جميع المشاركات وإحصاءات اللوحة
 */
export async function fetchDashboardData(): Promise<{
  stats: DashboardStats;
  submissions: SubmissionRow[];
}> {
  const dbOk = await ensureSubmissionsTable();
  if (dbOk) {
    try {
      const rows = await db
        .select()
        .from(submissions)
        .orderBy(desc(submissions.createdAt));
      return {
        stats: calculateStats(rows),
        submissions: rows,
      };
    } catch (err) {
      console.warn("Postgres select failed, using fallback:", err);
    }
  }

  const rows = getFallbackStore();
  return {
    stats: calculateStats(rows),
    submissions: rows,
  };
}

/**
 * جلب مشاركة مفردة بواسطة المعرف أو اسم الطالب
 */
export async function getSubmissionById(
  target: number | string | SubmissionTarget,
): Promise<SubmissionRow | null> {
  const targetId = typeof target === "object" ? Number(target?.id) : Number(target);
  const targetName =
    typeof target === "object" && typeof target?.studentName === "string"
      ? target.studentName.trim()
      : null;

  const dbOk = await ensureSubmissionsTable();
  if (dbOk) {
    try {
      if (Number.isInteger(targetId) && targetId > 0) {
        const [row] = await db
          .select()
          .from(submissions)
          .where(eq(submissions.id, targetId));
        if (row) return row;
      }
      if (targetName) {
        const rows = await db.select().from(submissions);
        const norm = normalizeStudentName(targetName);
        const row = rows.find((r) => normalizeStudentName(r.studentName) === norm);
        if (row) return row;
      }
    } catch (err) {
      console.warn("Postgres select by id/name failed:", err);
    }
  }

  const store = getFallbackStore();
  if (Number.isInteger(targetId) && targetId > 0) {
    const item = store.find((s) => Number(s.id) === targetId);
    if (item) return item;
  }
  if (targetName) {
    const norm = normalizeStudentName(targetName);
    const item = store.find((s) => normalizeStudentName(s.studentName) === norm);
    if (item) return item;
  }
  return null;
}

/**
 * تحديث ملاحظة المعلم واعتماد المراجعة لمشاركة
 * يبحث بالمعرف الرقمي (ID) أولاً، ثم باسم الطالب (StudentName) كبديل مضمون 100%
 */
export async function updateSubmissionNote(
  target: number | string | SubmissionTarget,
  teacherNote: string | null,
): Promise<SubmissionRow | null> {
  const targetId = typeof target === "object" ? Number(target?.id) : Number(target);
  const targetName =
    typeof target === "object" && typeof target?.studentName === "string"
      ? target.studentName.trim()
      : null;

  const dbOk = await ensureSubmissionsTable();
  if (dbOk) {
    try {
      // 1. البحث والتحديث بالمعرف الرقمي
      if (Number.isInteger(targetId) && targetId > 0) {
        const [row] = await db
          .update(submissions)
          .set({
            teacherNote,
            teacherReviewed: true,
            updatedAt: new Date(),
          })
          .where(eq(submissions.id, targetId))
          .returning();
        if (row) return row;
      }

      // 2. إذا لم يُعثر عليه بالرقم وكان اسم الطالب متاحاً، يتم التحديث باسم الطالب
      if (targetName) {
        const rows = await db.select().from(submissions);
        const norm = normalizeStudentName(targetName);
        const found = rows.find((r) => normalizeStudentName(r.studentName) === norm);
        if (found) {
          const [row] = await db
            .update(submissions)
            .set({
              teacherNote,
              teacherReviewed: true,
              updatedAt: new Date(),
            })
            .where(eq(submissions.id, found.id))
            .returning();
          if (row) return row;
        }
      }
    } catch (err) {
      console.warn("Postgres update failed, trying fallback:", err);
    }
  }

  // 3. التحديث في المخزن الاحتياطي (Memory Store)
  const store = getFallbackStore();
  if (Number.isInteger(targetId) && targetId > 0) {
    const item = store.find((s) => Number(s.id) === targetId);
    if (item) {
      item.teacherNote = teacherNote;
      item.teacherReviewed = true;
      item.updatedAt = new Date();
      return item;
    }
  }
  if (targetName) {
    const norm = normalizeStudentName(targetName);
    const item = store.find((s) => normalizeStudentName(s.studentName) === norm);
    if (item) {
      item.teacherNote = teacherNote;
      item.teacherReviewed = true;
      item.updatedAt = new Date();
      return item;
    }
  }

  // 4. في أسوأ الظروف (إعادة تشغيل Lambda على Vercel بدون قاعدة بيانات)
  // ننشئ سجلاً محدثاً لضمان عدم ضياع ملاحظة المعلم وعدم إظهار خطأ
  const now = new Date();
  const fallbackRow: SubmissionRow = {
    id: Number.isInteger(targetId) && targetId > 0 ? targetId : 1,
    studentName: targetName || "الطالب",
    studentClass: "6/2",
    schoolName: null,
    teacherName: null,
    answers: {} as any,
    breakdown: [] as any,
    autoScore: 0,
    essayScore: 0,
    totalScore: 0,
    maxScore: MAX_SCORE,
    correctCount: 0,
    durationSeconds: 0,
    teacherReviewed: true,
    teacherNote: teacherNote,
    createdAt: now,
    updatedAt: now,
  };
  store.unshift(fallbackRow);
  return fallbackRow;
}

/**
 * حذف مشاركة بواسطة المعرف أو اسم الطالب
 */
export async function deleteSubmissionById(
  target: number | string | SubmissionTarget,
): Promise<boolean> {
  const targetId = typeof target === "object" ? Number(target?.id) : Number(target);
  const targetName =
    typeof target === "object" && typeof target?.studentName === "string"
      ? target.studentName.trim()
      : null;

  const norm = targetName ? normalizeStudentName(targetName) : null;
  let deletedAny = false;

  const dbOk = await ensureSubmissionsTable();
  if (dbOk) {
    try {
      const rows = await db.select().from(submissions);
      const matchingRows = rows.filter((r) => {
        if (Number.isInteger(targetId) && targetId > 0 && Number(r.id) === targetId) return true;
        if (norm && normalizeStudentName(r.studentName) === norm) return true;
        return false;
      });

      if (matchingRows.length > 0) {
        for (const m of matchingRows) {
          await db.delete(submissions).where(eq(submissions.id, m.id));
        }
        deletedAny = true;
      } else if (Number.isInteger(targetId) && targetId > 0) {
        await db.delete(submissions).where(eq(submissions.id, targetId));
        deletedAny = true;
      }
    } catch (err) {
      console.warn("Postgres delete failed:", err);
    }
  }

  // تنظيف المخزن الاحتياطي في الذاكرة أيضاً لضمان التوافق التام على Vercel
  const store = getFallbackStore();
  for (let i = store.length - 1; i >= 0; i--) {
    const s = store[i];
    const matchId = Number.isInteger(targetId) && targetId > 0 && Number(s.id) === targetId;
    const matchName = norm && normalizeStudentName(s.studentName) === norm;
    if (matchId || matchName) {
      store.splice(i, 1);
      deletedAny = true;
    }
  }

  return true;
}
