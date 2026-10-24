import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, describeDbError } from "@/db";
import { submissions } from "@/db/schema";
import { isTeacherAuthed, unauthorized } from "@/lib/teacher-auth";
import { ensureSubmissionsTable } from "@/lib/teacher-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

/**
 * تحليل متسامح لرقم المشاركة:
 * - يقبل الرقم من مسار الرابط (/api/submissions/12)
 * - وبديلاً من باراميتر ?sid=12 (تحسّباً لأي خلل في التوجيه أو نسخة قديمة)
 * - يرفض القيم الفارغة وغير الرقمية مع رسالة تشخيصية توضح القيمة المستلمة
 */
function parseSubmissionId(request: Request, rawSegment: unknown): number | null {
  const candidates: unknown[] = [rawSegment];
  try {
    const url = new URL(request.url);
    candidates.push(url.searchParams.get("sid"), url.searchParams.get("id"));
  } catch {
    /* تجاهل */
  }
  for (const candidate of candidates) {
    if (candidate === null || candidate === undefined) continue;
    const text = String(candidate).trim();
    if (!text || text.toLowerCase() === "undefined" || text.toLowerCase() === "null") continue;
    const numeric = Number(text);
    if (Number.isInteger(numeric) && numeric > 0) return numeric;
  }
  return null;
}

function invalidIdResponse(rawSegment: unknown, request: Request) {
  console.error("[api/submissions/:id] invalid identifier", {
    segment: String(rawSegment ?? ""),
    url: request.url,
  });
  return NextResponse.json(
    {
      ok: false,
      error: `تعذّر تحديد المشاركة (معرّف غير صالح: "${String(rawSegment ?? "")}"). أغلق النافذة وأعد فتحها من الجدول، وتأكد من تحديث الصفحة لآخر نسخة.`,
    },
    { status: 400 },
  );
}

export async function GET(request: Request, { params }: Params) {
  if (!(await isTeacherAuthed(request))) return unauthorized();
  const { id } = await params;
  const numericId = parseSubmissionId(request, id);
  if (numericId === null) return invalidIdResponse(id, request);

  try {
    await ensureSubmissionsTable();
    const [row] = await db.select().from(submissions).where(eq(submissions.id, numericId));
    if (!row) {
      return NextResponse.json({ ok: false, error: "المشاركة غير موجودة" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, submission: row });
  } catch (err) {
    console.error("GET /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: describeDbError(err) }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isTeacherAuthed(request))) return unauthorized();
  const { id } = await params;
  const numericId = parseSubmissionId(request, id);
  if (numericId === null) return invalidIdResponse(id, request);

  let body: { teacherNote?: unknown };
  try {
    body = (await request.json()) as { teacherNote?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "صيغة الطلب غير صحيحة" }, { status: 400 });
  }

  try {
    await ensureSubmissionsTable();
    const [existing] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, numericId));
    if (!existing) {
      return NextResponse.json({ ok: false, error: "المشاركة غير موجودة" }, { status: 404 });
    }

    const teacherNote =
      typeof body.teacherNote === "string" ? body.teacherNote.slice(0, 600) : null;

    const [row] = await db
      .update(submissions)
      .set({
        teacherNote,
        teacherReviewed: true,
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, numericId))
      .returning();

    return NextResponse.json({ ok: true, submission: row });
  } catch (err) {
    console.error("PATCH /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: describeDbError(err) }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await isTeacherAuthed(request))) return unauthorized();
  const { id } = await params;
  const numericId = parseSubmissionId(request, id);
  if (numericId === null) return invalidIdResponse(id, request);

  try {
    await ensureSubmissionsTable();
    await db.delete(submissions).where(eq(submissions.id, numericId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: describeDbError(err) }, { status: 500 });
  }
}
