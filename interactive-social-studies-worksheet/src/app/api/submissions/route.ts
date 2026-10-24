import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { isTeacherAuthed, unauthorized } from "@/lib/teacher-auth";
import { describeDbError } from "@/db";
import { MAX_SCORE, gradeSubmission } from "@/lib/worksheet";
import {
  ensureSubmissionsTable,
  fetchDashboardData,
  normalizeStudentName,
} from "@/lib/teacher-data";
import type { AnswersMap } from "@/lib/worksheet-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SubmitBody {
  studentName?: unknown;
  studentClass?: unknown;
  schoolName?: unknown;
  teacherName?: unknown;
  answers?: unknown;
  durationSeconds?: unknown;
}

function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

export async function POST(request: Request) {
  let body: SubmitBody;
  try {
    body = (await request.json()) as SubmitBody;
  } catch {
    return NextResponse.json({ ok: false, error: "صيغة الطلب غير صحيحة" }, { status: 400 });
  }

  const rawName = asText(body.studentName);
  if (rawName.replace(/\s+/g, "").length < 2) {
    return NextResponse.json(
      { ok: false, error: "الرجاء كتابة اسم الطالب كاملاً" },
      { status: 400 },
    );
  }
  // توحيد الاسم والفصل قبل الحفظ والمقارنة
  const studentName = normalizeStudentName(rawName).replace(/\s+/g, " ");
  const studentClass = asText(body.studentClass, "6/2").replace(/\s+/g, " ") || "6/2";

  const answers = (body.answers ?? {}) as AnswersMap;
  if (typeof answers !== "object" || Array.isArray(answers)) {
    return NextResponse.json({ ok: false, error: "الإجابات غير صالحة" }, { status: 400 });
  }

  try {
    await ensureSubmissionsTable();
    // منع تكرار المشاركة: نفس الاسم في نفس الفصل يُقبل مرة واحدة فقط
    // (المقارنة بالاسم الموحّد، ولو أُدخل بهمزة أو تاء مربوطة مختلفة)
    const sameClass = await db
      .select({
        id: submissions.id,
        studentName: submissions.studentName,
        totalScore: submissions.totalScore,
        maxScore: submissions.maxScore,
        createdAt: submissions.createdAt,
      })
      .from(submissions)
      .where(eq(submissions.studentClass, studentClass));
    const dupe = sameClass.find(
      (row) => normalizeStudentName(row.studentName ?? "") === studentName,
    );
    if (dupe) {
      return NextResponse.json(
        {
          ok: false,
          duplicate: true,
          error: `عزيزي الطالب (${rawName}): لقد شاركت مسبقاً وحُفظت إجابتك بدرجة ${dupe.totalScore} من ${dupe.maxScore}. لا يمكن الإرسال مرتين — راجع معلمك إذا أردت إعادة المحاولة.`,
        },
        { status: 409 },
      );
    }
    const result = gradeSubmission(answers);
    const durationSeconds = Math.max(
      0,
      Math.min(60 * 60 * 5, Number(body.durationSeconds) || 0),
    );

    const [row] = await db
      .insert(submissions)
      .values({
        studentName,
        studentClass,
        schoolName: asText(body.schoolName) || null,
        teacherName: asText(body.teacherName) || null,
        answers,
        breakdown: result.breakdown,
        autoScore: result.totalScore,
        essayScore: 0,
        totalScore: result.totalScore,
        maxScore: MAX_SCORE,
        correctCount: result.correctCount,
        durationSeconds: Math.round(durationSeconds),
      })
      .returning();

    return NextResponse.json({
      ok: true,
      submissionId: row.id,
      sentAt: row.createdAt,
      result,
    });
  } catch (err) {
    console.error("POST /api/submissions failed", err);
    return NextResponse.json(
      { ok: false, error: describeDbError(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  try {
    const { stats, submissions: rows } = await fetchDashboardData();
    return NextResponse.json({ ok: true, stats, submissions: rows });
  } catch (err) {
    console.error("GET /api/submissions failed", err);
    return NextResponse.json(
      { ok: false, error: describeDbError(err) },
      { status: 500 },
    );
  }
}
