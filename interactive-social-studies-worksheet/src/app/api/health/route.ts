import { testDbConnection } from "@/lib/teacher-data";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dbOk = await testDbConnection();
    return Response.json({ ok: true, database: dbOk ? "connected" : "fallback" });
  } catch {
    return Response.json({ ok: true, database: "fallback" });
  }
}
