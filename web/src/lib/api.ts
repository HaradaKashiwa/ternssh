import type { SessionStatusResponse } from "./server-status";

export interface User {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key";
  group_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ServerGroup {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type TreeNode =
  | {
      type: "group";
      id: string;
      name: string;
      parent_id: string | null;
      sort_order: number;
      children: TreeNode[];
    }
  | ({
      type: "server";
    } & Server);

export interface DashboardWidget {
  id: string;
  dashboard_id: string;
  type: string;
  config_json: string | null;
  grid_x: number;
  grid_y: number;
  grid_w: number;
  grid_h: number;
}

export interface Dashboard {
  dashboard: {
    id: string;
    user_id: string;
    name: string;
    is_default: number;
    layout_json: string | null;
    created_at: string;
    updated_at: string;
  };
  widgets: DashboardWidget[];
}

export interface MeResponse {
  user: User;
  authMode: "open" | "access";
}

export interface CreateServerInput {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key";
  credential: string;
  group_id?: string | null;
}

export interface CopyServerInput {
  name: string;
  host: string;
  port: number;
  username: string;
  auth_type: "password" | "private_key";
  credential?: string;
  group_id?: string | null;
}

export interface UpdateServerInput {
  name?: string;
  host?: string;
  port?: number;
  username?: string;
  auth_type?: "password" | "private_key";
  credential?: string;
  group_id?: string | null;
}

export interface SavedPasswordRecord {
  id: string;
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

export interface SavedPrivateKeyRecord {
  id: string;
  name: string;
  value: string;
  created_at: string;
  updated_at: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }

  return response.json() as Promise<T>;
}

export const api = {
  getMe: () => request<MeResponse>("/api/v1/me"),
  getServerTree: () => request<{ tree: TreeNode[] }>("/api/v1/servers/tree"),
  listServers: () => request<{ tree: TreeNode[] }>("/api/v1/servers"),
  createServer: (input: CreateServerInput) =>
    request<{ server: Server }>("/api/v1/servers", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  copyServer: (sourceId: string, input: CopyServerInput) =>
    request<{ server: Server }>(`/api/v1/servers/${sourceId}/copy`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateServer: (id: string, input: UpdateServerInput) =>
    request<{ server: Server }>(`/api/v1/servers/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  createGroup: (input: { name: string; parent_id?: string | null }) =>
    request<{ group: ServerGroup }>("/api/v1/servers/groups", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteGroup: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/servers/groups/${id}`, {
      method: "DELETE",
    }),
  updateGroup: (id: string, input: { name?: string; parent_id?: string | null }) =>
    request<{ group: ServerGroup }>(`/api/v1/servers/groups/${id}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  moveTreeItem: (input: {
    type: "server" | "group";
    id: string;
    parentId: string | null;
    index: number;
  }) =>
    request<{ tree: TreeNode[] }>("/api/v1/servers/move", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  deleteServer: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/servers/${id}`, { method: "DELETE" }),
  listSavedPasswords: () =>
    request<{ passwords: SavedPasswordRecord[] }>("/api/v1/saved-passwords"),
  savePassword: (input: { name: string; value: string }) =>
    request<{ password: SavedPasswordRecord }>("/api/v1/saved-passwords", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteSavedPassword: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/saved-passwords/${id}`, {
      method: "DELETE",
    }),
  listSavedPrivateKeys: () =>
    request<{ keys: SavedPrivateKeyRecord[] }>("/api/v1/saved-private-keys"),
  savePrivateKey: (input: { name: string; value: string }) =>
    request<{ key: SavedPrivateKeyRecord }>("/api/v1/saved-private-keys", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteSavedPrivateKey: (id: string) =>
    request<{ ok: boolean }>(`/api/v1/saved-private-keys/${id}`, {
      method: "DELETE",
    }),
  getDashboard: () => request<Dashboard>("/api/v1/dashboards"),
  updateDashboard: (body: {
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
  }) =>
    request<Dashboard>("/api/v1/dashboards", {
      method: "PUT",
      body: JSON.stringify(body),
    }),
  resetDashboard: () =>
    request<Dashboard>("/api/v1/me/reset", {
      method: "POST",
    }).then((response) => response.dashboard),
  createSession: (serverId: string) =>
    request<{
      sessionId: string;
      wsUrl: string;
      sftpWsUrl: string;
      status: string;
    }>("/api/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ serverId }),
    }),
  getSessionStatus: (sessionId: string) =>
    request<SessionStatusResponse>(`/api/v1/sessions/${sessionId}/status`),
};
