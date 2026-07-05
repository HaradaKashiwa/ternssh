import { DurableObject } from "cloudflare:workers";
import { getCredentialValue, getServer } from "../db/servers";
import {
  computeCpuUsage,
  computeInterfaceNetRates,
  computeNetRates,
  parseStatusOutput,
  STATUS_COMMAND,
} from "../lib/server-status";
import { connectToHost } from "../lib/resolve-host";
import { SSHSession } from "../ssh/session";
import type { SSHConnectionConfig } from "../ssh/types";

interface SessionRow {
  id: string;
  user_id: string;
  server_id: string;
  status: string;
}

export class SshSession extends DurableObject<Env> {
  private sshSession: SSHSession | null = null;
  private statusSession: SSHSession | null = null;
  private terminalWs: WebSocket | null = null;
  private sftpSockets = new Set<WebSocket>();
  private bootstrapping: Promise<void> | null = null;
  private statusBootstrapping: Promise<void> | null = null;
  private connectionConfig: SSHConnectionConfig | null = null;
  private lastNetSample: { rxBytes: number; txBytes: number; at: number } | null =
    null;
  private lastCpuSample: { total: number; idle: number; at: number } | null =
    null;
  private lastNetInterfaceSamples: Record<
    string,
    { rxBytes: number; txBytes: number; at: number }
  > | null = null;
  private statusCollectChain: Promise<void> = Promise.resolve();

