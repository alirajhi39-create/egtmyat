import { NextResponse } from "next/server";
import { isTeacherAuthed, unauthorized } from "@/lib/teacher-auth";
import { deleteSubmissionById } from "@/lib/teacher-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function handleDelete(request: Request) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  let body: any = null;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const url = new URL(request.url);
  const rawId =
    body?.id ??
    body?.submissionId ??
    url.searchParams.get("id") ??
    url.searchParams.get("submissionId");
  const numericId = parseInt(String(rawId ?? "").trim(), 10);
  const studentName =
    typeof body?.studentName === "string"
      ? body.studentName.trim()
      : url.searchParams.get("studentName") || url.searchParams.get("name");

  try {
    const ok = await deleteSubmissionById({
      id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
      studentName: studentName || null,
    });
    return NextResponse.json({ ok: true, deleted: ok });
  } catch (err) {
    console.error("Delete handler failed:", err);
    return NextResponse.json({ ok: false, error: "تعذّر الحذف" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return handleDelete(request);
}

export async function DELETE(request: Request) {
  return handleDelete(request);
}
