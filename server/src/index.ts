import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  authenticateRequest,
  getAuthMode,
  IdentityError,
  unauthorizedResponse,
} from "./auth/identity";
import { ensureDefaultUser } from "./db/users";
import { SshSession } from "./do/ssh-session";
import { dashboardRoutes } from "./routes/dashboards";
import { aiRoutes } from "./routes/ai";
import { authRoutes } from "./routes/auth";
import { meRoutes } from "./routes/me";
import { onboardingRoutes } from "./routes/onboarding";
import { savedPasswordRoutes } from "./routes/saved-passwords";
import { savedPrivateKeyRoutes } from "./routes/saved-private-keys";
import { serverRoutes } from "./routes/servers";
import { sessionRoutes } from "./routes/sessions";
import type { Variables } from "./types";

export { SshSession };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

const NO_INDEX_HEADER = "noindex, nofollow, noarchive";

function isPublicApiPath(pathname: string): boolean {
  return (
    pathname === "/api/health" || pathname.startsWith("/api/v1/onboarding/")
  );
}

app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "Cf-Access-Jwt-Assertion"],
  }),
);

app.use("*", async (c, next) => {
  const mode = await getAuthMode(c.env);
  const pathname = new URL(c.req.url).pathname;
  const acceptsJson = pathname.startsWith("/api/");

  const applyNoIndex = () => {
    c.header("X-Robots-Tag", NO_INDEX_HEADER);
  };

  if (pathname.startsWith("/api/") && isPublicApiPath(pathname)) {
    await next();
    return;
  }

  if (mode === "onboarding") {
    if (pathname.startsWith("/api/")) {
      applyNoIndex();
      return c.json({ error: "Setup required", authMode: "onboarding" }, 403);
    }

    await next();
    applyNoIndex();
    return;
  }

  try {
    await authenticateRequest(c.req.raw, c.env);
    if (acceptsJson) {
      c.set("user", await ensureDefaultUser(c.env.DB));
    }
  } catch (error) {
    if (error instanceof IdentityError) {
      const response = unauthorizedResponse(error, acceptsJson);
      if (mode === "basic") {
        response.headers.set("X-Robots-Tag", NO_INDEX_HEADER);
      }
      return response;
    }
    console.error("identity error", error);
    const response = acceptsJson
      ? c.json({ error: "Unauthorized" }, 401)
      : new Response("Unauthorized", { status: 401 });
    if (mode === "basic") {
      response.headers.set("X-Robots-Tag", NO_INDEX_HEADER);
    }
    return response;
  }

  await next();
  if (mode === "basic") {
    applyNoIndex();
  }
});

app.get("/api/health", (c) => c.json({ ok: true }));

app.route("/api/v1/onboarding", onboardingRoutes);

const v1 = new Hono<{ Bindings: Env; Variables: Variables }>();
v1.route("/auth", authRoutes);
v1.route("/me", meRoutes);
v1.route("/servers", serverRoutes);
v1.route("/saved-passwords", savedPasswordRoutes);
v1.route("/saved-private-keys", savedPrivateKeyRoutes);
v1.route("/dashboards", dashboardRoutes);
v1.route("/sessions", sessionRoutes);
v1.route("/ai", aiRoutes);

app.route("/api/v1", v1);

app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
