import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

/**
 * توافق Vercel:
 * - لا نرمي أي خطأ لحظة الاستيراد حتى ينجح البناء (next build) بدون متغيرات بيئة.
 * - ندعم أسماء متغيرات Vercel / Neon / Supabase الشائعة، لأن تكامل
 *   Vercel Postgres يضيف الرابط باسم POSTGRES_URL غالباً وليس DATABASE_URL.
 * - فعّل SSL تلقائياً للقواعد البعيدة (Neon وSupabase تشترطانه).
 */
const CANDIDATE_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_URL",
  "POSTGRES_PRISMA_URL",
  "NEON_DATABASE_URL",
  "DATABASE_PRIVATE_URL",
  "POSTGRES_URL_NON_POOLING",
] as const;

export function getConnectionString(): string | null {
  for (const key of CANDIDATE_ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function getConnectionEnvKey(): string | null {
  for (const key of CANDIDATE_ENV_KEYS) {
    if (process.env[key]?.trim()) return key;
  }
  return null;
}

function isLocalConnection(connectionString: string): boolean {
  try {
    const url = new URL(connectionString);
    const host = url.hostname.toLowerCase();
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      host.endsWith(".local")
    );
  } catch {
    return (
      connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
    );
  }
}

function buildPoolConfig(connectionString: string): PoolConfig {
  const config: PoolConfig = {
    connectionString,
    // حدود محافظة تناسب دوال Vercel عديمة الحالة (serverless)
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: true,
  };
  // القواعد السحابية البعيدة تشترط SSL — أما localhost المحلي فلا يحتاجه
  const wantsSsl =
    !isLocalConnection(connectionString) || /sslmode=require|ssl=true/i.test(connectionString);
  if (wantsSsl) {
    config.ssl = { rejectUnauthorized: false };
  }
  return config;
}

// سلسلة بديلة تُستخدم أثناء البناء فقط (لا يُفتح أي اتصال عند إنشاء الـ Pool)
const BUILD_TIME_FALLBACK = "postgresql://localhost:5432/placeholder_build_only";

const globalForDb = globalThis as typeof globalThis & {
  __arenaWorksheetPool?: Pool;
  __arenaWorksheetDb?: ReturnType<typeof createDb>;
};

function createPool(): Pool {
  if (globalForDb.__arenaWorksheetPool) return globalForDb.__arenaWorksheetPool;
  const connectionString = getConnectionString() ?? BUILD_TIME_FALLBACK;
  const pool = new Pool(buildPoolConfig(connectionString));
  pool.on("error", (err) => {
    console.error("[db] idle pool error", err);
  });
  globalForDb.__arenaWorksheetPool = pool;
  return pool;
}

function createDb() {
  return drizzle(createPool(), { schema });
}

export const pool: Pool = createPool();
export const db = (() => {
  if (globalForDb.__arenaWorksheetDb) return globalForDb.__arenaWorksheetDb;
  const instance = createDb();
  globalForDb.__arenaWorksheetDb = instance;
  return instance;
})();

export type AppDb = typeof db;

/**
 * يُستدعى في بداية أي عملية قاعدة بيانات ليعطي رسالة عربية واضحة
 * بدل انهيار غامض — خصوصاً عند نسيان ضبط المتغير على Vercel.
 */
export function assertDatabaseConfigured(): string {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error(
      "لم يتم ضبط قاعدة البيانات على Vercel. أضف متغير DATABASE_URL (رابط PostgreSQL) من: لوحة مشروع Vercel ← تبويب Settings ← Environment Variables، ثم أعد النشر (Redeploy).",
    );
  }
  if (process.env.VERCEL === "1" && isLocalConnection(connectionString)) {
    throw new Error(
      "رابط قاعدة البيانات يشير إلى localhost وهو لا يعمل على Vercel. استخدم رابط قاعدة بيانات سحابية (من Vercel Storage ← Create Database، أو Neon / Supabase) في DATABASE_URL ثم أعد النشر.",
    );
  }
  return connectionString;
}

/** يحوّل أي خطأ قاعدة بيانات إلى رسالة عربية مفهومة تُعرض للمعلم */
export function describeDbError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (!getConnectionString()) {
    return "لم يتم ضبط قاعدة البيانات (DATABASE_URL) في إعدادات Vercel. أضفه من Settings ← Environment Variables ثم أعد النشر (Redeploy).";
  }
  if (
    /ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ETIMEDOUT|timeout|Connection terminated|password authentication failed|database .* does not exist|self-signed certificate|no pg_hba/i.test(
      message,
    )
  ) {
    const key = getConnectionEnvKey() ?? "DATABASE_URL";
    return `تعذّر الاتصال بقاعدة البيانات (${key}). تحقق من صحة الرابط وأنه يقبل الاتصال من Vercel ثم أعد المحاولة. التفاصيل: ${message}`;
  }
  return `تعذّر تحميل البيانات من قاعدة البيانات. التفاصيل: ${message}`;
}
