import { NextResponse } from "next/server";
import { isTeacherAuthed, unauthorized } from "@/lib/teacher-auth";
import {
  deleteSubmissionById,
  getSubmissionById,
  updateSubmissionNote,
} from "@/lib/teacher-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params?: Promise<{ id?: string }> | { id?: string } };

async function resolveNumericId(
  request: Request,
  context?: RouteContext,
  body?: any,
): Promise<number | null> {
  if (context?.params) {
    try {
      const resolved = await context.params;
      const raw = resolved?.id;
      if (raw !== undefined && raw !== null) {
        const clean = String(raw).split("?")[0].split("/")[0].trim();
        const n = parseInt(clean, 10);
        if (Number.isInteger(n) && n > 0) return n;
      }
    } catch {
      /* تجاهل */
    }
  }

  try {
    const url = new URL(request.url);
    const match = url.pathname.match(/\/api\/submissions\/(\d+)/);
    if (match && match[1]) {
      const n = parseInt(match[1], 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
    const qId = url.searchParams.get("id") || url.searchParams.get("submissionId");
    if (qId) {
      const n = parseInt(qId.trim(), 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
  } catch {
    /* تجاهل */
  }

  if (body) {
    const bId = body.id ?? body.submissionId;
    if (bId !== undefined && bId !== null) {
      const n = parseInt(String(bId).trim(), 10);
      if (Number.isInteger(n) && n > 0) return n;
    }
  }

  return null;
}

export async function GET(request: Request, context: RouteContext) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  const numericId = await resolveNumericId(request, context);
  const url = new URL(request.url);
  const studentName = url.searchParams.get("studentName");

  try {
    const row = await getSubmissionById({ id: numericId, studentName });
    if (!row) return NextResponse.json({ ok: false, error: "غير موجود" }, { status: 404 });
    return NextResponse.json({ ok: true, submission: row });
  } catch (err) {
    console.error("GET /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر تحميل البيانات" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  let body: any = {};
  try {
    body = (await request.json()) as any;
  } catch {
    body = {};
  }

  const numericId = await resolveNumericId(request, context, body);
  const studentName =
    typeof body?.studentName === "string" ? body.studentName.trim() : null;

  const teacherNote =
    typeof body?.teacherNote === "string" ? body.teacherNote.slice(0, 600) : null;

  try {
    const row = await updateSubmissionNote({ id: numericId, studentName }, teacherNote);
    return NextResponse.json({ ok: true, submission: row });
  } catch (err) {
    console.error("PATCH /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر حفظ الملاحظة" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const numericId = await resolveNumericId(request, context, body);
  const studentName =
    typeof body?.studentName === "string" ? body.studentName.trim() : null;

  try {
    const ok = await deleteSubmissionById({ id: numericId, studentName });
    return NextResponse.json({ ok });
  } catch (err) {
    console.error("DELETE /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر الحذف" }, { status: 500 });
  }
}
