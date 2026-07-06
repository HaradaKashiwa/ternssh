import { createRemoteJWKSet, jwtVerify } from "jose";
import { ensureDefaultUser, upsertUserFromEmail } from "../db/users";
import type { User } from "../types";

const DEFAULT_USER: User = {
  id: "default",
  email: null,
  display_name: "Default",
  created_at: "",
  updated_at: "",
};

function isAccessEnabled(env: Env): boolean {
  return String(env.ACCESS_ENABLED).toLowerCase() === "true";
}

function normalizeTeamDomain(raw: string): string {
  return raw
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

function normalizeAud(raw: string): string {
  return raw.trim();
}

async function verifyAccessJwt(
  token: string,
  env: Env,
): Promise<{ email: string }> {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new IdentityError(
      "ACCESS_TEAM_DOMAIN and ACCESS_AUD must be configured",
      500,
    );
  }

  const teamDomain = normalizeTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const audience = normalizeAud(env.ACCESS_AUD);
  const issuer = `https://${teamDomain}`;
  const jwks = createRemoteJWKSet(
    new URL(`${issuer}/cdn-cgi/access/certs`),
  );

  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience,
    });

    const email = typeof payload.email === "string" ? payload.email : null;
    if (!email) {
      throw new IdentityError(
        "Access JWT missing email claim (service tokens are not supported)",
        401,
      );
    }

    return { email };
  } catch (error) {
    if (error instanceof IdentityError) {
      throw error;
    }

    const message =
      error instanceof Error ? error.message : "Access JWT verification failed";
    throw new IdentityError(`Access JWT verification failed: ${message}`, 401);
  }
}

export async function resolveUser(request: Request, env: Env): Promise<User> {
  if (!isAccessEnabled(env)) {
    return ensureDefaultUser(env.DB);
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    throw new IdentityError("Missing Cf-Access-Jwt-Assertion header", 401);
  }

  const { email } = await verifyAccessJwt(token, env);
  return upsertUserFromEmail(env.DB, email);
}

export class IdentityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "IdentityError";
  }
}

export function getAuthMode(env: Env): "open" | "access" {
  return isAccessEnabled(env) ? "access" : "open";
}

export async function getDefaultUserSnapshot(env: Env): Promise<User> {
  if (isAccessEnabled(env)) {
    return DEFAULT_USER;
  }
  return ensureDefaultUser(env.DB);
}
