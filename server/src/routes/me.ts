import { Hono } from "hono";
import { getAuthMode } from "../auth/identity";
import { resetUserData } from "../db/reset-user-data";
import type { Variables } from "../types";

export const meRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

meRoutes.get("/", (c) => {
  const user = c.get("user");
  return c.json({
    user,
    authMode: getAuthMode(c.env),
  });
});

meRoutes.post("/reset", async (c) => {
  const user = c.get("user");
  try {
    const dashboard = await resetUserData(c.env.DB, user.id);
    return c.json({ dashboard });
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
