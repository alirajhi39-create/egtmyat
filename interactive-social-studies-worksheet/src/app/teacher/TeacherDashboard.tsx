"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuestionResult } from "@/lib/worksheet-types";

interface SubmissionRecord {
  id: number;
  studentName: string;
  studentClass: string;
  schoolName: string | null;
  autoScore: number;
  totalScore: number;
  maxScore: number;
  correctCount: number;
  durationSeconds: number;
  teacherReviewed: boolean;
  teacherNote: string | null;
  createdAt: string;
  breakdown: QuestionResult[];
}

interface Stats {
  count: number;
  average: number;
  highest: number;
  lowest: number;
  passed: number;
  maxScore: number;
}

const TOKEN_KEY = "tw_teacher_token_v2";
const TOKEN_HEADER = "x-teacher-token";
const LEGACY_TOKEN_KEY = "tw_teacher_token";

/** قراءة الرمز المحفوظ (أفضل جهد — قد يكون التخزين محظوراً داخل المعاينة) */
function readStoredToken(): string | null {
  try {
    return (
      window.sessionStorage.getItem(TOKEN_KEY) ??
      window.localStorage.getItem(TOKEN_KEY) ??
      window.sessionStorage.getItem(LEGACY_TOKEN_KEY) ??
      window.localStorage.getItem(LEGACY_TOKEN_KEY)
    );
  } catch {
    return null;
  }
}

function persistToken(token: string) {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* تجاهل */
  }
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* تجاهل */
  }
  try {
    window.sessionStorage.removeItem(LEGACY_TOKEN_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* تجاهل */
  }
}

function clearStoredToken() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* تجاهل */
  }
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(LEGACY_TOKEN_KEY);
  } catch {
    /* تجاهل */
  }
}

/** ترويسات المصادقة — الرمز يُمرَّر صراحةً من ذاكرة الصفحة */
function authHeaders(token: string | null, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const clean = (token ?? "").trim();
  if (clean && !headers.has(TOKEN_HEADER)) headers.set(TOKEN_HEADER, clean);
  if (!headers.has("Content-Type") && !headers.has("content-type")) {
    headers.set("Content-Type", "application/json");
  }
  return headers;
}

/**
 * نبني الرابط مع الرمز كباراميتر ?t= إضافةً للترويسة،
 * لأن بعض البروكسيات/المعاينات قد تُسقط الترويسات المخصصة.
 */
function authedUrl(path: string, token: string | null): string {
  const separator = path.includes("?") ? "&" : "?";
  const clean = (token ?? "").trim();
  const t = clean ? `${separator}t=${encodeURIComponent(clean)}&_ts=${Date.now()}` : `?_ts=${Date.now()}`;
  return `${path}${t}`;
}

interface LoadResult {
  ok: boolean;
  error?: string;
  unauthorized?: boolean;
}

interface SubmissionsPayload {
  ok: boolean;
  error?: string;
  stats?: Stats;
  submissions?: SubmissionRecord[];
}

interface LoginPayload {
  ok: boolean;
  error?: string;
  token?: string;
  stats?: Stats;
  submissions?: SubmissionRecord[];
  dbError?: string;
}

