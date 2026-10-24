import { NextResponse } from "next/server";
import { isTeacherAuthed, unauthorized } from "@/lib/teacher-auth";
import { fetchDashboardData } from "@/lib/teacher-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`;
}

export async function GET(request: Request) {
  if (!(await isTeacherAuthed(request))) return unauthorized();

  try {
    const { submissions: rows } = await fetchDashboardData();

    const header = [
      "م",
      "اسم الطالب",
      "الفصل",
      "المدرسة",
      "الدرجة النهائية (تصحيح إلكتروني)",
      "من",
      "عدد الإجابات الصحيحة",
      "زمن الحل (دقيقة)",
      "روجعت من المعلم",
      "ملاحظة المعلم",
      "تاريخ الإرسال",
    ];

    const lines = [header.map(csvCell).join(",")];
    rows.forEach((row, index) => {
      lines.push(
        [
          index + 1,
          row.studentName,
          row.studentClass,
          row.schoolName ?? "",
          row.totalScore,
          row.maxScore,
          row.correctCount,
          Math.round(row.durationSeconds / 60),
          row.teacherReviewed ? "نعم" : "لا",
          row.teacherNote ?? "",
          new Date(row.createdAt).toLocaleString("ar-SA"),
        ]
          .map(csvCell)
          .join(","),
      );
    });

    const csv = "\uFEFF" + lines.join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="results-grade6-2.csv"`,
      },
    });
  } catch (err) {
    console.error("export failed", err);
    return NextResponse.json({ ok: false, error: "تعذّر التصدير" }, { status: 500 });
  }
}