  async fetch(request: Request): Promise<Response> {
    const parsed = parseRequestUrl(request.url);
    if (!parsed) {
      return new Response("Invalid session URL", { status: 400 });
    }

    const session = await this.env.DB.prepare(
      "SELECT id, user_id, server_id, status FROM sessions WHERE id = ?",
    )
      .bind(parsed.sessionId)
      .first<SessionRow>();

    if (!session) {
      return new Response("Session not found", { status: 404 });
    }

    if (parsed.channel === "status") {
      return this.handleStatus(session);
    }

    const upgradeHeader = request.headers.get("Upgrade");
    if (upgradeHeader?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, serverWs] = Object.values(pair);
    this.ctx.acceptWebSocket(serverWs);

    if (parsed.channel === "sftp") {
      queueMicrotask(() => {
        void this.attachSftp(serverWs);
      });
      return new Response(null, { status: 101, webSocket: client });
    }

    const serverRecord = await getServer(
      this.env.DB,
      session.user_id,
      session.server_id,
    );
    if (!serverRecord) {
      return new Response("Server not found", { status: 404 });
    }

    const credential = await getCredentialValue(
      this.env.DB,
      session.user_id,
      serverRecord.credential_ref,
    );
    if (!credential) {
      return new Response("Credential not found", { status: 404 });
    }

    const config: SSHConnectionConfig = {
      host: serverRecord.host,
      port: serverRecord.port,
      username: serverRecord.username,
      password: serverRecord.auth_type === "password" ? credential : "",
      authMethod:
        serverRecord.auth_type === "private_key" ? "publickey" : "password",
      privateKey:
        serverRecord.auth_type === "private_key" ? credential : undefined,
      cols: 120,
      rows: 40,
    };

    queueMicrotask(() => {
      void this.startTerminal(serverWs, config);
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (this.sftpSockets.has(ws)) {
      await this.sshSession?.handleSFTPWebSocketMessage(message);
      return;
    }

    if (ws === this.terminalWs) {
      await this.sshSession?.handleWebSocketMessage(message);
    }
  }

  async webSocketClose(
    ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ) {
    if (this.sftpSockets.has(ws)) {
      this.sftpSockets.delete(ws);
      this.sshSession?.detachSFTPWebSocket(ws, true);
      return;
    }

    if (ws === this.terminalWs) {
      this.terminalWs = null;
      this.sshSession?.close();
      this.sshSession = null;
      this.bootstrapping = null;
      this.connectionConfig = null;
      this.closeStatusSession(true);
      for (const sftpWs of this.sftpSockets) {
        try {
          sftpWs.close(1000, "Terminal session closed");
        } catch {
          // ignore
        }
      }
      this.sftpSockets.clear();
    }
  }

  private async handleStatus(session: SessionRow): Promise<Response> {
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      if (this.bootstrapping) {
        try {
          await this.bootstrapping;
        } catch {
          break;
        }
      }

      if (this.sshSession?.isSSHReady()) {
        try {
          const config = await this.resolveConnectionConfig(session);
          if (!config) {
            return Response.json({ error: "服务器配置不存在" }, { status: 404 });
          }

          await this.ensureStatusSession(config);
          if (!this.statusSession?.isSSHReady()) {
            throw new Error("状态采集连接未就绪");
          }

          const result = await this.collectStatusMetrics(config);
          const parsed = parseStatusOutput(result.stdout);
          const now = Date.now();
          const { netRxRate, netTxRate, sample } = computeNetRates(
            parsed.netRxBytes,
            parsed.netTxBytes,
            this.lastNetSample,
            now,
          );
          if (sample) {
            this.lastNetSample = sample;
          }
          const { cpuUsedPercent, sample: cpuSample } = computeCpuUsage(
            parsed.cpuTotalJiffies,
            parsed.cpuIdleJiffies,
            this.lastCpuSample,
            now,
          );
          if (cpuSample) {
            this.lastCpuSample = cpuSample;
          }
          const { interfaces: netInterfaces, samples: netInterfaceSamples } =
            computeInterfaceNetRates(
              parsed.netInterfaces,
              this.lastNetInterfaceSamples,
              now,
            );
          this.lastNetInterfaceSamples = netInterfaceSamples;
          parsed.metrics.netRxRate = netRxRate;
          parsed.metrics.netTxRate = netTxRate;
          parsed.metrics.cpuUsedPercent = cpuUsedPercent;
          parsed.metrics.netInterfaces = netInterfaces;
          return Response.json({
            serverId: session.server_id,
            collectedAt: new Date(now).toISOString(),
            metrics: parsed.metrics,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Status collection failed";
          return Response.json({ error: message }, { status: 500 });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    return Response.json(
      {
        error: this.sshSession
          ? "SSH 连接未就绪，请稍后重试"
          : "请先连接终端会话",
      },
      { status: 503 },
    );
  }

  private async resolveConnectionConfig(
    session: SessionRow,
  ): Promise<SSHConnectionConfig | null> {
    if (this.connectionConfig) {
      return this.connectionConfig;
    }

    const serverRecord = await getServer(
      this.env.DB,
      session.user_id,
      session.server_id,
    );
    if (!serverRecord) return null;

    const credential = await getCredentialValue(
      this.env.DB,
      session.user_id,
      serverRecord.credential_ref,
    );
    if (!credential) return null;

    this.connectionConfig = {
      host: serverRecord.host,
      port: serverRecord.port,
      username: serverRecord.username,
      password: serverRecord.auth_type === "password" ? credential : "",
      authMethod:
        serverRecord.auth_type === "private_key" ? "publickey" : "password",
      privateKey:
        serverRecord.auth_type === "private_key" ? credential : undefined,
      cols: 120,
      rows: 40,
    };
    return this.connectionConfig;
  }

  private closeStatusSession(clearNetSample = false): void {
    this.statusSession?.close();
    this.statusSession = null;
    this.statusBootstrapping = null;
    if (clearNetSample) {
      this.lastNetSample = null;
      this.lastCpuSample = null;
      this.lastNetInterfaceSamples = null;
    }
  }

  private async ensureStatusSession(
    config: SSHConnectionConfig,
  ): Promise<void> {
    if (this.statusSession?.isSSHReady()) return;

    if (this.statusBootstrapping) {
      await this.statusBootstrapping;
      await this.waitForStatusReady(30_000);
      return;
    }

    this.closeStatusSession();

    this.statusBootstrapping = (async () => {
      const socket = await connectToHost(config.host, config.port);

      const noopWs = {
        send: () => {},
        close: () => {},
      } as unknown as WebSocket;

      const session = new SSHSession(
        noopWs,
        socket,
        config,
        false,
        false,
        undefined,
        true,
      );
      this.statusSession = session;
      await session.startHandshake();
      await this.waitForStatusReady(30_000);
    })();

    try {
      await this.statusBootstrapping;
    } finally {
      this.statusBootstrapping = null;
    }
  }

  private async waitForStatusReady(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (this.statusSession?.isSSHReady()) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new Error("状态采集连接未就绪");
  }

  private isRetriableStatusError(message: string): boolean {
    return (
      message.includes("open failed") ||
      message.includes("Exec 通道打开失败") ||
      message.includes("Exec 请求被拒绝") ||
      message.includes("已有命令正在执行") ||
      message.includes("命令执行超时") ||
      message.includes("SSH 连接未就绪")
    );
  }

  private async collectStatusMetrics(config: SSHConnectionConfig) {
    const run = async () => {
      try {
        return await this.statusSession!.execCommand(STATUS_COMMAND, 12000);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!this.isRetriableStatusError(message)) {
          throw error;
        }

        this.closeStatusSession();
        await this.ensureStatusSession(config);
        if (!this.statusSession?.isSSHReady()) {
          throw new Error("状态采集连接未就绪");
        }
        return await this.statusSession!.execCommand(STATUS_COMMAND, 12000);
      }
    };

    const result = this.statusCollectChain.then(run);
    this.statusCollectChain = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private async startTerminal(
    ws: WebSocket,
    config: SSHConnectionConfig,
  ): Promise<void> {
    this.terminalWs = ws;
    this.lastNetSample = null;

    if (this.sshSession) {
      this.sshSession.close();
      this.sshSession = null;
    }
    this.closeStatusSession(true);

    try {
      await this.ensureSshSession(ws, config);
      await this.bootstrapping;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "SSH connection failed";
      try {
        ws.send(JSON.stringify({ type: "error", message: `连接失败: ${message}` }));
        ws.close(1011, message);
      } catch {
        // ignore
      }
      this.terminalWs = null;
      this.sshSession = null;
      this.bootstrapping = null;
    }
  }

  private async attachSftp(ws: WebSocket): Promise<void> {
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      if (this.bootstrapping) {
        try {
          await this.bootstrapping;
        } catch {
          break;
        }
      }

      if (this.sshSession?.isSSHReady()) {
        this.sftpSockets.add(ws);
        this.sshSession.attachSFTPWebSocket(ws);
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    try {
      ws.send(
        JSON.stringify({
          type: "sftp_error",
          operation: "init",
          message: this.sshSession
            ? "SSH 连接未就绪，请稍后重试"
            : "请先连接终端会话",
        }),
      );
      ws.close(1013, "SSH session not ready");
    } catch {
      // ignore
    }
  }

  private async ensureSshSession(
    ws: WebSocket,
    config: SSHConnectionConfig,
  ): Promise<void> {
    if (this.sshSession && this.bootstrapping) {
      await this.bootstrapping;
      return;
    }

    if (this.sshSession) return;

    this.bootstrapping = (async () => {
      const socket = await connectToHost(config.host, config.port);

      this.connectionConfig = config;
      const session = new SSHSession(ws, socket, config, false, false);
      this.sshSession = session;
      await session.startHandshake();
    })();

    await this.bootstrapping;
    this.bootstrapping = null;
  }
}

function parseRequestUrl(
  url: string,
): { sessionId: string; channel: "terminal" | "sftp" | "status" } | null {
  const pathname = new URL(url).pathname;
  const statusMatch = pathname.match(/\/sessions\/([^/]+)\/status$/);
  if (statusMatch?.[1]) {
    return { sessionId: statusMatch[1], channel: "status" };
  }
  const sftpMatch = pathname.match(/\/sessions\/([^/]+)\/sftp\/ws$/);
  if (sftpMatch?.[1]) {
    return { sessionId: sftpMatch[1], channel: "sftp" };
  }
  const terminalMatch = pathname.match(/\/sessions\/([^/]+)\/ws$/);
  if (terminalMatch?.[1]) {
    return { sessionId: terminalMatch[1], channel: "terminal" };
  }
  return null;
}
