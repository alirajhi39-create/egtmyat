import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

const databaseUrl = process.env.DATABASE_URL?.trim();

export function isDbConfigured(): boolean {
  return Boolean(databaseUrl && databaseUrl.length > 5);
}

function createPoolConfig(): PoolConfig {
  if (!databaseUrl) {
    return { connectionString: "postgresql://localhost:5432/mock" };
  }

  const isLocal =
    databaseUrl.includes("127.0.0.1") ||
    databaseUrl.includes("localhost");

  // قواعد البيانات السحابية (Neon, Supabase, Vercel Postgres, Railway) على Vercel تتطلب SSL
  const needsSsl =
    !isLocal ||
    databaseUrl.includes("sslmode=require") ||
    databaseUrl.includes("ssl=true");

  return {
    connectionString: databaseUrl,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool: Pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool(createPoolConfig());

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool, { schema });
