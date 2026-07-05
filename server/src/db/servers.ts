import { newId } from "../lib/id";
import type { GroupRecord, ServerPublic, ServerRecord, TreeNode } from "../types";

function toPublic(server: ServerRecord): ServerPublic {
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    auth_type: server.auth_type,
    group_id: server.group_id,
    sort_order: server.sort_order,
    created_at: server.created_at,
    updated_at: server.updated_at,
  };
}

export async function listGroups(
  db: D1Database,
  userId: string,
): Promise<GroupRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, parent_id, sort_order, created_at, updated_at
       FROM server_groups WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(userId)
    .all<GroupRecord>();

  return results ?? [];
}

export async function getGroup(
  db: D1Database,
  userId: string,
  groupId: string,
): Promise<GroupRecord | null> {
  return db
    .prepare(
      `SELECT id, user_id, name, parent_id, sort_order, created_at, updated_at
       FROM server_groups WHERE id = ? AND user_id = ?`,
    )
    .bind(groupId, userId)
    .first<GroupRecord>();
}

export async function listServersRaw(
  db: D1Database,
  userId: string,
): Promise<ServerRecord[]> {
  const { results } = await db
    .prepare(
      `SELECT id, user_id, name, host, port, username, auth_type, credential_ref,
              group_id, sort_order, created_at, updated_at
       FROM servers WHERE user_id = ? ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(userId)
    .all<ServerRecord>();

  return results ?? [];
}

export async function listServers(
  db: D1Database,
  userId: string,
): Promise<ServerPublic[]> {
  const servers = await listServersRaw(db, userId);
  return servers.map(toPublic);
}

export function buildServerTree(
  groups: GroupRecord[],
  servers: ServerRecord[],
): TreeNode[] {
  function buildLevel(parentId: string | null): TreeNode[] {
    const groupNodes: TreeNode[] = groups
      .filter((group) => group.parent_id === parentId)
      .map((group) => ({
        type: "group" as const,
        id: group.id,
        name: group.name,
        parent_id: group.parent_id,
        sort_order: group.sort_order,
        children: buildLevel(group.id),
      }));

    const serverNodes: TreeNode[] = servers
      .filter((server) => server.group_id === parentId)
      .map((server) => ({
        type: "server" as const,
        ...toPublic(server),
      }));

    return [...groupNodes, ...serverNodes].sort(
      (a, b) => a.sort_order - b.sort_order,
    );
  }

  return buildLevel(null);
}

export async function getServerTree(
  db: D1Database,
  userId: string,
): Promise<TreeNode[]> {
  const [groups, servers] = await Promise.all([
    listGroups(db, userId),
    listServersRaw(db, userId),
  ]);
  return buildServerTree(groups, servers);
}

export async function getServer(
  db: D1Database,
  userId: string,
  serverId: string,
): Promise<ServerRecord | null> {
  return db
    .prepare(
      `SELECT id, user_id, name, host, port, username, auth_type, credential_ref,
              group_id, sort_order, created_at, updated_at
       FROM servers WHERE id = ? AND user_id = ?`,
    )
    .bind(serverId, userId)
    .first<ServerRecord>();
}

async function nextSortOrder(
  db: D1Database,
  userId: string,
  parentId: string | null,
  groupId: string | null,
): Promise<number> {
  const groupMax = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) as max_order
       FROM server_groups WHERE user_id = ? AND parent_id IS ?`,
    )
    .bind(userId, parentId)
    .first<{ max_order: number }>();

  const serverMax = await db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) as max_order
       FROM servers WHERE user_id = ? AND group_id IS ?`,
    )
    .bind(userId, groupId)
    .first<{ max_order: number }>();

  return Math.max(groupMax?.max_order ?? -1, serverMax?.max_order ?? -1) + 1;
}

export async function createGroup(
  db: D1Database,
  userId: string,
  input: { name: string; parent_id?: string | null },
): Promise<GroupRecord> {
  const parentId = input.parent_id ?? null;
  if (parentId) {
    const parent = await getGroup(db, userId, parentId);
    if (!parent) throw new Error("parent group not found");
  }

  const id = newId();
  const sortOrder = await nextSortOrder(db, userId, parentId, parentId);

  await db
    .prepare(
      `INSERT INTO server_groups (id, user_id, name, parent_id, sort_order)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, userId, input.name, parentId, sortOrder)
    .run();

  const group = await getGroup(db, userId, id);
  if (!group) throw new Error("Failed to create group");
  return group;
}

