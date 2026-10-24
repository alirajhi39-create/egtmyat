import { cookies } from "next/headers";

export const TEACHER_COOKIE = "tw_teacher_v2";
export const TEACHER_TOKEN_HEADER = "x-teacher-token";
export const TEACHER_STORAGE_KEY = "tw_teacher_token_v2";

/** الرمز الثابت المطلوب — يعمل دائماً مهما كانت متغيرات البيئة */
const HARDCODED_PASSCODE = "139613";

export function getTeacherPasscode(): string {
  const envCandidate = process.env.TEACHER_PASSCODE?.trim();
  if (envCandidate && envCandidate.length >= 4) return envCandidate;
  return HARDCODED_PASSCODE;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * يقبل الرمز المضمّن (139613) أو رمز البيئة — أيّهما.
 * هذا يمنع أي تعارض بين بيئة البناء وبيئة التشغيل.
 */
export function isValidPasscode(candidate: unknown): boolean {
  if (typeof candidate !== "string") return false;
  const code = candidate.trim();
  if (!code) return false;
  return (
    timingSafeEqual(code, HARDCODED_PASSCODE) ||
    timingSafeEqual(code, getTeacherPasscode())
  );
}

export function isHttpsRequest(request: Request): boolean {
  const forwarded = request.headers.get("x-forwarded-proto") ?? "";
  if (forwarded.toLowerCase().includes("https")) return true;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return process.env.NODE_ENV === "production";
  }
}

/**
 * يتحقق من الجلسة بثلاث طرق (أيّها يكفي):
 * 1) كوكيز 2) ترويسة x-teacher-token 3) باراميتر ?t= في الرابط
 * (الباراميتر مهم لأن بعض البروكسيات قد تُسقط الترويسات المخصصة)
 */
export async function isTeacherAuthed(request?: Request): Promise<boolean> {
  try {
    const store = await cookies();
    if (isValidPasscode(store.get(TEACHER_COOKIE)?.value)) return true;
    if (isValidPasscode(store.get("tw_teacher")?.value)) return true;
  } catch {
    /* تجاهل */
  }

  if (request) {
    if (isValidPasscode(request.headers.get(TEACHER_TOKEN_HEADER))) return true;
    try {
      const url = new URL(request.url);
      if (isValidPasscode(url.searchParams.get("t"))) return true;
    } catch {
      /* تجاهل */
    }
  }
  return false;
}

export function unauthorized() {
  return Response.json(
    {
      ok: false,
      error: "غير مصرّح — الجلسة غير صالحة. أدخل رمز الدخول مرة أخرى.",
    },
    { status: 401 },
  );
}
