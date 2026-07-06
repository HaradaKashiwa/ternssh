import type { User } from "../types";

export async function getUserById(db: D1Database, id: string): Promise<User | null> {
  return db
    .prepare(
      "SELECT id, email, display_name, created_at, updated_at FROM users WHERE id = ?",
    )
    .bind(id)
    .first<User>();
}

export async function ensureDefaultUser(db: D1Database): Promise<User> {
  const existing = await getUserById(db, "default");
  if (existing) return existing;

  await db
    .prepare(
      "INSERT INTO users (id, email, display_name) VALUES ('default', NULL, 'Default')",
    )
    .run();

  const user = await getUserById(db, "default");
  if (!user) throw new Error("Failed to create default user");
  return user;
}