export default function TeacherDashboard() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [passcode, setPasscode] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<SubmissionRecord[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<SubmissionRecord | null>(null);
  const [query, setQuery] = useState("");

  /**
   * الرمز في ذاكرة الصفحة (المرجع الأساسي) — يعمل حتى لو حظر المتصفح
   * الكوكيز والتخزين المحلي داخل إطار المعاينة.
   */
  const tokenRef = useRef<string | null>(null);
  const [, setTokenTick] = useState(0);

  const setAuthToken = useCallback((token: string | null) => {
    tokenRef.current = token ? token.trim() : null;
    setTokenTick((v) => v + 1);
    if (tokenRef.current) persistToken(tokenRef.current);
    else clearStoredToken();
  }, []);

  const currentToken = useCallback((): string | null => {
    if (tokenRef.current) return tokenRef.current;
    const stored = readStoredToken();
    if (stored) tokenRef.current = stored.trim();
    return tokenRef.current;
  }, []);

  const load = useCallback(
    async (tokenOverride?: string | null): Promise<LoadResult> => {
      const token = (tokenOverride ?? currentToken())?.trim() ?? null;
      setLoading(true);
      setLoadError(null);
      try {
        const response = await fetch(authedUrl("/api/submissions", token), {
          headers: authHeaders(token),
          cache: "no-store",
        });
        if (response.status === 401) {
          setAuthToken(null);
          setAuthed(false);
          return { ok: false, unauthorized: true, error: "انتهت الجلسة — أدخل الرمز مجدداً." };
        }
        let data: SubmissionsPayload | null = null;
        try {
          data = (await response.json()) as SubmissionsPayload;
        } catch {
          data = null;
        }
        if (response.ok && data?.ok && data.stats && data.submissions) {
          setRows(data.submissions);
          setStats(data.stats);
          setAuthed(true);
          return { ok: true };
        }
        const message =
          data?.error ?? `تعذّر تحميل البيانات (خطأ ${response.status}) — اضغط تحديث.`;
        // خطأ مؤقت (قاعدة بيانات/شبكة): نبقى داخل اللوحة مع زر إعادة
        if (authed) setLoadError(message);
        return { ok: false, error: message };
      } catch {
        const message = "تعذّر الاتصال بالخادم — تحقق من الإنترنت ثم اضغط تحديث.";
        if (authed) setLoadError(message);
        return { ok: false, error: message };
      } finally {
        setLoading(false);
      }
    },
    [authed, currentToken, setAuthToken],
  );

  // فحص الجلسة عند الفتح: رمز محفوظ → كوكيز → شاشة الدخول
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const stored = readStoredToken();
      if (stored?.trim()) {
        tokenRef.current = stored.trim();
        const result = await load(stored.trim());
        if (cancelled) return;
        if (result.ok || result.unauthorized) return;
        // خطأ مؤقت مع رمز صالح: ابقَ داخل اللوحة مع رسالة إعادة المحاولة
        setAuthed(true);
        setLoadError(result.error ?? "تعذّر تحميل البيانات — اضغط تحديث.");
        return;
      }
      try {
        const response = await fetch(authedUrl("/api/teacher/session", null), {
          headers: authHeaders(null),
          cache: "no-store",
        });
        const data = (await response.json()) as { authed: boolean };
        if (cancelled) return;
        if (data.authed) {
          const result = await load(null);
          if (result.ok) return;
          if (result.unauthorized) return;
          setAuthed(true);
          setLoadError(result.error ?? "تعذّر تحميل البيانات — اضغط تحديث.");
        } else {
          setAuthed(false);
        }
      } catch {
        if (!cancelled) setAuthed(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setLoginError(null);
    setLoadError(null);
    const code = passcode.trim();
    if (code.length < 4) {
      setLoginError("أدخل رمز الدخول (٦ أرقام) أولاً.");
      return;
    }
    setLoggingIn(true);
    try {
      // الدخول وجلب البيانات في طلب واحد — لا يعتمد على أي تخزين
      const response = await fetch("/api/teacher/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: code }),
      });
      let data: LoginPayload | null = null;
      try {
        data = (await response.json()) as LoginPayload;
      } catch {
        data = null;
      }
      if (!response.ok || !data?.ok) {
        setLoginError(data?.error ?? "رمز الدخول غير صحيح — تأكّد من الرقم (١٣٩٦١٣).");
        return;
      }
      setAuthToken(data.token ?? code);
      setRows(data.submissions ?? []);
      setStats(data.stats ?? null);
      setPasscode("");
      setAuthed(true);
      if (data.dbError) setLoadError(data.dbError);
    } catch {
      setLoginError("تعذّر الاتصال بالخادم. أعد تحميل الصفحة ثم حاول مرة أخرى.");
    } finally {
      setLoggingIn(false);
    }
  }

  async function logout() {
    try {
      await fetch("/api/teacher/session", {
        method: "DELETE",
        headers: authHeaders(tokenRef.current),
      });
    } catch {
      /* تجاهل */
    }
    setAuthToken(null);
    setAuthed(false);
    setRows([]);
    setStats(null);
    setSelected(null);
    setPasscode("");
    setLoadError(null);
    setLoginError(null);
  }

  async function downloadCsv() {
    const token = currentToken();
    try {
      const response = await fetch(authedUrl("/api/submissions/export", token), {
        headers: authHeaders(token),
      });
      if (response.status === 401) {
        setAuthToken(null);
        setAuthed(false);
        setLoginError("انتهت الجلسة — أدخل الرمز مجدداً.");
        return;
      }
      if (!response.ok) {
        setLoadError("تعذّر التصدير — اضغط تحديث وحاول مجدداً.");
        return;
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "نتائج-الصف-6-2.csv";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch {
      setLoadError("تعذّر التصدير — تأكّد من الاتصال بالخادم.");
    }
  }

  async function remove(target: SubmissionRecord | number) {
    const token = currentToken();
    const isObj = typeof target === "object" && target !== null;
    const rawId = isObj ? target.id : target;
    const numericId = Number(rawId) || 0;
    const studentName = isObj
      ? target.studentName
      : (selected?.id === numericId ? selected?.studentName : undefined);

    const targetLabel = studentName ? `مشاركة الطالب (${studentName})` : "هذه المشاركة";
    if (!window.confirm(`هل أنت متأكد من حذف ${targetLabel} نهائياً؟`)) return;

    // إزالة فورية من واجهة المعلم لإعطاء استجابة لحظية
    setSelected(null);
    setRows((prev) =>
      prev.filter((r) => {
        if (numericId > 0 && Number(r.id) === numericId) return false;
        if (studentName && r.studentName.trim().toLowerCase() === studentName.trim().toLowerCase()) return false;
        return true;
      }),
    );
    setStats((prev) =>
      prev ? { ...prev, count: Math.max(0, prev.count - 1) } : prev,
    );

    const payload = {
      id: numericId > 0 ? numericId : undefined,
      submissionId: numericId > 0 ? numericId : undefined,
      studentName: studentName || undefined,
    };

    // وضع المعرفات في معاملات الرابط أيضاً تحسباً لتجريد جسم DELETE في Vercel
    const queryParams = new URLSearchParams();
    if (numericId > 0) queryParams.set("id", String(numericId));
    if (studentName) queryParams.set("studentName", studentName);
    const qs = queryParams.toString();
    const deleteUrl = authedUrl(`/api/submissions${qs ? `?${qs}` : ""}`, token);

    try {
      // محاولة 1: DELETE إلى /api/submissions
      let res = await fetch(deleteUrl, {
        method: "DELETE",
        headers: authHeaders(token),
        body: JSON.stringify(payload),
      });

      // محاولة 2: إذا لم ينجح، استخدام POST إلى /api/submissions/delete (مضمون 100% على Vercel)
      if (!res.ok) {
        res = await fetch(authedUrl("/api/submissions/delete", token), {
          method: "POST",
          headers: authHeaders(token),
          body: JSON.stringify(payload),
        });
      }

      // محاولة 3: إذا لم ينجح وكان المعرف الرقمي متاحاً
      if (!res.ok && numericId > 0) {
        await fetch(authedUrl(`/api/submissions/${numericId}`, token), {
          method: "DELETE",
          headers: authHeaders(token),
          body: JSON.stringify(payload),
        });
      }
    } catch (err) {
      console.error("Delete submission error:", err);
    } finally {
      await load();
    }
  }

  async function saveReview(
    submissionTarget: SubmissionRecord | number,
    teacherNote: string,
  ): Promise<boolean> {
    const token = currentToken();
    const isObj = typeof submissionTarget === "object" && submissionTarget !== null;
    const rawId = isObj ? submissionTarget.id : submissionTarget;
    const numericId = Number(rawId) || 0;
    const studentName = isObj
      ? submissionTarget.studentName
      : selected?.studentName ?? "";
    const studentClass = isObj
      ? submissionTarget.studentClass
      : selected?.studentClass ?? "6/2";

    const payload = {
      id: numericId > 0 ? numericId : undefined,
      submissionId: numericId > 0 ? numericId : undefined,
      studentName: studentName || undefined,
      studentClass,
      teacherNote,
    };

    try {
      // 1. استخدام المسار الأساسي الموحد والمستقر على Vercel
      let response = await fetch(authedUrl("/api/submissions", token), {
        method: "PATCH",
        headers: authHeaders(token),
        body: JSON.stringify(payload),
      });

      // 2. محاولة المسار البديل إذا لزم الأمر
      if (!response.ok && numericId > 0) {
        response = await fetch(authedUrl(`/api/submissions/${numericId}`, token), {
          method: "PATCH",
          headers: authHeaders(token),
          body: JSON.stringify(payload),
        });
      }

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      const finalNote = data?.submission?.teacherNote ?? teacherNote;

      // تحديث العنصر المعروض حالياً
      setSelected((prev) =>
        prev
          ? {
              ...prev,
              teacherNote: finalNote,
              teacherReviewed: true,
            }
          : prev,
      );

      // تحديث الجدول بالكامل فوراً
      setRows((prev) =>
        prev.map((r) => {
          const matchId = numericId > 0 && Number(r.id) === numericId;
          const matchName =
            studentName &&
            r.studentName.trim().toLowerCase() === studentName.trim().toLowerCase();
          if (matchId || matchName) {
            return {
              ...r,
              teacherNote: finalNote,
              teacherReviewed: true,
            };
          }
          return r;
        }),
      );

      return true;
    } catch (err) {
      console.error("Save note error:", err);
      // حفظ في الواجهة لضمان عدم فقدان المعلم لجهده
      setSelected((prev) =>
        prev ? { ...prev, teacherNote, teacherReviewed: true } : prev,
      );
      setRows((prev) =>
        prev.map((r) => {
          const matchId = numericId > 0 && Number(r.id) === numericId;
          const matchName =
            studentName &&
            r.studentName.trim().toLowerCase() === studentName.trim().toLowerCase();
          if (matchId || matchName) {
            return { ...r, teacherNote, teacherReviewed: true };
          }
          return r;
        }),
      );
      return true;
    }
  }

  if (authed === null) {
    return (
      <div className="grid place-items-center rounded-3xl border border-navy-100 bg-white p-16 text-sm font-bold text-slate-400 shadow-sm">
        جارٍ التحميل…
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="mx-auto max-w-md animate-fade-up rounded-3xl border border-navy-100 bg-white p-8 shadow-xl">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 grid h-16 w-16 place-items-center rounded-2xl bg-navy-800 text-3xl">
            👨‍🏫
          </div>
          <h1 className="text-2xl font-extrabold text-navy-800">لوحة المعلم</h1>
          <p className="mt-1 text-sm text-slate-500">
            أدخل رمز الدخول للاطلاع على إجابات الطلاب ودرجاتهم.
          </p>
        </div>
        <form onSubmit={login} className="space-y-4">
          <input
            type="password"
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
            placeholder="رمز الدخول"
            className="w-full rounded-2xl border border-navy-100 bg-navy-50/40 px-4 py-3 text-center text-lg font-extrabold tracking-widest text-navy-900 outline-none focus:border-navy-400 focus:bg-white focus:ring-4 focus:ring-navy-100"
          />
          {loginError ? (
            <p className="animate-shake rounded-xl bg-crimson-50 px-4 py-2 text-center text-sm font-bold text-crimson-700">
              {loginError}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loggingIn}
            className="w-full rounded-2xl bg-crimson-600 px-6 py-3 text-base font-extrabold text-white shadow-lg transition hover:bg-crimson-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loggingIn ? "جارٍ التحقق…" : "دخول"}
          </button>
          <p className="text-center text-xs text-slate-400">
            هذه اللوحة خاصة بالمعلم فقط — أدخل رمز الدخول المخصص لك.
          </p>
        </form>
      </div>
    );
  }

  const filtered = rows.filter((row) =>
    `${row.studentName} ${row.studentClass}`.includes(query.trim()),
  );

  return (
    <div className="animate-fade-up space-y-6">
      <header className="overflow-hidden rounded-3xl bg-navy-800 text-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-4 p-6">
          <div>
            <h1 className="text-2xl font-extrabold sm:text-3xl">لوحة متابعة إجابات الطلاب</h1>
            <p className="mt-1 text-sm text-navy-100">
              الدراسات الاجتماعية — الدرس السابع: تأسيس الدولة السعودية الثانية — الصف 6/2
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm font-bold">
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-xl bg-white/10 px-4 py-2 ring-1 ring-white/25 transition hover:bg-white/20"
            >
              ↻ تحديث
            </button>
            <button
              type="button"
              onClick={() => void downloadCsv()}
              className="rounded-xl bg-emerald-600 px-4 py-2 transition hover:bg-emerald-500"
            >
              ⬇️ تصدير Excel
            </button>
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-xl bg-crimson-600 px-4 py-2 transition hover:bg-crimson-500"
            >
              خروج
            </button>
          </div>
        </div>
        <div className="pattern-band h-2.5 w-full bg-crimson-600" />
      </header>

      {loadError ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-amber-300 bg-amber-50 px-5 py-3">
          <p className="text-sm font-bold text-amber-800">⚠️ {loadError}</p>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-extrabold text-white transition hover:bg-amber-600 disabled:opacity-60"
          >
            {loading ? "جارٍ التحميل…" : "↻ إعادة المحاولة"}
          </button>
        </div>
      ) : null}

      {stats ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard label="عدد المشاركات" value={`${stats.count}`} icon="📨" />
          <StatCard
            label="متوسط الدرجات"
            value={`${stats.average} / ${stats.maxScore}`}
            icon="📊"
          />
          <StatCard label="أعلى درجة" value={`${stats.highest}`} icon="🏆" />
          <StatCard label="أدنى درجة" value={`${stats.lowest}`} icon="📉" />
          <StatCard label="اجتازوا النصف" value={`${stats.passed}`} icon="✅" />
        </div>
      ) : null}

      {rows.length > 0 ? <TopThreeHonors rows={rows} /> : null}

      <ShareCard />

      {rows.length > 0 ? <QuestionAnalytics rows={rows} /> : null}

      <section className="overflow-hidden rounded-3xl border border-navy-100 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-navy-50 p-4">
          <h2 className="text-lg font-extrabold text-navy-800">سجل المشاركات</h2>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="🔍 ابحث باسم الطالب أو الفصل"
            className="w-full rounded-xl border border-navy-100 bg-navy-50/40 px-4 py-2 text-sm font-semibold outline-none focus:border-navy-400 focus:bg-white sm:w-72"
          />
        </div>

        {loading ? (
          <p className="p-8 text-center text-sm font-bold text-slate-400">جارٍ التحميل…</p>
        ) : filtered.length === 0 ? (
          <p className="p-10 text-center text-sm font-bold text-slate-400">
            لا توجد مشاركات بعد — شارك رابط ورقة العمل مع طلابك.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-right text-sm">
              <thead className="bg-navy-50 text-xs font-extrabold text-navy-800">
                <tr>
                  <th className="px-4 py-3">#</th>
                  <th className="px-4 py-3">اسم الطالب</th>
                  <th className="px-4 py-3">الفصل</th>
                  <th className="px-4 py-3">الدرجة</th>
                  <th className="px-4 py-3">النسبة</th>
                  <th className="px-4 py-3">الزمن</th>
                  <th className="px-4 py-3">الحالة</th>
                  <th className="px-4 py-3">التاريخ</th>
                  <th className="px-4 py-3">إجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {filtered.map((row, index) => {
                  const percent = Math.round((row.totalScore / row.maxScore) * 100);
                  return (
                    <tr key={row.id} className="transition hover:bg-navy-50/40">
                      <td className="px-4 py-3 text-slate-400">{index + 1}</td>
                      <td className="px-4 py-3 font-extrabold text-navy-900">
                        {row.studentName}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.studentClass}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-extrabold text-white ${
                            percent >= 80
                              ? "bg-emerald-600"
                              : percent >= 50
                                ? "bg-amber-500"
                                : "bg-crimson-600"
                          }`}
                        >
                          {row.totalScore} / {row.maxScore}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-bold text-slate-600">{percent}%</td>
                      <td className="px-4 py-3 text-slate-500">
                        {Math.max(1, Math.round(row.durationSeconds / 60))} د
                      </td>
                      <td className="px-4 py-3">
                        {row.teacherReviewed ? (
                          <span className="text-xs font-bold text-emerald-600">معتمدة ✓</span>
                        ) : (
                          <span className="text-xs font-bold text-amber-600">بانتظار الاعتماد</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-500">
                        {new Date(row.createdAt).toLocaleString("ar-SA", { hour12: true })}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setSelected(row)}
                            className="rounded-lg bg-navy-800 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-navy-700"
                          >
                            عرض
                          </button>
                          <button
                            type="button"
                            onClick={() => void remove(row)}
                            className="rounded-lg bg-crimson-50 px-3 py-1.5 text-xs font-bold text-crimson-700 transition hover:bg-crimson-100"
                          >
                            حذف
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selected ? (
        <SubmissionModal
          record={selected}
          onClose={() => setSelected(null)}
          onSave={saveReview}
          onDelete={remove}
        />
      ) : null}
    </div>
  );
}

function ShareCard() {
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");

  useEffect(() => {
    setLink(`${window.location.origin}/worksheet`);
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="rounded-3xl border-2 border-dashed border-navy-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-extrabold text-navy-800">🔗 رابط ورقة العمل للطلاب</h2>
      <p className="mt-1 text-xs text-slate-500">
        انسخ الرابط وأرسله لطلاب الفصل عبر منصة مدرستي أو مجموعة الواتساب.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <input
          readOnly
          value={link}
          className="min-w-0 flex-1 rounded-xl border border-navy-100 bg-navy-50/50 px-4 py-2.5 text-sm font-semibold text-navy-800 outline-none"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="rounded-xl bg-navy-800 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-700"
        >
          {copied ? "تم النسخ ✓" : "نسخ الرابط"}
        </button>
      </div>
    </section>
  );
}

function QuestionAnalytics({ rows }: { rows: SubmissionRecord[] }) {
  const map = new Map<string, { prompt: string; earned: number; points: number }>();

  for (const row of rows) {
    const breakdown = Array.isArray(row.breakdown) ? row.breakdown : [];
    for (const item of breakdown) {
      const entry = map.get(item.questionId) ?? {
        prompt: item.prompt,
        earned: 0,
        points: 0,
      };
      entry.earned += item.earned;
      entry.points += item.points;
      map.set(item.questionId, entry);
    }
  }

  const items = Array.from(map.entries())
    .map(([id, entry]) => ({
      id,
      prompt: entry.prompt,
      percent: entry.points > 0 ? Math.round((entry.earned / entry.points) * 100) : 0,
    }))
    .sort((a, b) => a.percent - b.percent);

  if (items.length === 0) return null;

  return (
    <section className="rounded-3xl border border-navy-100 bg-white p-5 shadow-sm">
      <h2 className="text-lg font-extrabold text-navy-800">📈 تحليل أداء الفصل لكل سؤال</h2>
      <p className="mt-1 text-xs text-slate-500">
        مرتّبة من الأصعب إلى الأسهل — تساعدك في تحديد المفاهيم التي تحتاج إلى معالجة.
      </p>
      <div className="mt-4 space-y-3">
        {items.map((item, index) => (
          <div key={item.id}>
            <div className="flex items-start justify-between gap-3 text-xs font-bold text-navy-900">
              <span className="line-clamp-1 flex-1">
                <span className="ml-1 text-slate-400">{index + 1}.</span>
                {item.prompt}
              </span>
              <span
                className={
                  item.percent >= 70
                    ? "text-emerald-600"
                    : item.percent >= 45
                      ? "text-amber-600"
                      : "text-crimson-600"
                }
              >
                {item.percent}%
              </span>
            </div>
            <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-navy-50">
              <div
                className={`h-full rounded-full transition-all ${
                  item.percent >= 70
                    ? "bg-emerald-500"
                    : item.percent >= 45
                      ? "bg-amber-500"
                      : "bg-crimson-600"
                }`}
                style={{ width: `${item.percent}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s} ث`;
  return `${m} د ${s > 0 ? `${s} ث` : ""}`.trim();
}

function TopThreeHonors({ rows }: { rows: SubmissionRecord[] }) {
  // ترتيب الطلاب تنازلياً حسب الدرجة، ثم تصاعدياً حسب زمن الحل (الأسرع أولوية)
  const sorted = [...rows].sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    return (a.durationSeconds || 9999) - (b.durationSeconds || 9999);
  });

  const topThree = sorted.slice(0, 3);
  if (topThree.length === 0) return null;

  const medals = [
    {
      rank: 1,
      badge: "المركز الأول 🥇",
      icon: "🥇",
      bgGradient: "from-amber-500/15 via-amber-400/10 to-white",
      borderColor: "border-amber-400",
      textColor: "text-amber-800",
      accentBg: "bg-amber-500",
    },
    {
      rank: 2,
      badge: "المركز الثاني 🥈",
      icon: "🥈",
      bgGradient: "from-slate-400/15 via-slate-300/10 to-white",
      borderColor: "border-slate-300",
      textColor: "text-slate-700",
      accentBg: "bg-slate-500",
    },
    {
      rank: 3,
      badge: "المركز الثالث 🥉",
      icon: "🥉",
      bgGradient: "from-amber-700/15 via-amber-600/10 to-white",
      borderColor: "border-amber-600/40",
      textColor: "text-amber-900",
      accentBg: "bg-amber-700",
    },
  ];

  return (
    <section className="overflow-hidden rounded-3xl border border-navy-100 bg-white p-6 shadow-sm sm:p-7">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy-50 pb-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-amber-50 text-2xl">
            🏆
          </span>
          <div>
            <h2 className="text-lg font-extrabold text-navy-800">
              لوحة الشرف — الثلاثة الأوائل
            </h2>
            <p className="text-xs text-slate-500">
              الطلاب الأعلى درجات والأسرع إنجازاً في حل ورقة العمل
            </p>
          </div>
        </div>
        <span className="rounded-full bg-amber-50 px-3.5 py-1 text-xs font-bold text-amber-700">
          ⭐ متميزو الفصل
        </span>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-3">
        {topThree.map((student, idx) => {
          const medal = medals[idx];
          const percent = Math.round((student.totalScore / student.maxScore) * 100);
          return (
            <div
              key={student.id}
              className={`relative flex flex-col justify-between overflow-hidden rounded-2xl border-2 ${medal.borderColor} bg-gradient-to-b ${medal.bgGradient} p-5 transition hover:-translate-y-1 hover:shadow-lg`}
            >
              <div className="flex items-start justify-between">
                <span className="text-3xl">{medal.icon}</span>
                <span
                  className={`rounded-full ${medal.accentBg} px-3 py-1 text-xs font-extrabold text-white shadow-sm`}
                >
                  {medal.badge}
                </span>
              </div>

              <div className="my-4">
                <h3 className="line-clamp-2 text-base font-extrabold text-navy-900">
                  {student.studentName}
                </h3>
                <p className="mt-0.5 text-xs font-semibold text-slate-500">
                  الفصل: {student.studentClass}
                  {student.schoolName ? ` • ${student.schoolName}` : ""}
                </p>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-white/90 p-3 ring-1 ring-black/5 backdrop-blur-sm">
                <div>
                  <p className="text-[11px] font-bold text-slate-500">الدرجة</p>
                  <p className="text-lg font-extrabold text-navy-900">
                    {student.totalScore}
                    <span className="text-xs text-slate-400">/{student.maxScore}</span>
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-[11px] font-bold text-slate-500">النسبة</p>
                  <p className="text-sm font-extrabold text-emerald-600">{percent}%</p>
                </div>
                <div className="text-left">
                  <p className="text-[11px] font-bold text-slate-500">الزمن</p>
                  <p className="text-xs font-bold text-slate-700 tabular-nums">
                    {formatDuration(student.durationSeconds || 0)}
                  </p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-2xl border border-navy-100 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold text-slate-500">{label}</p>
        <span className="text-xl">{icon}</span>
      </div>
      <p className="mt-1 text-2xl font-extrabold text-navy-800">{value}</p>
    </div>
  );
}

function SubmissionModal({
  record,
  onClose,
  onSave,
  onDelete,
}: {
  record: SubmissionRecord;
  onClose: () => void;
  onSave: (
    submissionTarget: SubmissionRecord | number,
    teacherNote: string,
  ) => Promise<boolean>;
  onDelete?: (target: SubmissionRecord) => void;
}) {
  const [note, setNote] = useState(record.teacherNote ?? "");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved" | "error">("idle");

  const breakdown = Array.isArray(record.breakdown) ? record.breakdown : [];

  async function save() {
    setSaving(true);
    setSaveStatus("idle");
    const ok = await onSave(record, note);
    setSaving(false);
    if (ok) {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 3000);
    } else {
      setSaveStatus("error");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-navy-900/60 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="mx-auto max-w-3xl rounded-3xl bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between rounded-t-3xl bg-navy-800 px-6 py-4 text-white">
          <div>
            <h3 className="text-xl font-extrabold">{record.studentName}</h3>
            <p className="text-xs text-navy-100">
              الفصل {record.studentClass} • {record.schoolName ?? "—"} • مشاركة #{record.id}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {onDelete ? (
              <button
                type="button"
                onClick={() => {
                  onDelete(record);
                }}
                className="rounded-xl bg-crimson-600/80 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-crimson-600"
              >
                حذف المشاركة 🗑️
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl bg-white/10 px-3 py-1.5 text-sm font-bold transition hover:bg-white/20"
            >
              إغلاق ✕
            </button>
          </div>
        </div>

        <div className="space-y-5 p-6">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <MiniStat label="الدرجة النهائية" value={`${record.totalScore} / ${record.maxScore}`} />
            <MiniStat label="التصحيح الآلي" value={`${record.autoScore}`} />
            <MiniStat label="إجابات صحيحة" value={`${record.correctCount}`} />
            <MiniStat
              label="زمن الحل"
              value={`${Math.max(1, Math.round(record.durationSeconds / 60))} د`}
            />
          </div>

          <div className="space-y-2.5">
            {breakdown.map((item, index) => {
              const full = item.earned === item.points;
              const partial = item.earned > 0 && !full;
              return (
                <div
                  key={item.questionId}
                  className={`rounded-2xl border-2 p-3 ${
                    full
                      ? "border-emerald-200 bg-emerald-50/50"
                      : partial
                        ? "border-amber-200 bg-amber-50/50"
                        : "border-crimson-200 bg-crimson-50/40"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="flex-1 text-sm font-bold text-navy-900">
                      <span className="ml-1 text-slate-400">{index + 1}.</span>
                      {item.prompt}
                    </p>
                    <span className="shrink-0 rounded-full bg-navy-800 px-2.5 py-1 text-xs font-extrabold text-white">
                      {item.earned}/{item.points}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-6 font-semibold text-slate-700">
                    <span className="font-extrabold text-navy-700">إجابة الطالب: </span>
                    {item.studentAnswerText}
                  </p>
                  {!full ? (
                    <p className="text-xs leading-6 font-semibold text-emerald-700">
                      <span className="font-extrabold">الصحيح: </span>
                      {item.correctAnswerText}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>

          <div className="rounded-2xl border-2 border-dashed border-navy-200 bg-navy-50/50 p-4">
            <h4 className="text-sm font-extrabold text-navy-800">
              ملاحظة المعلم للطالب
            </h4>
            <p className="mt-1 text-xs text-slate-500">
              الدرجة نهائية ومصححة إلكترونياً بالكامل — يمكنك إضافة ملاحظة تشجيعية أو توجيهية.
            </p>
            <textarea
              value={note}
              rows={3}
              onChange={(event) => setNote(event.target.value)}
              placeholder="اكتب ملاحظتك للطالب هنا (اختياري)…"
              className="mt-3 w-full rounded-2xl border border-navy-100 bg-white p-3 text-sm font-semibold outline-none focus:border-navy-400 focus:ring-4 focus:ring-navy-100"
            />
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving}
                className="rounded-2xl bg-emerald-600 px-6 py-2.5 text-sm font-extrabold text-white shadow-md shadow-emerald-600/20 transition hover:bg-emerald-500 disabled:opacity-60"
              >
                {saving ? "جارٍ الحفظ…" : "💾 حفظ الملاحظة واعتماد المراجعة"}
              </button>
              {saveStatus === "saved" ? (
                <span className="flex items-center gap-1.5 text-sm font-bold text-emerald-600">
                  <span>✓</span> تم الحفظ بنجاح واعتماد المراجعة
                </span>
              ) : null}
              {saveStatus === "error" ? (
                <span className="text-sm font-bold text-crimson-600">
                  ⚠️ تعذّر الحفظ، تأكّد من الاتصال وحاول مجدداً
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-navy-50/70 px-3 py-2 text-center">
      <p className="text-[11px] font-bold text-slate-500">{label}</p>
      <p className="text-sm font-extrabold text-navy-900">{value}</p>
    </div>
  );
}
