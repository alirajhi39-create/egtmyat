import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, getConnectionEnvKey, getConnectionString } from "@/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * فحص تشخيصي: افتح https://your-app.vercel.app/api/health في المتصفح
 * - db: "connected" تعني كل شيء سليم
 * - db: "missing-env" تعني أن DATABASE_URL غير مضبوط على Vercel
 * - db: "error" تعني أن الرابط موجود لكن الاتصال يفشل (راجع error)
 */
export async function GET() {
  const configured = Boolean(getConnectionString());
  if (!configured) {
    return NextResponse.json(
      {
        ok: false,
        db: "missing-env",
        hint: "أضف متغير DATABASE_URL (رابط PostgreSQL) في Vercel من Settings ← Environment Variables ثم أعد النشر (Redeploy).",
      },
      { status: 500 },
    );
  }
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true, db: "connected", via: getConnectionEnvKey() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        ok: false,
        db: "error",
        via: getConnectionEnvKey(),
        error: message,
        hint: "الرابط موجود لكن الاتصال فشل. تأكد من صحة الرابط وأنه يقبل الاتصال من Vercel.",
      },
      { status: 500 },
    );
  }
}
