import { Hono } from "hono";
import {
  ensureDefaultDashboard,
  getDefaultDashboard,
  updateDashboard,
} from "../db/dashboards";
import { resetUserData } from "../db/reset-user-data";
import type { Variables } from "../types";

export const dashboardRoutes = new Hono<{
  Bindings: Env;
  Variables: Variables;
}>();

dashboardRoutes.get("/", async (c) => {
  const user = c.get("user");
  const dashboard = await ensureDefaultDashboard(c.env.DB, user.id);
  return c.json(dashboard);
});

dashboardRoutes.put("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
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
  }>();

  const dashboard = await updateDashboard(c.env.DB, user.id, body);
  return c.json(dashboard);
});

dashboardRoutes.post("/reset", async (c) => {
  const user = c.get("user");
  try {
    const dashboard = await resetUserData(c.env.DB, user.id);
    return c.json(dashboard);
  } catch (error) {
    console.error("reset user data failed", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to reset user data",
      },
      500,
    );
  }
});

dashboardRoutes.get("/default", async (c) => {
  const user = c.get("user");
  const dashboard =
    (await getDefaultDashboard(c.env.DB, user.id)) ??
    (await ensureDefaultDashboard(c.env.DB, user.id));
  return c.json(dashboard);
});
