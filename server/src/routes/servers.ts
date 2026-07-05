import { Hono } from "hono";
import {
  createGroup,
  createServer,
  copyServer,
  deleteGroup,
  deleteServer,
  getServerTree,
  moveTreeItem,
  updateGroup,
  updateServer,
} from "../db/servers";
import { jsonError } from "../lib/http";
import type { Variables } from "../types";

export const serverRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

serverRoutes.get("/tree", async (c) => {
  const user = c.get("user");
  const tree = await getServerTree(c.env.DB, user.id);
  return c.json({ tree });
});

serverRoutes.post("/groups", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{ name?: string; parent_id?: string | null }>();

  if (!body.name?.trim()) return jsonError(c, 400, "name is required");

  try {
    const group = await createGroup(c.env.DB, user.id, {
      name: body.name.trim(),
      parent_id: body.parent_id ?? null,
    });
    return c.json({ group }, 201);
  } catch (error) {
    return jsonError(
      c,
      400,
      error instanceof Error ? error.message : "failed to create group",
    );
  }
});

serverRoutes.put("/groups/:id", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const body = await c.req.json<{ name?: string; parent_id?: string | null }>();

  try {
    const group = await updateGroup(c.env.DB, user.id, groupId, {
      name: body.name?.trim(),
      parent_id: body.parent_id,
    });
    if (!group) return jsonError(c, 404, "group not found");
    return c.json({ group });
  } catch (error) {
    return jsonError(
      c,
      400,
      error instanceof Error ? error.message : "failed to update group",
    );
  }
});

serverRoutes.delete("/groups/:id", async (c) => {
  const user = c.get("user");
  const groupId = c.req.param("id");
  const deleted = await deleteGroup(c.env.DB, user.id, groupId);
  if (!deleted) return jsonError(c, 404, "group not found");
  return c.json({ ok: true });
});

serverRoutes.put("/move", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    type?: "server" | "group";
    id?: string;
    parentId?: string | null;
    sortOrder?: number;
    index?: number;
  }>();

  if (body.type !== "server" && body.type !== "group") {
    return jsonError(c, 400, "type must be server or group");
  }
  if (!body.id) return jsonError(c, 400, "id is required");
  const index = body.index ?? body.sortOrder;
  if (typeof index !== "number") {
    return jsonError(c, 400, "index is required");
  }

  const parentId = body.parentId ?? null;

  try {
    await moveTreeItem(c.env.DB, user.id, {
      type: body.type,
      id: body.id,
      parentId,
      index,
    });
    const tree = await getServerTree(c.env.DB, user.id);
    return c.json({ tree });
  } catch (error) {
    return jsonError(
      c,
      400,
      error instanceof Error ? error.message : "failed to move item",
    );
  }
});

serverRoutes.get("/", async (c) => {
  const user = c.get("user");
  const tree = await getServerTree(c.env.DB, user.id);
  return c.json({ tree });
});

serverRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    auth_type?: "password" | "private_key";
    credential?: string;
    group_id?: string | null;
  }>();

  if (!body.name?.trim()) return jsonError(c, 400, "name is required");
  if (!body.host?.trim()) return jsonError(c, 400, "host is required");
  if (!body.username?.trim()) return jsonError(c, 400, "username is required");
  if (!body.credential?.trim()) {
    return jsonError(c, 400, "credential is required");
  }
  if (body.auth_type !== "password" && body.auth_type !== "private_key") {
    return jsonError(c, 400, "auth_type must be password or private_key");
  }

  const port = body.port ?? 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return jsonError(c, 400, "port must be between 1 and 65535");
  }

  try {
    const server = await createServer(c.env.DB, user.id, {
      name: body.name.trim(),
      host: body.host.trim(),
      port,
      username: body.username.trim(),
      auth_type: body.auth_type,
      credential: body.credential,
      group_id: body.group_id ?? null,
    });
    return c.json({ server }, 201);
  } catch (error) {
    return jsonError(
      c,
      400,
      error instanceof Error ? error.message : "failed to create server",
    );
  }
});

serverRoutes.post("/:id/copy", async (c) => {
  const user = c.get("user");
  const sourceId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    auth_type?: "password" | "private_key";
    credential?: string;
    group_id?: string | null;
  }>();

  if (!body.name?.trim()) return jsonError(c, 400, "name is required");
  if (!body.host?.trim()) return jsonError(c, 400, "host is required");
  if (!body.username?.trim()) return jsonError(c, 400, "username is required");
  if (body.auth_type !== "password" && body.auth_type !== "private_key") {
    return jsonError(c, 400, "auth_type must be password or private_key");
  }

  const port = body.port ?? 22;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return jsonError(c, 400, "port must be between 1 and 65535");
  }

  try {
    const server = await copyServer(c.env.DB, user.id, sourceId, {
      name: body.name.trim(),
      host: body.host.trim(),
      port,
      username: body.username.trim(),
      auth_type: body.auth_type,
      credential: body.credential?.trim() || undefined,
      group_id: body.group_id ?? null,
    });
    return c.json({ server }, 201);
  } catch (error) {
    return jsonError(
      c,
      400,
      error instanceof Error ? error.message : "failed to copy server",
    );
  }
});

serverRoutes.put("/:id", async (c) => {
  const user = c.get("user");
  const serverId = c.req.param("id");
  const body = await c.req.json<{
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    auth_type?: "password" | "private_key";
    credential?: string;
    group_id?: string | null;
  }>();

  if (
    body.auth_type !== undefined &&
    body.auth_type !== "password" &&
    body.auth_type !== "private_key"
  ) {
    return jsonError(c, 400, "auth_type must be password or private_key");
  }

  if (body.port !== undefined) {
    if (!Number.isInteger(body.port) || body.port < 1 || body.port > 65535) {
      return jsonError(c, 400, "port must be between 1 and 65535");
    }
  }

  try {
    const server = await updateServer(c.env.DB, user.id, serverId, {
      name: body.name?.trim(),
      host: body.host?.trim(),
      username: body.username?.trim(),
      port: body.port,
      auth_type: body.auth_type,
      credential: body.credential,
      group_id: body.group_id,
    });

    if (!server) return jsonError(c, 404, "server not found");
    return c.json({ server });
  } catch (error) {
    return jsonError(
      c,
      400,
      error instanceof Error ? error.message : "failed to update server",
    );
  }
});

serverRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const serverId = c.req.param("id");
  const deleted = await deleteServer(c.env.DB, user.id, serverId);
  if (!deleted) return jsonError(c, 404, "server not found");
  return c.json({ ok: true });
});
