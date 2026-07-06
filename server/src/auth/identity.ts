import { createRemoteJWKSet, jwtVerify } from "jose";
import { ensureDefaultUser } from "../db/users";
import type { User } from "../types";

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

async function verifyAccessJwt(token: string, env: Env): Promise<void> {
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
    await jwtVerify(token, jwks, {
      issuer,
      audience,
    });
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
  if (isAccessEnabled(env)) {
    const token = request.headers.get("Cf-Access-Jwt-Assertion");
    if (!token) {
      throw new IdentityError("Missing Cf-Access-Jwt-Assertion header", 401);
    }
    await verifyAccessJwt(token, env);
  }

  return ensureDefaultUser(env.DB);
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
  return ensureDefaultUser(env.DB);
}
