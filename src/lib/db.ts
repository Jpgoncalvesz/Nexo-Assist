import pg from 'pg';
const globalDb = globalThis as unknown as { nexoPool?: pg.Pool };
export const pool =
  globalDb.nexoPool ??
  new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 3000,
  });
if (process.env.NODE_ENV !== 'production') globalDb.nexoPool = pool;