export async function updateGroup(
  db: D1Database,
  userId: string,
  groupId: string,
  input: { name?: string; parent_id?: string | null },
): Promise<GroupRecord | null> {
  const existing = await getGroup(db, userId, groupId);
  if (!existing) return null;

  const parentId =
    input.parent_id !== undefined ? input.parent_id : existing.parent_id;

  if (parentId) {
    if (parentId === groupId) throw new Error("cannot move group into itself");
    const parent = await getGroup(db, userId, parentId);
    if (!parent) throw new Error("parent group not found");
    if (await isDescendant(db, userId, groupId, parentId)) {
      throw new Error("cannot move group into its descendant");
    }
  }

  await db
    .prepare(
      `UPDATE server_groups SET
        name = ?,
        parent_id = ?,
        updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`,
    )
    .bind(input.name ?? existing.name, parentId, groupId, userId)
    .run();

  return getGroup(db, userId, groupId);
}

export async function deleteGroup(
  db: D1Database,
  userId: string,
  groupId: string,
): Promise<boolean> {
  const existing = await getGroup(db, userId, groupId);
  if (!existing) return false;

  await db
    .prepare("DELETE FROM server_groups WHERE id = ? AND user_id = ?")
    .bind(groupId, userId)
    .run();

  return true;
}

async function isDescendant(
  db: D1Database,
  userId: string,
  ancestorId: string,
  candidateId: string,
): Promise<boolean> {
  let current = await getGroup(db, userId, candidateId);
  while (current?.parent_id) {
    if (current.parent_id === ancestorId) return true;
    current = await getGroup(db, userId, current.parent_id);
  }
  return false;
}

