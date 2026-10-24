import { NextResponse } from "next/server";
import { isTeacherAuthed, unauthorized } from "@/lib/teacher-auth";
import { MAX_SCORE, gradeSubmission } from "@/lib/worksheet";
import {
  deleteSubmissionById,
  fetchDashboardData,
  hasStudentSubmitted,
  saveSubmission,
  updateSubmissionNote,
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

  const studentName = asText(body.studentName);
  if (studentName.length < 2) {
    return NextResponse.json(
      { ok: false, error: "الرجاء كتابة اسم الطالب كاملاً" },
      { status: 400 },
    );
  }

  // التحقق من عدم تكرار اسم الطالب
  try {
    const alreadySubmitted = await hasStudentSubmitted(studentName);
    if (alreadySubmitted) {
      return NextResponse.json(
        {
          ok: false,
          error: `عذراً، تم تسجيل مشاركة سابقة باسم (${studentName}) مسبقاً، ولا يُسمح بتكرار الحل.`,
          duplicate: true,
        },
        { status: 400 },
      );
    }
  } catch (err) {
    console.warn("Check duplicate error:", err);
  }

  const answers = (body.answers ?? {}) as AnswersMap;
  if (typeof answers !== "object" || Array.isArray(answers)) {
    return NextResponse.json({ ok: false, error: "الإجابات غير صالحة" }, { status: 400 });
  }

  try {
    const result = gradeSubmission(answers);
    const durationSeconds = Math.max(
      0,
      Math.min(60 * 60 * 5, Number(body.durationSeconds) || 0),
    );

    const row = await saveSubmission({
      studentName,
      studentClass: asText(body.studentClass, "6/2") || "6/2",
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
    });

    return NextResponse.json({
      ok: true,
      submissionId: row.id,
      sentAt: row.createdAt,
      result,
    });
  } catch (err) {
    console.error("POST /api/submissions failed", err);
    return NextResponse.json(
      { ok: false, error: "تعذّر حفظ الإجابات — حاول مرة أخرى" },
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
      { ok: false, error: "تعذّر تحميل البيانات — اضغط تحديث وحاول مجدداً." },
      { status: 500 },
    );
  }
}

/**
 * تحديث الملاحظة واعتماد المراجعة عبر المسار الأساسي
 * يقبل المعرف الرقمي أو اسم الطالب ويضمن النجاح دائماً
 */
export async function PATCH(request: Request) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  let body: any = {};
  try {
    body = (await request.json()) as any;
  } catch {
    body = {};
  }

  const url = new URL(request.url);
  const rawId = body?.id ?? body?.submissionId ?? url.searchParams.get("id");
  const numericId = parseInt(String(rawId ?? "").trim(), 10);
  const studentName =
    typeof body?.studentName === "string"
      ? body.studentName.trim()
      : url.searchParams.get("studentName");

  const teacherNote =
    typeof body?.teacherNote === "string" ? body.teacherNote.slice(0, 600) : null;

  try {
    const row = await updateSubmissionNote(
      {
        id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
        studentName,
      },
      teacherNote,
    );
    return NextResponse.json({ ok: true, submission: row });
  } catch (err) {
    console.error("PATCH /api/submissions failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر حفظ الملاحظة" }, { status: 500 });
  }
}

/**
 * حذف المشاركة عبر المسار الأساسي
 */
export async function DELETE(request: Request) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const url = new URL(request.url);
  const rawId = body?.id ?? body?.submissionId ?? url.searchParams.get("id");
  const numericId = parseInt(String(rawId ?? "").trim(), 10);
  const studentName =
    typeof body?.studentName === "string"
      ? body.studentName.trim()
      : url.searchParams.get("studentName");

  try {
    const ok = await deleteSubmissionById({
      id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
      studentName,
    });
    return NextResponse.json({ ok });
  } catch (err) {
    console.error("DELETE /api/submissions fallback failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر الحذف" }, { status: 500 });
  }
}
