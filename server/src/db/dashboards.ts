import { newId } from "../lib/id";
import type { DashboardRecord, DashboardWidgetRecord } from "../types";

export interface DashboardWithWidgets {
  dashboard: DashboardRecord;
  widgets: DashboardWidgetRecord[];
}

export const DEFAULT_DASHBOARD_WIDGETS: Array<{
  type: string;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
  config_json: string | null;
}> = [
  {
    type: "server_list",
    grid_x: 0,
    grid_y: 0,
    grid_w: 3,
    grid_h: 8,
    config_json: null,
  },
  {
    type: "terminal",
    grid_x: 3,
    grid_y: 0,
    grid_w: 6,
    grid_h: 8,
    config_json: null,
  },
  {
    type: "file_manager",
    grid_x: 9,
    grid_y: 0,
    grid_w: 3,
    grid_h: 8,
    config_json: null,
  },
];

export async function getDefaultDashboard(
  db: D1Database,
  userId: string,
): Promise<DashboardWithWidgets | null> {
  const dashboard = await db
    .prepare(
      `SELECT id, user_id, name, is_default, layout_json, created_at, updated_at
       FROM dashboards WHERE user_id = ? AND is_default = 1 LIMIT 1`,
    )
    .bind(userId)
    .first<DashboardRecord>();

  if (!dashboard) return null;

  const { results: widgets } = await db
    .prepare(
      `SELECT id, dashboard_id, type, config_json, grid_x, grid_y, grid_w, grid_h
       FROM dashboard_widgets WHERE dashboard_id = ? ORDER BY grid_y, grid_x`,
    )
    .bind(dashboard.id)
    .all<DashboardWidgetRecord>();

  return { dashboard, widgets: widgets ?? [] };
}

export async function ensureDefaultDashboard(
  db: D1Database,
  userId: string,
): Promise<DashboardWithWidgets> {
  const existing = await getDefaultDashboard(db, userId);
  if (existing) return existing;

  const dashboardId = newId();
  const defaultLayout = JSON.stringify([]);
  const defaultWidgets = DEFAULT_DASHBOARD_WIDGETS;

  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO dashboards (id, user_id, name, is_default, layout_json)
         VALUES (?, ?, 'Default', 1, ?)`,
      )
      .bind(dashboardId, userId, defaultLayout),
  ];

  for (const widget of defaultWidgets) {
    statements.push(
      db
        .prepare(
          `INSERT INTO dashboard_widgets (id, dashboard_id, type, config_json, grid_x, grid_y, grid_w, grid_h)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          newId(),
          dashboardId,
          widget.type,
          widget.config_json,
          widget.grid_x,
          widget.grid_y,
          widget.grid_w,
          widget.grid_h,
        ),
    );
  }

  await db.batch(statements);

  const created = await getDefaultDashboard(db, userId);
  if (!created) throw new Error("Failed to create default dashboard");
  return created;
}

export async function updateDashboard(
  db: D1Database,
  userId: string,
  input: {
    name?: string;
    layout_json?: string;
    widgets?: Array<{
      id?: string;
      type: string;
      config_json?: string | null;
      grid_x: number;
      grid_y: number;
      grid_w: number;
      grid_h: number;
    }>;
  },
): Promise<DashboardWithWidgets> {
  const current = await ensureDefaultDashboard(db, userId);
  const dashboardId = current.dashboard.id;

  const statements: D1PreparedStatement[] = [];

  if (input.name !== undefined || input.layout_json !== undefined) {
    statements.push(
      db
        .prepare(
          `UPDATE dashboards SET
            name = ?,
            layout_json = ?,
            updated_at = datetime('now')
           WHERE id = ? AND user_id = ?`,
        )
        .bind(
          input.name ?? current.dashboard.name,
          input.layout_json ?? current.dashboard.layout_json,
          dashboardId,
          userId,
        ),
    );
  }

  if (input.widgets !== undefined) {
    statements.push(
      db
        .prepare("DELETE FROM dashboard_widgets WHERE dashboard_id = ?")
        .bind(dashboardId),
    );

    for (const widget of input.widgets) {
      statements.push(
        db
          .prepare(
            `INSERT INTO dashboard_widgets (id, dashboard_id, type, config_json, grid_x, grid_y, grid_w, grid_h)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            widget.id ?? newId(),
            dashboardId,
            widget.type,
            widget.config_json ?? null,
            widget.grid_x,
            widget.grid_y,
            widget.grid_w,
            widget.grid_h,
          ),
      );
    }
  }

  if (statements.length > 0) {
    await db.batch(statements);
  }

  const updated = await getDefaultDashboard(db, userId);
  if (!updated) throw new Error("Failed to update dashboard");
  return updated;
}

export async function resetDefaultDashboard(
  db: D1Database,
  userId: string,
): Promise<DashboardWithWidgets> {
  return updateDashboard(db, userId, {
    layout_json: JSON.stringify([]),
    widgets: DEFAULT_DASHBOARD_WIDGETS.map((widget) => ({
      ...widget,
      id: newId(),
    })),
  });
}
