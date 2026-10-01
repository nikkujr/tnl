import type { PoolConnection } from "mysql2/promise";
import { db } from "../database/connection.js";

export async function transaction<T>(
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      const result = await work(connection);
      await connection.commit();
      return result;
    } catch (error: any) {
      await connection.rollback();
      if (
        !["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(error.code) ||
        attempt >= 2
      )
        throw error;
    } finally {
      connection.release();
    }
    await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
  }
}

export function jsonValue<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
