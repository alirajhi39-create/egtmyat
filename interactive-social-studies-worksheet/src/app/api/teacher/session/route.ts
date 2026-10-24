import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE,
  TEACHER_STORAGE_KEY,
  TEACHER_TOKEN_HEADER,
  isHttpsRequest,
  isTeacherAuthed,
  isValidPasscode,
} from "@/lib/teacher-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_CACHE = { "Cache-Control": "no-store", Pragma: "no-cache" };

export async function GET(request: NextRequest) {
  const authed = await isTeacherAuthed(request);
  return NextResponse.json({ ok: true, authed }, { headers: NO_CACHE });
}

export async function POST(request: NextRequest) {
  let passcode = "";
  try {
    const body = (await request.json()) as { passcode?: unknown };
    passcode = String(body?.passcode ?? "").trim();
  } catch {
    passcode = "";
  }

  if (!isValidPasscode(passcode)) {
    return NextResponse.json(
      { ok: false, error: "رمز الدخول غير صحيح — تأكّد من الرقم (١٣٩٦١٣)." },
      { status: 401, headers: NO_CACHE },
    );
  }

  try {
    const store = await cookies();
    const https = isHttpsRequest(request);
    store.delete("tw_teacher");
    store.set(TEACHER_COOKIE, passcode, {
      httpOnly: true,
      sameSite: https ? "none" : "lax",
      secure: https,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  } catch {
    /* تجاهل */
  }

  return NextResponse.json(
    {
      ok: true,
      authed: true,
      storageKey: TEACHER_STORAGE_KEY,
      headerName: TEACHER_TOKEN_HEADER,
      token: passcode,
    },
    { headers: NO_CACHE },
  );
}

export async function DELETE() {
  try {
    const store = await cookies();
    store.delete(TEACHER_COOKIE);
    store.delete("tw_teacher");
  } catch {
    /* تجاهل */
  }
  return NextResponse.json({ ok: true, authed: false }, { headers: NO_CACHE });
}
