import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema';
export function database(url: string) {
  const sql = postgres(url, { max: 5 });
  return { sql, db: drizzle(sql, { schema }) };
}
export type Database = ReturnType<typeof database>['db'];
