import { Hono } from "hono";
import { getAuthMode } from "../auth/identity";
import { SITE_NAME_MAX_LENGTH } from "../db/site-name";
import { resetUserData } from "../db/reset-user-data";
import {
  deleteUserAiSettings,
  getUserAiSettings,
  updateUserAiSettings,
} from "../db/user-ai-settings";
import { updateUserSiteName } from "../db/users";
import type { Variables } from "../types";

export const meRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

meRoutes.get("/", async (c) => {
  const user = c.get("user");
  return c.json({
    user,
    authMode: await getAuthMode(c.env),
  });
});

meRoutes.put("/site-name", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as {
    siteName?: unknown;
  } | null;

  if (typeof body?.siteName !== "string") {
    return c.json({ error: "Site name must be a string" }, 400);
  }

  if (body.siteName.trim().length > SITE_NAME_MAX_LENGTH) {
    return c.json(
      {
        error: `Site name must be at most ${SITE_NAME_MAX_LENGTH} characters`,
      },
      400,
    );
  }

  try {
    const updated = await updateUserSiteName(c.env.DB, user.id, body.siteName);
    return c.json({ user: updated });
  } catch (error) {
    console.error("update site name failed", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update site name",
      },
      500,
    );
  }
});

meRoutes.get("/ai-settings", async (c) => {
  const user = c.get("user");
  const settings = await getUserAiSettings(c.env.DB, user.id);
  return c.json({ settings });
});

meRoutes.put("/ai-settings", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as {
    apiBaseUrl?: unknown;
    apiKey?: unknown;
    model?: unknown;
  } | null;

  if (typeof body?.apiBaseUrl !== "string") {
    return c.json({ error: "API base URL is required" }, 400);
  }
  if (typeof body.apiKey !== "string") {
    return c.json({ error: "API key is required" }, 400);
  }
  if (typeof body.model !== "string") {
    return c.json({ error: "Model is required" }, 400);
  }

  try {
    const settings = await updateUserAiSettings(c.env.DB, user.id, {
      apiBaseUrl: body.apiBaseUrl,
      apiKey: body.apiKey,
      model: body.model,
    });
    return c.json({ settings });
  } catch (error) {
    console.error("update ai settings failed", error);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to update AI settings",
      },
      500,
    );
  }
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
