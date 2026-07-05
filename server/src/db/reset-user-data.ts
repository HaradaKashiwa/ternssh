import { resetDefaultDashboard, type DashboardWithWidgets } from "./dashboards";

async function tableExists(db: D1Database, name: string): Promise<boolean> {
  const row = await db
    .prepare(
      "SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
    )
    .bind(name)
    .first<{ ok: number }>();
  return row != null;
}

export async function resetUserData(
  db: D1Database,
  userId: string,
): Promise<DashboardWithWidgets> {
  await db.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  await db.prepare("DELETE FROM servers WHERE user_id = ?").bind(userId).run();
  await db
    .prepare("UPDATE server_groups SET parent_id = NULL WHERE user_id = ?")
    .bind(userId)
    .run();
  await db
    .prepare("DELETE FROM server_groups WHERE user_id = ?")
    .bind(userId)
    .run();
  await db
    .prepare("DELETE FROM credentials WHERE user_id = ?")
    .bind(userId)
    .run();

  if (await tableExists(db, "saved_passwords")) {
    await db
      .prepare("DELETE FROM saved_passwords WHERE user_id = ?")
      .bind(userId)
      .run();
  }

  if (await tableExists(db, "saved_private_keys")) {
    await db
      .prepare("DELETE FROM saved_private_keys WHERE user_id = ?")
      .bind(userId)
      .run();
  }

  return resetDefaultDashboard(db, userId);
}
