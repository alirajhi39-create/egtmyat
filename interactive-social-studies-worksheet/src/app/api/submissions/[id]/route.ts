import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { submissions } from "@/db/schema";
import { isTeacherAuthed, unauthorized } from "@/lib/teacher-auth";
import { ensureSubmissionsTable } from "@/lib/teacher-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  if (!(await isTeacherAuthed(request))) return unauthorized();
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return Response.json({ ok: false, error: "معرّف غير صالح" }, { status: 400 });
  }

  try {
    await ensureSubmissionsTable();
    const [row] = await db.select().from(submissions).where(eq(submissions.id, numericId));
    if (!row) return Response.json({ ok: false, error: "غير موجود" }, { status: 404 });
    return NextResponse.json({ ok: true, submission: row });
  } catch (err) {
    console.error("GET /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر تحميل البيانات" }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  if (!(await isTeacherAuthed(request))) return unauthorized();
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return Response.json({ ok: false, error: "معرّف غير صالح" }, { status: 400 });
  }

  let body: { teacherNote?: unknown };
  try {
    body = (await request.json()) as { teacherNote?: unknown };
  } catch {
    return Response.json({ ok: false, error: "صيغة الطلب غير صحيحة" }, { status: 400 });
  }

  try {
    await ensureSubmissionsTable();
    const [existing] = await db
      .select()
      .from(submissions)
      .where(eq(submissions.id, numericId));
    if (!existing) return Response.json({ ok: false, error: "غير موجود" }, { status: 404 });

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
    return NextResponse.json({ ok: false, error: "تعذّر حفظ الملاحظة" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: Params) {
  if (!(await isTeacherAuthed(request))) return unauthorized();
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return Response.json({ ok: false, error: "معرّف غير صالح" }, { status: 400 });
  }
  try {
    await ensureSubmissionsTable();
    await db.delete(submissions).where(eq(submissions.id, numericId));
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/submissions/[id] failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر الحذف" }, { status: 500 });
  }
}