export async function createServer(
  db: D1Database,
  userId: string,
  input: {
    name: string;
    host: string;
    port: number;
    username: string;
    auth_type: "password" | "private_key";
    credential: string;
    group_id?: string | null;
  },
): Promise<ServerPublic> {
  const groupId = input.group_id ?? null;
  if (groupId) {
    const group = await getGroup(db, userId, groupId);
    if (!group) throw new Error("group not found");
  }

  const serverId = newId();
  const credentialId = newId();
  const sortOrder = await nextSortOrder(db, userId, groupId, groupId);

  await db.batch([
    db
      .prepare(
        "INSERT INTO credentials (id, user_id, value) VALUES (?, ?, ?)",
      )
      .bind(credentialId, userId, input.credential),
    db
      .prepare(
        `INSERT INTO servers (id, user_id, name, host, port, username, auth_type, credential_ref, group_id, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        serverId,
        userId,
        input.name,
        input.host,
        input.port,
        input.username,
        input.auth_type,
        credentialId,
        groupId,
        sortOrder,
      ),
  ]);

  const server = await getServer(db, userId, serverId);
  if (!server) throw new Error("Failed to create server");
  return toPublic(server);
}

export async function updateServer(
  db: D1Database,
  userId: string,
  serverId: string,
  input: {
    name?: string;
    host?: string;
    port?: number;
    username?: string;
    auth_type?: "password" | "private_key";
    credential?: string;
    group_id?: string | null;
  },
): Promise<ServerPublic | null> {
  const existing = await getServer(db, userId, serverId);
  if (!existing) return null;

  if (input.group_id) {
    const group = await getGroup(db, userId, input.group_id);
    if (!group) throw new Error("group not found");
  }

  const statements: D1PreparedStatement[] = [];

  if (input.credential !== undefined) {
    statements.push(
      db
        .prepare("UPDATE credentials SET value = ? WHERE id = ? AND user_id = ?")
        .bind(input.credential, existing.credential_ref, userId),
    );
  }

  statements.push(
    db
      .prepare(
        `UPDATE servers SET
          name = ?,
          host = ?,
          port = ?,
          username = ?,
          auth_type = ?,
          group_id = ?,
          updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
      .bind(
        input.name ?? existing.name,
        input.host ?? existing.host,
        input.port ?? existing.port,
        input.username ?? existing.username,
        input.auth_type ?? existing.auth_type,
        input.group_id !== undefined ? input.group_id : existing.group_id,
        serverId,
        userId,
      ),
  );

  await db.batch(statements);

  const server = await getServer(db, userId, serverId);
  return server ? toPublic(server) : null;
}

export async function copyServer(
  db: D1Database,
  userId: string,
  sourceId: string,
  input: {
    name: string;
    host: string;
    port: number;
    username: string;
    auth_type: "password" | "private_key";
    group_id?: string | null;
    credential?: string;
  },
): Promise<ServerPublic> {
  const source = await getServer(db, userId, sourceId);
  if (!source) throw new Error("server not found");

  let credential = input.credential?.trim();
  if (!credential) {
    credential =
      (await getCredentialValue(db, userId, source.credential_ref)) ?? "";
    if (!credential) throw new Error("source credential not found");
  }

  const groupId =
    input.group_id !== undefined ? input.group_id : source.group_id;

  return createServer(db, userId, {
    name: input.name,
    host: input.host,
    port: input.port,
    username: input.username,
    auth_type: input.auth_type,
    credential,
    group_id: groupId,
  });
}

export async function deleteServer(
  db: D1Database,
  userId: string,
  serverId: string,
): Promise<boolean> {
  const existing = await getServer(db, userId, serverId);
  if (!existing) return false;

  await db.batch([
    db
      .prepare("DELETE FROM servers WHERE id = ? AND user_id = ?")
      .bind(serverId, userId),
    db
      .prepare("DELETE FROM credentials WHERE id = ? AND user_id = ?")
      .bind(existing.credential_ref, userId),
  ]);

  return true;
}

export async function moveTreeItem(
  db: D1Database,
  userId: string,
  input: {
    type: "server" | "group";
    id: string;
    parentId: string | null;
    index: number;
  },
): Promise<void> {
  if (input.type === "group") {
    const group = await getGroup(db, userId, input.id);
    if (!group) throw new Error("group not found");

    if (input.parentId) {
      if (input.parentId === input.id) {
        throw new Error("cannot move group into itself");
      }
      const parent = await getGroup(db, userId, input.parentId);
      if (!parent) throw new Error("parent group not found");
      if (await isDescendant(db, userId, input.id, input.parentId)) {
        throw new Error("cannot move group into its descendant");
      }
    }

    await db
      .prepare(
        `UPDATE server_groups SET parent_id = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
      .bind(input.parentId, input.id, userId)
      .run();
  } else {
    if (input.parentId) {
      const group = await getGroup(db, userId, input.parentId);
      if (!group) throw new Error("group not found");
    }

    const server = await getServer(db, userId, input.id);
    if (!server) throw new Error("server not found");

    await db
      .prepare(
        `UPDATE servers SET group_id = ?, updated_at = datetime('now')
         WHERE id = ? AND user_id = ?`,
      )
      .bind(input.parentId, input.id, userId)
      .run();
  }

  await reorderSiblings(db, userId, input.parentId, input.type, input.id, input.index);
}

async function reorderSiblings(
  db: D1Database,
  userId: string,
  parentId: string | null,
  movedType: "server" | "group",
  movedId: string,
  targetIndex: number,
): Promise<void> {
  const groups = await db
    .prepare(
      `SELECT id, sort_order FROM server_groups
       WHERE user_id = ? AND parent_id IS ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(userId, parentId)
    .all<{ id: string; sort_order: number }>();

  const servers = await db
    .prepare(
      `SELECT id, sort_order FROM servers
       WHERE user_id = ? AND group_id IS ?
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .bind(userId, parentId)
    .all<{ id: string; sort_order: number }>();

  type Entry = { type: "server" | "group"; id: string; sort_order: number };
  const siblings: Entry[] = [
    ...(groups.results ?? []).map((group) => ({
      type: "group" as const,
      id: group.id,
      sort_order: group.sort_order,
    })),
    ...(servers.results ?? []).map((server) => ({
      type: "server" as const,
      id: server.id,
      sort_order: server.sort_order,
    })),
  ].sort((a, b) => a.sort_order - b.sort_order);

  const withoutMoved = siblings.filter(
    (entry) => !(entry.type === movedType && entry.id === movedId),
  );
  const clampedIndex = clamp(targetIndex, 0, withoutMoved.length);
  withoutMoved.splice(clampedIndex, 0, {
    type: movedType,
    id: movedId,
    sort_order: clampedIndex,
  });

  const statements: D1PreparedStatement[] = withoutMoved.map((entry, index) => {
    if (entry.type === "group") {
      return db
        .prepare(
          "UPDATE server_groups SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
        )
        .bind(index, entry.id, userId);
    }
    return db
      .prepare(
        "UPDATE servers SET sort_order = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?",
      )
      .bind(index, entry.id, userId);
  });

  if (statements.length > 0) {
    await db.batch(statements);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export async function getCredentialValue(
  db: D1Database,
  userId: string,
  credentialRef: string,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT value FROM credentials WHERE id = ? AND user_id = ?")
    .bind(credentialRef, userId)
    .first<{ value: string }>();

  return row?.value ?? null;
}
