import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import {
  TEACHER_COOKIE,
  isHttpsRequest,
  isValidPasscode,
} from "@/lib/teacher-auth";
import { EMPTY_STATS, fetchDashboardData } from "@/lib/teacher-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * تسجيل دخول المعلم + جلب بيانات اللوحة في طلب واحد.
 * حتى لو مُنعت الكوكيز والتخزين المحلي في المتصفح، سيدخل المعلم
 * ويرى البيانات لأنها تأتي ضمن ردّ الدخول نفسه.
 */
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
      {
        status: 401,
        headers: { "Cache-Control": "no-store", Pragma: "no-cache" },
      },
    );
  }

  // كوكيز بأفضل جهد (قد تُمنع داخل المعاينة — لا مشكلة، الرمز في الذاكرة يكفي)
  try {
    const store = await cookies();
    const https = isHttpsRequest(request);
    store.delete("tw_teacher");
    store.set(TEACHER_COOKIE, passcode, {
      httpOnly: true,
      // داخل إطار المعاينة (cross-site) لا تُقبل إلا None+Secure
      sameSite: https ? "none" : "lax",
      secure: https,
      path: "/",
      maxAge: 60 * 60 * 12,
    });
  } catch {
    /* تجاهل */
  }

  try {
    const { stats, submissions } = await fetchDashboardData();
    return NextResponse.json(
      { ok: true, authed: true, token: passcode, stats, submissions },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  } catch (err) {
    console.error("POST /api/teacher/login data failed", err);
    // الرمز صحيح لكن قاعدة البيانات متعثرة: ندخل المعلم مع رسالة واضحة وزر إعادة
    return NextResponse.json(
      {
        ok: true,
        authed: true,
        token: passcode,
        stats: EMPTY_STATS,
        submissions: [],
        dbError:
          "تم الدخول بنجاح، لكن تعذّر الاتصال بقاعدة البيانات مؤقتاً. اضغط (تحديث) بعد قليل.",
      },
      { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } },
    );
  }
}
