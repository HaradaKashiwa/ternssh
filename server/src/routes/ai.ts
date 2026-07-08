import { Hono } from "hono";
import { AiCommandError, generateShellCommand } from "../lib/ai-command";
import { getUserAiSettings } from "../db/user-ai-settings";
import { jsonError } from "../lib/http";
import type { Variables } from "../types";

export const aiRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

aiRoutes.post("/generate-command", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as {
    prompt?: unknown;
    history?: unknown;
  } | null;

  if (typeof body?.prompt !== "string") {
    return jsonError(c, 400, "Prompt is required");
  }

  const history = Array.isArray(body.history)
    ? body.history.filter((item): item is string => typeof item === "string")
    : [];

  const settings = await getUserAiSettings(c.env.DB, user.id);

  try {
    const command = await generateShellCommand({
      prompt: body.prompt,
      history,
      apiBaseUrl: settings.apiBaseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
    });
    return c.json({ command });
  } catch (error) {
    if (error instanceof AiCommandError) {
      return jsonError(c, 400, error.message);
    }
    console.error("generate ai command failed", error);
    return jsonError(
      c,
      502,
      error instanceof Error ? error.message : "Failed to generate command",
    );
  }
});
